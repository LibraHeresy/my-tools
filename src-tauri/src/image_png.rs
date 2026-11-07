//! 图片转 PNG：批量把纯色背景变成透明通道。
//!
//! 这里只做两件事：分析边缘候选背景色，以及按颜色阈值 + 羽化写入 PNG。
//! 不做 AI 抠图，复杂背景不会被准确分离。

use image::{ImageFormat, ImageReader, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub hex: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundCandidate {
    #[serde(flatten)]
    pub color: BackgroundColor,
    pub coverage: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAnalysis {
    pub path: String,
    pub file_name: String,
    pub width: u32,
    pub height: u32,
    pub candidates: Vec<BackgroundCandidate>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveOptions {
    /// `uniform` 使用 color，`auto` 每张图自行检测背景。
    pub mode: String,
    pub color: BackgroundColorInput,
    pub tolerance: u8,
    pub feather: u8,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundColorInput {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub background: BackgroundColor,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertFileReport {
    pub name: String,
    pub path: String,
    pub out_path: String,
    pub width: u32,
    pub height: u32,
    pub background: BackgroundColor,
    pub elapsed_ms: u128,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertProgress {
    pub index: usize,
    pub total: usize,
    pub name: String,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertReport {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub elapsed_ms: u128,
    pub files: Vec<ConvertFileReport>,
}

fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTENSIONS.iter().any(|item| ext.eq_ignore_ascii_case(item)))
        .unwrap_or(false)
}

fn collect_images(path: &Path, out: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>) {
    if path.is_file() {
        if is_image_path(path) {
            let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
            if seen.insert(canonical) {
                out.push(path.to_path_buf());
            }
        }
        return;
    }
    if !path.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    let mut children: Vec<PathBuf> = entries.filter_map(|entry| entry.ok().map(|e| e.path())).collect();
    children.sort();
    for child in children {
        collect_images(&child, out, seen);
    }
}

fn hex_of(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn color_of(r: u8, g: u8, b: u8) -> BackgroundColor {
    BackgroundColor {
        r,
        g,
        b,
        hex: hex_of(r, g, b),
    }
}

fn border_candidates(img: &RgbaImage) -> Vec<BackgroundCandidate> {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return Vec::new();
    }
    let strip = 3.min(w).min(h);
    let mut bins: HashMap<(u8, u8, u8), (u64, u64, u64, u64)> = HashMap::new();
    let mut sample = |x: u32, y: u32| {
        let px = img.get_pixel(x, y).0;
        if px[3] == 0 {
            return;
        }
        let key = (px[0] >> 4, px[1] >> 4, px[2] >> 4);
        let entry = bins.entry(key).or_insert((0, 0, 0, 0));
        entry.0 += 1;
        entry.1 += px[0] as u64;
        entry.2 += px[1] as u64;
        entry.3 += px[2] as u64;
    };
    for y in 0..h {
        for x in 0..strip {
            sample(x, y);
            sample(w - 1 - x, y);
        }
    }
    for x in 0..w {
        for y in 0..strip {
            sample(x, y);
            sample(x, h - 1 - y);
        }
    }

    let total: u64 = bins.values().map(|v| v.0).sum();
    if total == 0 {
        return Vec::new();
    }
    let mut ranked: Vec<_> = bins.into_values().collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    ranked
        .into_iter()
        .take(6)
        .map(|(count, sum_r, sum_g, sum_b)| {
            let r = (sum_r / count) as u8;
            let g = (sum_g / count) as u8;
            let b = (sum_b / count) as u8;
            BackgroundCandidate {
                color: color_of(r, g, b),
                coverage: (count as f32 / total as f32 * 100.0 * 10.0).round() / 10.0,
            }
        })
        .collect()
}

fn dominant_border_color(img: &RgbaImage) -> BackgroundColor {
    border_candidates(img)
        .into_iter()
        .next()
        .map(|item| item.color)
        .unwrap_or_else(|| color_of(255, 255, 255))
}

fn apply_transparency(
    img: &mut RgbaImage,
    bg: &BackgroundColor,
    tolerance: u8,
    feather: u8,
) {
    let tolerance = tolerance as f32;
    let feather = feather as f32;
    for pixel in img.pixels_mut() {
        let [r, g, b, a] = pixel.0;
        if a == 0 {
            continue;
        }
        let distance = (r as f32 - bg.r as f32)
            .abs()
            .max((g as f32 - bg.g as f32).abs())
            .max((b as f32 - bg.b as f32).abs());
        let keep = if distance <= tolerance {
            0.0
        } else if feather > 0.0 && distance < tolerance + feather {
            let t = (distance - tolerance) / feather;
            t.clamp(0.0, 1.0)
        } else {
            1.0
        };
        pixel.0[3] = (a as f32 * keep).round() as u8;
    }
}

fn load_rgba(path: &Path) -> Result<RgbaImage, String> {
    let reader = ImageReader::open(path)
        .map_err(|e| format!("无法打开 {}：{e}", path.display()))?
        .with_guessed_format()
        .map_err(|e| format!("无法识别图片格式：{e}"))?;
    let image = reader
        .decode()
        .map_err(|e| format!("无法解码 {}：{e}", path.display()))?;
    Ok(image.to_rgba8())
}

fn background_for(img: &RgbaImage, options: &RemoveOptions) -> BackgroundColor {
    if options.mode == "auto" {
        dominant_border_color(img)
    } else {
        color_of(options.color.r, options.color.g, options.color.b)
    }
}

fn preview_file_path() -> PathBuf {
    let temp = std::env::temp_dir();
    if let Ok(entries) = std::fs::read_dir(&temp) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("pdf-workbench-image-preview-") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    temp.join(format!(
        "pdf-workbench-image-preview-{}-{stamp}.png",
        std::process::id()
    ))
}

fn remove_background(
    img: &mut RgbaImage,
    options: &RemoveOptions,
) -> BackgroundColor {
    let bg = background_for(img, options);
    apply_transparency(img, &bg, options.tolerance, options.feather);
    bg
}

#[tauri::command]
pub fn analyze_image(path: String) -> Result<ImageAnalysis, String> {
    let file_path = PathBuf::from(&path);
    let img = load_rgba(&file_path)?;
    let (width, height) = img.dimensions();
    Ok(ImageAnalysis {
        path,
        file_name: file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_string(),
        width,
        height,
        candidates: border_candidates(&img),
    })
}

#[tauri::command]
pub async fn preview_image(path: String, options: RemoveOptions) -> Result<PreviewResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let original = load_rgba(Path::new(&path))?;
        let (original_width, original_height) = original.dimensions();
        let background = background_for(&original, &options);
        let mut img = original;
        apply_transparency(&mut img, &background, options.tolerance, options.feather);
        let (ow, oh) = img.dimensions();
        let scale = (900.0 / ow.max(1) as f32)
            .min(900.0 / oh.max(1) as f32)
            .min(1.0);
        let width = (ow as f32 * scale).round().max(1.0) as u32;
        let height = (oh as f32 * scale).round().max(1.0) as u32;
        let preview = image::imageops::resize(
            &img,
            width,
            height,
            image::imageops::FilterType::Lanczos3,
        );
        let (width, height) = preview.dimensions();
        let preview_path = preview_file_path();
        preview
            .save_with_format(&preview_path, ImageFormat::Png)
            .map_err(|e| format!("无法写入预览：{e}"))?;
        Ok(PreviewResult {
            path: preview_path.to_string_lossy().to_string(),
            width,
            height,
            original_width,
            original_height,
            background,
        })
    })
    .await
    .map_err(|e| format!("预览任务失败：{e}"))?
}

fn unique_output_path(out_dir: &Path, stem: &str, used: &mut HashSet<String>) -> PathBuf {
    let mut index = 0usize;
    loop {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("-{index}")
        };
        let name = format!("{stem}{suffix}.png");
        if !used.contains(&name) && !out_dir.join(&name).exists() {
            used.insert(name.clone());
            return out_dir.join(name);
        }
        index += 1;
    }
}

fn convert_one(
    path: &Path,
    out_dir: &Path,
    options: &RemoveOptions,
    used: &mut HashSet<String>,
) -> Result<ConvertFileReport, String> {
    let started = Instant::now();
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("image");
    let mut img = load_rgba(path)?;
    let (width, height) = img.dimensions();
    let background = remove_background(&mut img, options);
    let out_path = unique_output_path(out_dir, stem, used);
    img.save_with_format(&out_path, ImageFormat::Png)
        .map_err(|e| format!("无法写入 {}：{e}", out_path.display()))?;
    Ok(ConvertFileReport {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        out_path: out_path.to_string_lossy().to_string(),
        width,
        height,
        background,
        elapsed_ms: started.elapsed().as_millis(),
        error: None,
    })
}

#[tauri::command]
pub fn convert_images(
    app: AppHandle,
    inputs: Vec<String>,
    out_dir: String,
    options: RemoveOptions,
) {
    std::thread::spawn(move || {
        let started = Instant::now();
        let out = PathBuf::from(&out_dir);
        let _ = std::fs::create_dir_all(&out);

        let mut paths = Vec::new();
        let mut seen = HashSet::new();
        for input in &inputs {
            collect_images(Path::new(input), &mut paths, &mut seen);
        }

        let total = paths.len();
        let mut used = HashSet::new();
        let mut files = Vec::with_capacity(total);
        let mut succeeded = 0;
        let mut failed = 0;

        for (index, path) in paths.iter().enumerate() {
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("image")
                .to_string();
            let report = match convert_one(path, &out, &options, &mut used) {
                Ok(report) => {
                    succeeded += 1;
                    report
                }
                Err(error) => {
                    failed += 1;
                    ConvertFileReport {
                        name: name.clone(),
                        path: path.to_string_lossy().to_string(),
                        out_path: String::new(),
                        width: 0,
                        height: 0,
                        background: color_of(255, 255, 255),
                        elapsed_ms: 0,
                        error: Some(error),
                    }
                }
            };
            let _ = app.emit(
                "image-progress",
                ConvertProgress {
                    index: index + 1,
                    total,
                    name,
                    error: report.error.clone(),
                },
            );
            files.push(report);
        }

        let _ = app.emit(
            "image-done",
            ConvertReport {
                total,
                succeeded,
                failed,
                elapsed_ms: started.elapsed().as_millis(),
                files,
            },
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn pixel(img: &RgbaImage, x: u32, y: u32) -> [u8; 4] {
        img.get_pixel(x, y).0
    }

    #[test]
    fn uniform_background_becomes_transparent() {
        let mut img = RgbaImage::from_pixel(4, 4, Rgba([255, 255, 255, 255]));
        img.put_pixel(1, 1, Rgba([220, 40, 30, 255]));
        let options = RemoveOptions {
            mode: "uniform".to_string(),
            color: BackgroundColorInput {
                r: 255,
                g: 255,
                b: 255,
            },
            tolerance: 12,
            feather: 0,
        };
        let bg = remove_background(&mut img, &options);
        assert_eq!(bg.hex, "#ffffff");
        assert_eq!(pixel(&img, 0, 0)[3], 0);
        assert_eq!(pixel(&img, 1, 1), [220, 40, 30, 255]);
    }

    #[test]
    fn feather_keeps_soft_edge() {
        let mut img = RgbaImage::from_pixel(3, 1, Rgba([255, 255, 255, 255]));
        img.put_pixel(1, 0, Rgba([240, 240, 240, 255]));
        img.put_pixel(2, 0, Rgba([0, 0, 0, 255]));
        let options = RemoveOptions {
            mode: "uniform".to_string(),
            color: BackgroundColorInput {
                r: 255,
                g: 255,
                b: 255,
            },
            tolerance: 0,
            feather: 30,
        };
        let bg = background_for(&img, &options);
        apply_transparency(&mut img, &bg, options.tolerance, options.feather);
        assert!(pixel(&img, 1, 0)[3] > 0);
        assert!(pixel(&img, 1, 0)[3] < 255);
        assert_eq!(pixel(&img, 2, 0)[3], 255);
    }

    #[test]
    fn edge_candidate_is_reported() {
        let mut img = RgbaImage::from_pixel(20, 20, Rgba([250, 245, 235, 255]));
        for y in 5..15 {
            for x in 5..15 {
                img.put_pixel(x, y, Rgba([30, 100, 200, 255]));
            }
        }
        let candidates = border_candidates(&img);
        assert!(!candidates.is_empty());
        assert_eq!(candidates[0].color.hex, "#faf5eb");
    }
}
