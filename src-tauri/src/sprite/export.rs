//! 导出命令。
//!
//! 全部委托给 `slicer-io`——这一层不做任何图像处理，只负责算输出目录。

use crate::sprite::commands::AppState;
use slicer_io::{ExportOptions, ExportResult, SpriteOut};
use std::collections::HashSet;
use std::path::Path;

/// 导出精灵切图。
///
/// 两点契约：
///
/// 1. `sprites` 来自前端而不是后端重新检测——自动检测不可能 100% 准确，
///    用户会在界面上修补，导出必须以**界面的最终结果**为准。
/// 2. 输出落到 `<out_root>/<源文件名>/` 这个**专属子目录**里。
///    以前所有切图都平铺在所选目录、且图集固定叫 `atlas.png`，
///    于是两张图集导出到同一目录就会互相覆盖，甚至冲掉用户原有的素材。
///    现在不同图集各自独占一层；`export_sheet` 还会在写入前检查该目录里
///    有没有"不是本工具生成"的文件，有就整个中止，一个字节都不写。
#[tauri::command]
pub fn export_sprites(
    sprites: Vec<SpriteOut>,
    out_root: String,
    export_opts: ExportOptions,
    state: tauri::State<'_, AppState>,
) -> Result<ExportResult, String> {
    let guard = state.sheet.lock().map_err(|_| "内部状态锁异常")?;
    let sheet = guard.as_ref().ok_or("还没有打开图集")?;

    // 单张导出用的是新的空集合，所以目录名就是源文件名本身
    let mut used = HashSet::new();
    let dir = slicer_io::plan_output_dir(Path::new(&out_root), sheet, &mut used);

    slicer_io::export_sheet(sheet, &sprites, &dir, &export_opts)
}
