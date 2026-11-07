//! 后台任务命令：打包、重排。
//!
//! ## 为什么用「线程 + 事件」而不是 async 命令
//!
//! 这些都是长任务（大图集打包可能跑十几秒）。同步命令在 Tauri 里跑在主线程上，
//! **会把整个界面连同进度条一起冻住**——那样进度事件也刷不出来。
//!
//! 用 `std::thread::spawn` + 事件是最可预测的做法：命令立刻返回，工作在线程里跑，
//! 结果用事件推回前端。
//!
//! ## 事件名
//!
//! `pack-done` 用于正式导出，`pack-preview` 用于临时预览。

use crate::sprite::commands::AppState;
use serde::Serialize;
use slicer_io::pack::PackInput;
use slicer_io::{Atlas, JsonLayout, JsonOptions, PackOptions, SpriteOut};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub image_name: String,
    pub width: u32,
    pub height: u32,
    pub frames: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSummary {
    pub out_dir: String,
    pub pages: Vec<PageInfo>,
    pub frame_count: usize,
    pub written: Vec<String>,
    pub warnings: Vec<String>,
    pub elapsed_ms: u128,
}

/// 把一次打包结果写成磁盘文件并汇总。
fn write_pack_summary(
    out_root: String,
    atlas: Result<Atlas, String>,
    started: Instant,
    opts: &PackOptions,
    json_opts: &JsonOptions,
) -> PackSummary {
    // 图集同样独占一层目录，避免两次打包的 atlas.png 互相覆盖
    let out_dir = slicer_io::plan_atlas_dir(Path::new(&out_root), &opts.base_name);

    match atlas.and_then(|atlas| {
        let warnings = atlas.warnings.clone();
        let pages: Vec<PageInfo> = atlas
            .pages
            .iter()
            .map(|p| PageInfo {
                image_name: p.image_name.clone(),
                width: p.width,
                height: p.height,
                frames: p.frames.len(),
            })
            .collect();
        let frame_count = atlas.frame_count();

        let written = slicer_io::write_atlas(&atlas, &out_dir, &opts.base_name, json_opts)?;

        Ok(PackSummary {
            out_dir: out_dir.to_string_lossy().to_string(),
            pages,
            frame_count,
            written,
            warnings,
            elapsed_ms: started.elapsed().as_millis(),
        })
    }) {
        Ok(summary) => summary,
        Err(message) => PackSummary {
            out_dir: out_dir.to_string_lossy().to_string(),
            pages: Vec::new(),
            frame_count: 0,
            written: Vec::new(),
            warnings: vec![message],
            elapsed_ms: started.elapsed().as_millis(),
        },
    }
}

/// 打包收尾：写盘 + 把结果（或失败原因）通过事件送回前端。
///
/// 失败也走同一个事件，前端只需要处理一种结束信号。
fn finish_pack(
    app: &AppHandle,
    out_root: String,
    atlas: Result<Atlas, String>,
    started: Instant,
    opts: &PackOptions,
    json_opts: &JsonOptions,
    event: &str,
) {
    let summary = write_pack_summary(out_root, atlas, started, opts, json_opts);
    let _ = app.emit(event, summary);
}

/// 打包：多张图 → 一张图集。输入可以是文件，也可以是目录。
#[tauri::command]
pub fn pack_images(
    app: AppHandle,
    inputs: Vec<String>,
    out_dir: String,
    opts: PackOptions,
    layout: JsonLayout,
    recursive: bool,
) {
    let json_opts = JsonOptions {
        layout,
        ..Default::default()
    };

    std::thread::spawn(move || {
        let started = Instant::now();
        let paths: Vec<PathBuf> = inputs.into_iter().map(PathBuf::from).collect();

        let atlas = slicer_io::load_pack_inputs(&paths, recursive)
            .and_then(|pack_inputs| slicer_io::pack::pack(&pack_inputs, &opts));

        finish_pack(&app, out_dir, atlas, started, &opts, &json_opts, "pack-done");
    });
}

/// 预览合成结果：打包到临时目录，只发 `pack-preview`，不碰正式输出目录。
#[tauri::command]
pub fn preview_pack(
    app: AppHandle,
    inputs: Vec<String>,
    opts: PackOptions,
    layout: JsonLayout,
    recursive: bool,
) {
    let json_opts = JsonOptions {
        layout,
        ..Default::default()
    };

    std::thread::spawn(move || {
        let started = Instant::now();
        let preview_root =
            std::env::temp_dir().join(format!("pdf-workbench-preview-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&preview_root);
        let _ = std::fs::create_dir_all(&preview_root);

        let paths: Vec<PathBuf> = inputs.into_iter().map(PathBuf::from).collect();
        let atlas = slicer_io::load_pack_inputs(&paths, recursive)
            .and_then(|pack_inputs| slicer_io::pack::pack(&pack_inputs, &opts));

        finish_pack(
            &app,
            preview_root.to_string_lossy().to_string(),
            atlas,
            started,
            &opts,
            &json_opts,
            "pack-preview",
        );
    });
}
/// 重排当前图集。
///
/// **关键：使用的是前端传来的矩形，后端绝不重新检测。**
///
/// 之前这里走的是"后端自己用默认参数再检测一遍"，后果是：
/// 用户在侧栏调过的 Alpha 阈值 / 最小像素数 / 腐蚀次数**全部失效**，
/// 被过滤掉的噪点重新出现在结果里。契约和 `export_sprites` 一致——
/// **前端是最终结果的唯一来源**，后端只负责按给定矩形裁图与装箱。
#[tauri::command]
pub fn repack_sheet(
    app: AppHandle,
    sprites: Vec<SpriteOut>,
    out_dir: String,
    prefix: String,
    opts: PackOptions,
    layout: JsonLayout,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let json_opts = JsonOptions {
        layout,
        ..Default::default()
    };

    // 裁剪需要持有图集锁，所以**先同步做完**——它只是逐块的 memcpy，很快。
    // 这样就不必把那 64MB 的图集 clone 一份塞进线程里。
    let inputs: Vec<PackInput> = {
        let guard = state.sheet.lock().map_err(|_| "内部状态锁异常")?;
        let sheet = guard.as_ref().ok_or("还没有打开图集")?;
        slicer_io::pack_inputs_from_rects(sheet, &sprites, &prefix)?
    };

    let started = Instant::now();
    std::thread::spawn(move || {
        let atlas = slicer_io::pack::pack(&inputs, &opts);
        finish_pack(&app, out_dir, atlas, started, &opts, &json_opts, "pack-done");
    });

    Ok(())
}

/// 读一个"文件列表"（每行一个路径的 txt，或 JSON 字符串数组）。
///
/// 界面上暂时没有入口（已被「选择文件夹切图」取代），命令保留着备用。
#[tauri::command]
pub fn read_path_list(path: String) -> Result<Vec<String>, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("无法读取文件列表：{e}"))?;

    // 先按 JSON 数组试，失败再按"每行一个路径"解析
    if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(&text) {
        let list: Vec<String> = items
            .into_iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !list.is_empty() {
            return Ok(list);
        }
    }

    let list: Vec<String> = text
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.to_string())
        .collect();

    if list.is_empty() {
        return Err("文件列表是空的".into());
    }
    Ok(list)
}
