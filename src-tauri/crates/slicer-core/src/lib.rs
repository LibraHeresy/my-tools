//! # slicer-core
//!
//! 从**带 alpha 通道**的精灵图集（sprite sheet）中自动圈出各个小图，输出矩形包围盒。
//!
//! 设计约束：
//! - **零依赖**：便于离线构建，也便于日后编成 WASM 给网页版复用。
//! - **不做 I/O**：输入是已解码的 RGBA8 缓冲，PNG 解码由上层负责。
//! - **不做 UI**：这一层可在 Tauri 命令、CLI、WASM 里原样复用。
//!
//! ## 算法流程
//!
//! ```text
//! alpha 二值化  →  [可选] 形态学腐蚀  →  连通域标记(并查集)
//!      →  包围盒膨胀补偿  →  统计像素  →  面积/尺寸过滤
//!      →  [可选] 按间隔合并  →  [可选] 阅读顺序排序  →  [可选] 外扩 padding
//! ```
//!
//! ## 默认参数面向的输入
//!
//! 带 alpha 的 PNG 图集、sprite 之间有透明间隔。这个前提下**默认参数就能切得很准**，
//! 腐蚀和合并是遇到脏数据时的逃生舱，不是常规路径。

pub mod components;
pub mod group;
pub mod mask;

pub use components::Connectivity;

use components::Component;

/// 轴对齐矩形。`x`/`y` 为左上角，`right()`/`bottom()` 为**开区间**边界。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

impl Rect {
    pub const fn new(x: u32, y: u32, w: u32, h: u32) -> Self {
        Self { x, y, w, h }
    }

    /// 右边界（不含）。
    pub const fn right(&self) -> u32 {
        self.x + self.w
    }

    /// 下边界（不含）。
    pub const fn bottom(&self) -> u32 {
        self.y + self.h
    }

    pub const fn is_empty(&self) -> bool {
        self.w == 0 || self.h == 0
    }

    pub const fn area(&self) -> u32 {
        self.w * self.h
    }

    /// 两个矩形之间的最短间隔（曼哈顿意义上的"空隙格数"）。
    /// 重叠或紧邻时返回 0。
    pub fn gap_to(&self, other: &Rect) -> u32 {
        let dx = if self.right() <= other.x {
            other.x - self.right()
        } else if other.right() <= self.x {
            self.x - other.right()
        } else {
            0
        };
        let dy = if self.bottom() <= other.y {
            other.y - self.bottom()
        } else if other.bottom() <= self.y {
            self.y - other.bottom()
        } else {
            0
        };
        dx.max(dy)
    }

    pub fn union(&self, other: &Rect) -> Rect {
        if self.is_empty() {
            return *other;
        }
        if other.is_empty() {
            return *self;
        }
        let x0 = self.x.min(other.x);
        let y0 = self.y.min(other.y);
        let x1 = self.right().max(other.right());
        let y1 = self.bottom().max(other.bottom());
        Rect::new(x0, y0, x1 - x0, y1 - y0)
    }

    /// 四边各向外扩 `n` 像素，并裁剪到图像范围内。
    pub fn dilate(&self, n: u32, image_w: u32, image_h: u32) -> Rect {
        if n == 0 || self.is_empty() {
            return *self;
        }
        let x0 = self.x.saturating_sub(n);
        let y0 = self.y.saturating_sub(n);
        let x1 = self.right().saturating_add(n).min(image_w);
        let y1 = self.bottom().saturating_add(n).min(image_h);
        Rect::new(x0, y0, x1.saturating_sub(x0), y1.saturating_sub(y0))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortMode {
    /// 保持连通域标记的原始顺序（不稳定，仅用于调试）。
    None,
    /// 从上到下、从左到右的阅读顺序。默认。
    RowMajor,
}

/// 检测参数。全部在 UI 上暴露为可调项。
#[derive(Debug, Clone, Copy)]
pub struct DetectOptions {
    /// alpha 严格大于此值才算前景。默认 1。
    /// 调高可排除淡淡的阴影/发光，代价是切掉抗锯齿边缘。
    pub alpha_threshold: u8,
    /// 连通性。默认 8 邻域。
    pub connectivity: Connectivity,
    /// 最小前景像素数，低于此值的连通域被丢弃（过滤噪点）。默认 4。
    /// 注意：开启腐蚀后按**腐蚀后**的像素数判断，小块会更容易被丢掉。
    pub min_area: u32,
    /// 包围盒最小边长。默认 1。
    pub min_size: u32,
    /// 3x3 腐蚀迭代次数。默认 0。
    /// 只在"两个 sprite 被阴影/抗锯齿粘在一起"时才需要调大。
    /// 包围盒会按相同像素数膨胀补偿，所以不会切边。
    pub erode_iterations: u8,
    /// 间隔小于此值的矩形会被合并。默认 0（从不合并）。
    /// 用于把被切碎的同一只 sprite 拼回来。
    pub merge_gap: u32,
    /// 导出时包围盒向外扩的像素数。默认 0。
    pub padding: u32,
    pub sort: SortMode,
}

impl Default for DetectOptions {
    fn default() -> Self {
        Self {
            alpha_threshold: 1,
            connectivity: Connectivity::Eight,
            min_area: 4,
            min_size: 1,
            erode_iterations: 0,
            merge_gap: 0,
            padding: 0,
            sort: SortMode::RowMajor,
        }
    }
}

/// 一张已解码的图像：RGBA8，行优先，`rgba.len() == width * height * 4`。
#[derive(Debug, Clone, Copy)]
pub struct Image<'a> {
    pub width: u32,
    pub height: u32,
    pub rgba: &'a [u8],
}

#[derive(Debug, PartialEq, Eq)]
pub enum DetectError {
    BufferSizeMismatch { expected: usize, actual: usize },
    EmptyImage,
}

impl std::fmt::Display for DetectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DetectError::BufferSizeMismatch { expected, actual } => write!(
                f,
                "RGBA 缓冲区大小不符：期望 {expected} 字节，实际 {actual} 字节"
            ),
            DetectError::EmptyImage => write!(f, "图像宽或高为 0"),
        }
    }
}

impl std::error::Error for DetectError {}

impl<'a> Image<'a> {
    pub fn new(width: u32, height: u32, rgba: &'a [u8]) -> Result<Self, DetectError> {
        if width == 0 || height == 0 {
            return Err(DetectError::EmptyImage);
        }
        let expected = width as usize * height as usize * 4;
        if rgba.len() != expected {
            return Err(DetectError::BufferSizeMismatch {
                expected,
                actual: rgba.len(),
            });
        }
        Ok(Self {
            width,
            height,
            rgba,
        })
    }
}

/// 一个检测结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sprite {
    /// 阅读顺序下的序号，从 0 开始。可直接用于命名 `sprite_0000`。
    pub index: u32,
    pub rect: Rect,
    /// 包围盒内的前景像素数（按**原始**掩码统计，不受腐蚀影响）。
    /// 用于展示"这只 sprite 有多少实体像素"，也是下游判断是否为噪声的依据。
    pub pixels: u32,
}

/// 执行一次检测。
///
/// 输入已经通过 `Image::new` 校验过尺寸，因此这里不会失败。
pub fn detect(img: &Image, opts: &DetectOptions) -> Vec<Sprite> {
    let w = img.width;
    let h = img.height;
    if w == 0 || h == 0 {
        return Vec::new();
    }

    // 1. 二值化
    let foreground = mask::build_mask(img.rgba, opts.alpha_threshold);

    // 2. 可选腐蚀（只为断开粘连，包围盒会在第 4 步补回来）
    let working = mask::erode(&foreground, w, h, opts.erode_iterations);

    // 3. 连通域标记
    let raw = components::label_components(&working, w, h, opts.connectivity);

    // 4. 膨胀补偿 + 用原始掩码统计真实像素数 + 过滤
    let mut comps: Vec<Component> = raw
        .into_iter()
        .map(|c| {
            let rect = c.rect.dilate(opts.erode_iterations as u32, w, h);
            let pixels = count_foreground(&foreground, w, rect);
            Component { rect, pixels }
        })
        .filter(|c| {
            c.pixels >= opts.min_area && c.rect.w >= opts.min_size && c.rect.h >= opts.min_size
        })
        .collect();

    // 5. 可选合并
    comps = group::merge_rects(comps, opts.merge_gap);

    // 6. 可选外扩
    if opts.padding > 0 {
        for c in &mut comps {
            c.rect = c.rect.dilate(opts.padding, w, h);
        }
    }

    // 7. 排序
    if opts.sort == SortMode::RowMajor {
        group::sort_row_major(&mut comps);
    }

    comps
        .into_iter()
        .enumerate()
        .map(|(i, c)| Sprite {
            index: i as u32,
            rect: c.rect,
            pixels: c.pixels,
        })
        .collect()
}

fn count_foreground(foreground: &[bool], stride: u32, rect: Rect) -> u32 {
    if rect.is_empty() {
        return 0;
    }
    let mut n = 0u32;
    for y in rect.y..rect.bottom() {
        let row = y as usize * stride as usize;
        for x in rect.x..rect.right() {
            if foreground[row + x as usize] {
                n += 1;
            }
        }
    }
    n
}
