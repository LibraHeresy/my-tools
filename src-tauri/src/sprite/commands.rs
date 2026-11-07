//! Tauri 命令层。
//!
//! 这里**只做三件事**：持有已解码的图集、调用 `slicer-io`、把结果原样返回。
//! 任何解码、检测、裁剪、导出的逻辑都不许写在这一层——
//! 它们全部住在 `slicer-io` 里，GUI 和 CLI 共用同一份实现。

use serde::Serialize;
use slicer_io::{Sheet, SliceOptions, SpriteOut};
use std::path::Path;
use std::sync::Mutex;

/// 已解码并常驻内存的图集。
///
/// 缓存它是为了"改一个参数就重跑检测"这个核心交互——否则每拖一次滑块
/// 都要重新解码一次 4096² 的 PNG。
pub struct AppState {
    pub sheet: Mutex<Option<Sheet>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetInfo {
    pub path: String,
    pub file_name: String,
    pub width: u32,
    pub height: u32,
}

/// 打开并解码一张 PNG 图集，结果常驻内存。
#[tauri::command]
pub fn open_sheet(path: String, state: tauri::State<'_, AppState>) -> Result<SheetInfo, String> {
    let sheet = slicer_io::decode_png(Path::new(&path))?;

    let info = SheetInfo {
        path: path.clone(),
        file_name: sheet.file_name.clone(),
        width: sheet.width(),
        height: sheet.height(),
    };

    *state.sheet.lock().map_err(|_| "内部状态锁异常")? = Some(sheet);

    Ok(info)
}

/// 在当前图集上跑一次检测。参数全部来自前端，可实时调整。
#[tauri::command]
pub fn detect_sprites(
    opts: SliceOptions,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SpriteOut>, String> {
    let guard = state.sheet.lock().map_err(|_| "内部状态锁异常")?;
    let sheet = guard.as_ref().ok_or("还没有打开图集")?;

    slicer_io::detect_rects(sheet, &opts)
}
