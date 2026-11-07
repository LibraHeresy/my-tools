use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri_plugin_fs::FsExt;

mod image_png;
mod sprite;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedImport {
    parent: String,
    name: String,
    size: u64,
}

fn non_empty_str(value: &str, message: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(message.to_string())
    } else {
        Ok(())
    }
}

/// Extends the runtime filesystem scope for a PDF selected outside the built-in
/// dialog (drag & drop). It also exposes the containing directory so the default
/// output location can be the same folder as the source file.
#[tauri::command]
fn prepare_import(app: tauri::AppHandle, path: String) -> Result<PreparedImport, String> {
    non_empty_str(&path, "文件路径为空")?;
    let file_path = PathBuf::from(&path);

    let metadata = std::fs::metadata(&file_path).map_err(|err| format!("无法读取文件信息：{err}"))?;
    if !metadata.is_file() {
        return Err("请选择一个 PDF 文件".to_string());
    }

    let is_pdf = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err("请选择 PDF 文件".to_string());
    }

    let parent = file_path
        .parent()
        .ok_or_else(|| "无法确定文件所在目录".to_string())?;
    let name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "无法读取文件名".to_string())?
        .to_string();

    let scope = app.fs_scope();
    scope
        .allow_file(&file_path)
        .map_err(|err| format!("无法授权读取文件：{err}"))?;
    scope
        .allow_directory(parent, false)
        .map_err(|err| format!("无法授权写入源目录：{err}"))?;

    Ok(PreparedImport {
        parent: parent.to_string_lossy().into_owned(),
        name,
        size: metadata.len(),
    })
}

/// Opens a folder in the system file manager. Kept as a Rust command so the
/// webview does not need a broad shell/opener scope.
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    non_empty_str(&path, "目录路径为空")?;
    let folder = Path::new(&path);
    if !folder.is_dir() {
        return Err("输出目录不存在".to_string());
    }

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(folder).spawn();

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(folder).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(folder).spawn();

    result
        .map(|_| ())
        .map_err(|err| format!("无法打开输出目录：{err}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sprite::commands::AppState {
            sheet: Mutex::new(None),
        })
        .manage(image_png::PreviewState::default())
        .invoke_handler(tauri::generate_handler![
            prepare_import,
            open_folder,
            image_png::analyze_image,
            image_png::preview_image,
            image_png::preview_image_full,
            image_png::preview_images,
            image_png::convert_images,
            image_png::list_images,
            sprite::commands::open_sheet,
            sprite::commands::detect_sprites,
            sprite::export::export_sprites,
            sprite::jobs::pack_images,
            sprite::jobs::preview_pack,
            sprite::jobs::repack_sheet,
            sprite::jobs::read_path_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
