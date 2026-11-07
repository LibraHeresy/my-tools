//! # slicer-io
//!
//! 把 `slicer-core`（纯算法）和真实文件系统接起来：解码、导出、批量处理。
//!
//! **这一层是 GUI 和 CLI 的唯一共享实现。** 两者都不应该自己写解码或裁剪逻辑——
//! 否则行为迟早会分叉（比如 GUI 支持了 padding 而 CLI 忘了）。

pub mod atlas;
pub mod pack;

pub use atlas::{Atlas, AtlasFrame, AtlasPage, JsonLayout, JsonOptions, RectI, SizeI};
pub use pack::{pack, plan_atlas_dir, write_atlas, PackInput, PackOptions, PackSort};

use serde::{Deserialize, Serialize};
use slicer_core::{detect, Connectivity, DetectOptions, Image, SortMode};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

// ───────────────────────────── 参数 ─────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectivitySpec {
    Four,
    Eight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum SortSpec {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "rowMajor")]
    RowMajor,
}

/// 与前端 `DetectOptions` 一一对应。
///
/// `#[serde(default)]` 让缺字段自动取默认值——前端将来少传一个字段不会导致反序列化失败。
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SliceOptions {
    pub alpha_threshold: u8,
    pub connectivity: ConnectivitySpec,
    pub min_area: u32,
    pub min_size: u32,
    pub erode_iterations: u8,
    pub merge_gap: u32,
    pub padding: u32,
    pub sort: SortSpec,
}

impl Default for SliceOptions {
    fn default() -> Self {
        Self {
            alpha_threshold: 1,
            connectivity: ConnectivitySpec::Eight,
            min_area: 4,
            min_size: 1,
            erode_iterations: 0,
            merge_gap: 0,
            padding: 0,
            sort: SortSpec::RowMajor,
        }
    }
}

/// 导出命名选项。
///
/// 存在的理由是**防重**：以前切图固定叫 `sprite_0000.png`、图集固定叫 `atlas.png`，
/// 于是两张图集导出到同一个目录就会互相覆盖——连用户自己原有的素材也可能被冲掉。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportOptions {
    /// 切图文件名前缀。默认 `sprite_` → `sprite_0000.png`。
    pub prefix: String,
    /// 序号位数（左侧补零）。默认 4。
    pub digits: usize,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            prefix: "sprite_".into(),
            digits: 4,
        }
    }
}

impl ExportOptions {
    /// 第 `index` 张切图的文件名。
    pub fn sprite_file_name(&self, index: u32) -> String {
        format!(
            "{}{:0width$}.png",
            self.prefix,
            index,
            width = self.digits.clamp(1, 8)
        )
    }
}

/// 批量切图的完整参数。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BatchOptions {
    pub slice: SliceOptions,
    pub export: ExportOptions,
    /// 只检测不写文件。
    pub dry_run: bool,
    /// 目录是否递归展开。
    pub recursive: bool,
}

impl Default for BatchOptions {
    fn default() -> Self {
        Self {
            slice: SliceOptions::default(),
            export: ExportOptions::default(),
            dry_run: false,
            recursive: true,
        }
    }
}

impl From<&SliceOptions> for DetectOptions {
    fn from(o: &SliceOptions) -> Self {
        DetectOptions {
            alpha_threshold: o.alpha_threshold,
            connectivity: match o.connectivity {
                ConnectivitySpec::Four => Connectivity::Four,
                ConnectivitySpec::Eight => Connectivity::Eight,
            },
            min_area: o.min_area,
            min_size: o.min_size,
            erode_iterations: o.erode_iterations,
            merge_gap: o.merge_gap,
            padding: o.padding,
            sort: match o.sort {
                SortSpec::None => SortMode::None,
                SortSpec::RowMajor => SortMode::RowMajor,
            },
        }
    }
}

// ───────────────────────────── 数据 ─────────────────────────────

/// 一张已解码的图集。
///
/// 直接持有 `RgbaImage` 而不是 `Vec<u8>`：检测时借用它的 raw 缓冲，
/// 裁剪时直接 `crop_imm`，**全程不需要克隆那 64MB**。
pub struct Sheet {
    pub path: PathBuf,
    pub file_name: String,
    pub image: image::RgbaImage,
}

impl Sheet {
    pub fn width(&self) -> u32 {
        self.image.width()
    }

    pub fn height(&self) -> u32 {
        self.image.height()
    }

    pub fn stem(&self) -> String {
        self.path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "sheet".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteOut {
    pub id: u32,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    #[serde(default)]
    pub pixels: u32,
    #[serde(default)]
    pub excluded: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub dir: String,
    pub written: usize,
    pub skipped: usize,
    pub manifest_path: String,
}

/// 单张图的处理结果。批量验证准确率时，`detected` 就是你要盯的那个数。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReport {
    pub name: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub detected: usize,
    pub written: usize,
    pub skipped: usize,
    pub out_dir: String,
    pub elapsed_ms: u128,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchReport {
    pub out_root: String,
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub total_detected: usize,
    pub elapsed_ms: u128,
    pub report_path: Option<String>,
    pub files: Vec<FileReport>,
}

// ───────────────────────────── 单张 ─────────────────────────────

pub fn decode_png(path: &Path) -> Result<Sheet, String> {
    let decoded = image::ImageReader::open(path)
        .map_err(|e| format!("无法打开文件：{e}"))?
        .with_guessed_format()
        .map_err(|e| format!("无法识别图片格式：{e}"))?
        .decode()
        .map_err(|e| format!("无法解码（本版本只支持 PNG）：{e}"))?;

    let image = decoded.to_rgba8();
    if image.width() == 0 || image.height() == 0 {
        return Err("图片尺寸为 0".into());
    }

    Ok(Sheet {
        path: path.to_path_buf(),
        file_name: path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "sheet.png".into()),
        image,
    })
}

pub fn detect_rects(sheet: &Sheet, opts: &SliceOptions) -> Result<Vec<SpriteOut>, String> {
    let img = Image::new(sheet.width(), sheet.height(), sheet.image.as_raw())
        .map_err(|e| e.to_string())?;
    let core_opts: DetectOptions = opts.into();

    Ok(detect(&img, &core_opts)
        .into_iter()
        .map(|s| SpriteOut {
            id: s.index,
            x: s.rect.x,
            y: s.rect.y,
            w: s.rect.w,
            h: s.rect.h,
            pixels: s.pixels,
            excluded: false,
        })
        .collect())
}

/// 为一张图集规划输出子目录：`<根>/<源文件名>`，撞名就追加 `_2`、`_3`。
///
/// **每张图集独占一个子目录**是防重的第一道防线：
/// 不同图集的产出永远不会落在同一层，也就不会互相覆盖。
pub fn plan_output_dir(out_root: &Path, sheet: &Sheet, used: &mut HashSet<String>) -> PathBuf {
    let base = sheet.stem();
    let mut name = base.clone();
    let mut n = 2;

    while used.contains(&name) {
        name = format!("{base}_{n}");
        n += 1;
    }
    used.insert(name.clone());

    out_root.join(name)
}

/// 找出 `dir` 里**不属于本工具产出规则**的文件（相对路径）。
///
/// 本工具的产出只有这几样：
/// - 顶层 `<源文件名>.png`（原图副本）
/// - 顶层 `<源文件名>.json`（TexturePacker 描述文件）
/// - `sprites/` 目录，以及它下面的 `*.png`
///
/// 只要出现别的东西，就说明这个目录不是我们的地盘——绝不能往里写，
/// 否则就可能像以前那样把用户的原有资源冲掉。目录不存在时返回空（首次导出）。
fn find_foreign_files(dir: &Path, stem: &str) -> Result<Vec<String>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut foreign: Vec<String> = Vec::new();
    let allowed_png = format!("{stem}.png");
    let allowed_json = format!("{stem}.json");

    let entries = std::fs::read_dir(dir).map_err(|e| format!("无法读取输出目录：{e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("无法读取输出目录：{e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();

        if path.is_dir() {
            if name == "sprites" {
                let sub_entries =
                    std::fs::read_dir(&path).map_err(|e| format!("无法读取 sprites/：{e}"))?;
                for sub in sub_entries {
                    let sub = sub.map_err(|e| format!("无法读取 sprites/：{e}"))?;
                    let sub_name = sub.file_name().to_string_lossy().to_string();
                    if !sub_name.to_ascii_lowercase().ends_with(".png") {
                        foreign.push(format!("sprites/{sub_name}"));
                    }
                }
            } else {
                foreign.push(format!("{name}/"));
            }
            continue;
        }

        if name != allowed_png && name != allowed_json {
            foreign.push(name);
        }
    }

    foreign.sort();
    Ok(foreign)
}

/// 按给定矩形裁剪并写出 PNG，同时产出一份 TexturePacker JSON。
///
/// `sprites` 来自调用方（GUI 里是用户界面上的最终结果），**这里不会重新检测**。
/// `out_dir` 是**这张图集自己的输出目录**，由调用方用 `plan_output_dir` 算好。
///
/// 布局：
///
/// ```text
/// <out_dir>/
///   <源文件名>.png       ← 原图副本（字节等价，用 fs::copy 不做重编码）
///   <源文件名>.json      ← TexturePacker JSON，meta.image 指向上面那张图
///   sprites/
///     <前缀>0000.png     ← 切图，前缀可自定义
/// ```
///
/// **两道防重**：
/// 1. 每张图集独占一个子目录（调用方保证）→ 不同图集不会撞名
/// 2. 写入前检查目录里有没有"不是我们写的"文件 → **有就拒绝，一个字节都不写**
pub fn export_sheet(
    sheet: &Sheet,
    sprites: &[SpriteOut],
    out_dir: &Path,
    opts: &ExportOptions,
) -> Result<ExportResult, String> {
    let stem = sheet.stem();
    let sprites_dir = out_dir.join("sprites");

    // 防重第二道：这个目录不是空的、而且装的是别人的东西，就直接拒绝
    let foreign = find_foreign_files(out_dir, &stem)?;
    if !foreign.is_empty() {
        let preview: Vec<String> = foreign.iter().take(5).cloned().collect();
        let more = if foreign.len() > preview.len() {
            format!(" 等 {} 个", foreign.len())
        } else {
            String::new()
        };
        return Err(format!(
            "输出目录 `{}` 里已有本工具之外的文件（{}），已中止，未写入任何内容。请换一个输出目录。",
            out_dir.display(),
            format!("{}{more}", preview.join("、"))
        ));
    }

    std::fs::create_dir_all(&sprites_dir).map_err(|e| format!("无法创建输出目录：{e}"))?;

    let (sw, sh) = (sheet.width(), sheet.height());
    let mut frames: Vec<AtlasFrame> = Vec::new();
    let mut written = 0usize;
    let mut skipped = 0usize;

    for s in sprites {
        if s.excluded || s.w == 0 || s.h == 0 {
            skipped += 1;
            continue;
        }

        // 裁剪到图像范围内，避免手动拖出边界的框导致 panic
        let x = s.x.min(sw.saturating_sub(1));
        let y = s.y.min(sh.saturating_sub(1));
        let w = s.w.min(sw - x);
        let h = s.h.min(sh - y);
        if w == 0 || h == 0 {
            skipped += 1;
            continue;
        }

        let name = opts.sprite_file_name(s.id);
        let cropped = image::imageops::crop_imm(&sheet.image, x, y, w, h).to_image();
        cropped
            .save_with_format(sprites_dir.join(&name), image::ImageFormat::Png)
            .map_err(|e| format!("写入 {name} 失败：{e}"))?;

        // 切片方向没有裁剪，所以 spriteSourceSize 从 (0,0) 开始、尺寸等于 frame
        frames.push(AtlasFrame {
            filename: name,
            frame: RectI::new(x as i32, y as i32, w as i32, h as i32),
            rotated: false,
            trimmed: false,
            sprite_source_size: RectI::new(0, 0, w as i32, h as i32),
            source_size: SizeI {
                w: w as i32,
                h: h as i32,
            },
        });
        written += 1;
    }

    // 复制原图而不是重新编码：字节等价、瞬时完成。
    // 4096² 重新编码要好几秒，批量 20 张就是一分多钟的纯浪费。
    let atlas_png = format!("{stem}.png");
    std::fs::copy(&sheet.path, out_dir.join(&atlas_png))
        .map_err(|e| format!("复制原图失败：{e}"))?;

    let manifest_path = out_dir.join(format!("{stem}.json"));
    atlas::write_page_json(
        &manifest_path,
        &atlas_png,
        sw,
        sh,
        &frames,
        &JsonOptions::default(),
    )?;

    Ok(ExportResult {
        dir: out_dir.to_string_lossy().to_string(),
        written,
        skipped,
        manifest_path: manifest_path.to_string_lossy().to_string(),
    })
}

// ───────────────────────────── 批量 ─────────────────────────────

/// 从磁盘读一组图片作为打包输入。目录会被展开为其中的 PNG。
///
/// 帧名就用文件名——打包时最自然的命名方式。**同名会被去重**（追加 `_2`、`_3`），
/// 否则 Hash 布局的 TexturePacker JSON 会因为键冲突丢掉帧。
pub fn load_pack_inputs(paths: &[PathBuf], recursive: bool) -> Result<Vec<pack::PackInput>, String> {
    let files = expand_inputs(paths, recursive)?;
    let mut inputs: Vec<pack::PackInput> = Vec::with_capacity(files.len());
    let mut used = HashSet::new();

    for path in &files {
        let sheet = decode_png(path)?;

        let mut name = sheet.file_name.clone();
        if used.contains(&name) {
            let stem = name
                .rsplit_once('.')
                .map(|(s, _)| s.to_string())
                .unwrap_or_else(|| name.clone());
            let mut n = 2;
            loop {
                let candidate = format!("{stem}_{n}.png");
                if !used.contains(&candidate) {
                    name = candidate;
                    break;
                }
                n += 1;
            }
        }
        used.insert(name.clone());

        inputs.push(pack::PackInput {
            name,
            image: sheet.image,
        });
    }

    Ok(inputs)
}

/// 把图集里的这些矩形裁出来，作为打包输入。
///
/// **完全以传入的矩形为准**——这正是不重新检测的意义所在：
/// 用户在界面上调过参数（Alpha 阈值、最小像素数……）、排除了噪点，
/// 重排就必须尊重那个结果，而不是拿默认参数再猜一遍。
///
/// `excluded` 为真的矩形会被跳过。
/// `prefix` 是帧名前缀（与切图共用同一套命名选项）。
pub fn pack_inputs_from_rects(
    sheet: &Sheet,
    rects: &[SpriteOut],
    prefix: &str,
) -> Result<Vec<pack::PackInput>, String> {
    let (sw, sh) = (sheet.width(), sheet.height());
    let mut inputs: Vec<pack::PackInput> = Vec::new();

    for s in rects {
        if s.excluded || s.w == 0 || s.h == 0 {
            continue;
        }

        // 裁剪到图像范围内，防止越界的框导致 panic
        let x = s.x.min(sw.saturating_sub(1));
        let y = s.y.min(sh.saturating_sub(1));
        let w = s.w.min(sw - x);
        let h = s.h.min(sh - y);
        if w == 0 || h == 0 {
            continue;
        }

        inputs.push(pack::PackInput::from_region(
            &sheet.image,
            x,
            y,
            w,
            h,
            format!("{prefix}{:04}.png", s.id),
        ));
    }

    if inputs.is_empty() {
        return Err("没有可重排的精灵（可能全部被排除了）".into());
    }
    Ok(inputs)
}

/// 先检测、再打包——把一张排布松散的图集重排得更紧凑。
///
/// 这是**命令行**那条路径（没有交互状态，只能自己检测一遍）。
/// GUI 走的是 `pack_inputs_from_rects`，用的是用户界面上那份矩形。
pub fn repack_sheet(
    sheet: &Sheet,
    slice_opts: &SliceOptions,
    pack_opts: &PackOptions,
    export_opts: &ExportOptions,
) -> Result<Atlas, String> {
    let rects = detect_rects(sheet, slice_opts)?;
    if rects.is_empty() {
        return Err("这张图里没有检测到任何精灵".into());
    }

    let inputs = pack_inputs_from_rects(sheet, &rects, &export_opts.prefix)?;
    pack::pack(&inputs, pack_opts)
}

/// 把输入展开成 PNG 文件列表。
///
/// 文件直接原样保留；目录会被展开为其中的 `*.png`。
/// `recursive = true` 时**连同子目录一起收集**——选文件夹切图时这才是符合直觉的行为，
/// 否则用户选了 `assets/` 而图集在 `assets/chapter1/` 里就会一张都找不到。
///
/// 同一个目录内**排序**，保证同一批输入的产出顺序稳定；子目录按名字排，
/// 整体是「本层文件 → 各子目录」的深度优先顺序。
pub fn expand_inputs(inputs: &[PathBuf], recursive: bool) -> Result<Vec<PathBuf>, String> {
    let mut out: Vec<PathBuf> = Vec::new();

    for input in inputs {
        if input.is_dir() {
            collect_pngs(input, recursive, &mut out)
                .map_err(|e| format!("无法读取目录 {}：{e}", input.display()))?;
        } else {
            out.push(input.clone());
        }
    }

    out.dedup();

    if out.is_empty() {
        return Err(if recursive {
            "没有找到任何 PNG 文件（已包含子目录）".into()
        } else {
            "没有找到任何 PNG 文件".into()
        });
    }
    Ok(out)
}

fn collect_pngs(dir: &Path, recursive: bool, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    let mut files: Vec<PathBuf> = Vec::new();
    let mut subdirs: Vec<PathBuf> = Vec::new();

    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            if recursive {
                subdirs.push(path);
            }
        } else if path
            .extension()
            .map(|x| x.to_string_lossy().eq_ignore_ascii_case("png"))
            .unwrap_or(false)
        {
            files.push(path);
        }
    }

    files.sort();
    out.extend(files);

    subdirs.sort();
    for sub in subdirs {
        collect_pngs(&sub, true, out)?;
    }

    Ok(())
}

/// 批量切图：每张图输出到 `out_root/<文件名去扩展>/`。
///
/// 单张失败不会中断整批——错误记在那一张的 `error` 字段里。这个选择是刻意的：
/// 批量处理 200 张图时，因为其中一张损坏就全部作废是不可接受的。
pub fn batch_slice<F>(inputs: &[PathBuf], out_root: &Path, opts: &BatchOptions, mut on_file: F) -> BatchReport
where
    F: FnMut(&FileReport),
{
    let started = Instant::now();
    let files = match expand_inputs(inputs, opts.recursive) {
        Ok(f) => f,
        Err(e) => {
            return BatchReport {
                out_root: out_root.to_string_lossy().to_string(),
                total: 0,
                succeeded: 0,
                failed: 0,
                total_detected: 0,
                elapsed_ms: started.elapsed().as_millis(),
                report_path: None,
                files: vec![FileReport {
                    name: String::new(),
                    path: String::new(),
                    width: 0,
                    height: 0,
                    detected: 0,
                    written: 0,
                    skipped: 0,
                    out_dir: String::new(),
                    elapsed_ms: 0,
                    error: Some(e),
                }],
            };
        }
    };

    let mut used_stems: HashSet<String> = HashSet::new();
    let mut reports: Vec<FileReport> = Vec::with_capacity(files.len());

    for path in &files {
        let t0 = Instant::now();
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let mut report = FileReport {
            name: name.clone(),
            path: path.to_string_lossy().to_string(),
            width: 0,
            height: 0,
            detected: 0,
            written: 0,
            skipped: 0,
            out_dir: String::new(),
            elapsed_ms: 0,
            error: None,
        };

        match decode_png(path).and_then(|sheet| {
            report.width = sheet.width();
            report.height = sheet.height();
            let rects = detect_rects(&sheet, &opts.slice)?;
            report.detected = rects.len();

            if opts.dry_run {
                Ok(())
            } else {
                // 每张图独占一个子目录；同名不同目录的输入靠 plan_output_dir 里的去重避免互相覆盖
                let dir = plan_output_dir(out_root, &sheet, &mut used_stems);
                let res = export_sheet(&sheet, &rects, &dir, &opts.export)?;
                report.written = res.written;
                report.skipped = res.skipped;
                report.out_dir = res.dir;
                Ok(())
            }
        }) {
            Ok(()) => {}
            Err(e) => report.error = Some(e),
        }

        report.elapsed_ms = t0.elapsed().as_millis();
        on_file(&report);
        reports.push(report);
    }

    let succeeded = reports.iter().filter(|r| r.error.is_none()).count();
    let failed = reports.len() - succeeded;
    let total_detected = reports.iter().map(|r| r.detected).sum();

    let mut out = BatchReport {
        out_root: out_root.to_string_lossy().to_string(),
        total: reports.len(),
        succeeded,
        failed,
        total_detected,
        elapsed_ms: started.elapsed().as_millis(),
        report_path: None,
        files: reports,
    };

    // 汇总报告：批量验证准确率时，这份 json 就是你要拿去核对的原始数据
    if !opts.dry_run {
        let report_path = out_root.join("batch-report.json");
        if std::fs::create_dir_all(out_root).is_ok() {
            if let Ok(json) = serde_json::to_string_pretty(&out) {
                if std::fs::write(&report_path, json).is_ok() {
                    out.report_path = Some(report_path.to_string_lossy().to_string());
                }
            }
        }
    }

    out
}
