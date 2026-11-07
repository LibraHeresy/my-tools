//! 打包：多张图 → 一张图集 + 描述文件。
//!
//! 算法用 **Skyline bottom-left + 画布逐级放大**（TexturePacker / libGDX 同思路）：
//! 质量接近 MaxRects，实现量只有一半。质量不够再换 MaxRects。
//!
//! ## 两个刻意的设计
//!
//! **1. 打完后 shrink-wrap。** 逐级放大必然过冲（300×180 的内容可能先试到 512×512），
//! 所以成功之后按实际占用把画布收紧，避免输出一堆空白。
//!
//! **2. `extrude` 是必须的，不是可选优化。** 不做边缘外扩，GPU 双线性采样时
//! 每个精灵边缘都会吸到相邻精灵或透明像素，表现为黑边/杂色。
//! 这里的做法是把整块 sprite 区域放大一圈，用 **边缘像素钳位** 填充。

use crate::atlas::{page_file_names, Atlas, AtlasFrame, AtlasPage, JsonOptions, RectI, SizeI};
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PackSort {
    /// 按面积从大到小。默认，打包率通常最好。
    Area,
    /// 按最长边从大到小。
    MaxSide,
    Height,
    Width,
    Name,
    /// 保持输入顺序。
    None,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PackOptions {
    /// 相邻精灵之间的最小间隔（像素）。
    pub padding: u32,
    /// 边缘像素向外复制的圈数。**强烈建议 ≥1**。
    pub extrude: u32,
    /// 是否裁掉透明边。裁剪偏移会被完整记录到 `spriteSourceSize`。
    pub trim: bool,
    /// 单页边长上限。放不下会自动分多页。
    pub max_size: u32,
    /// 输出基础名，单页时产出 `atlas.png` / `atlas.json`。
    pub base_name: String,
    pub sort: PackSort,
}

impl Default for PackOptions {
    fn default() -> Self {
        Self {
            padding: 2,
            extrude: 1,
            trim: true,
            max_size: 4096,
            base_name: "atlas".into(),
            sort: PackSort::Area,
        }
    }
}

/// 一张待打包的输入图。
pub struct PackInput {
    /// 输出帧名，如 `sprite_0000.png`。
    pub name: String,
    pub image: RgbaImage,
}

// 手写 Debug 而不用 derive：`RgbaImage` 的 Debug 会把每个像素都打出来，
// 一次误打印就是几十兆的日志。
impl std::fmt::Debug for PackInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PackInput")
            .field("name", &self.name)
            .field(
                "size",
                &format_args!("{}×{}", self.image.width(), self.image.height()),
            )
            .finish()
    }
}

impl PackInput {
    /// 从一张大图的某个区域取出一块作为输入——切片结果喂给打包器时用这个。
    pub fn from_region(
        source: &RgbaImage,
        x: u32,
        y: u32,
        w: u32,
        h: u32,
        name: impl Into<String>,
    ) -> Self {
        let cropped = image::imageops::crop_imm(source, x, y, w, h).to_image();
        Self {
            name: name.into(),
            image: cropped,
        }
    }
}

/// 裁剪与偏移记录的结果。
struct Prepared {
    name: String,
    /// 真正要写进图集的像素（已经裁剪过）
    pixels: RgbaImage,
    source_size: SizeI,
    sprite_source_size: RectI,
    trimmed: bool,
}

fn alpha_bbox(img: &RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let (w, h) = img.dimensions();
    let (mut min_x, mut min_y) = (u32::MAX, u32::MAX);
    let (mut max_x, mut max_y) = (0u32, 0u32);
    let mut found = false;

    for y in 0..h {
        for x in 0..w {
            if img.get_pixel(x, y)[3] > 0 {
                found = true;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }
    }

    if found {
        Some((min_x, min_y, max_x - min_x + 1, max_y - min_y + 1))
    } else {
        None
    }
}

fn prepare(input: &PackInput, trim: bool) -> Option<Prepared> {
    let (w, h) = input.image.dimensions();
    if w == 0 || h == 0 {
        return None;
    }

    match alpha_bbox(&input.image) {
        None => None, // 全透明，没有可打包的内容
        Some((bx, by, bw, bh)) => {
            if trim {
                // `trimmed` 表示**真的被裁过**，而不是"开了 trim 选项"。
                // 切片器的产出本来就是紧致包围盒，这里会得到 trimmed=false，
                // 消费方据此知道偏移是 (0,0)，不会做多余的换算。
                let actually_trimmed = bx != 0 || by != 0 || bw != w || bh != h;
                let cropped = image::imageops::crop_imm(&input.image, bx, by, bw, bh).to_image();
                Some(Prepared {
                    name: input.name.clone(),
                    pixels: cropped,
                    source_size: SizeI {
                        w: w as i32,
                        h: h as i32,
                    },
                    sprite_source_size: RectI::new(bx as i32, by as i32, bw as i32, bh as i32),
                    trimmed: actually_trimmed,
                })
            } else {
                Some(Prepared {
                    name: input.name.clone(),
                    pixels: input.image.clone(),
                    source_size: SizeI {
                        w: w as i32,
                        h: h as i32,
                    },
                    sprite_source_size: RectI::new(0, 0, w as i32, h as i32),
                    trimmed: false,
                })
            }
        }
    }
}

// ───────────────────────────── Skyline ─────────────────────────────

#[derive(Clone, Copy, Debug)]
struct SkylineNode {
    x: u32,
    y: u32,
    width: u32,
}

/// Skyline bottom-left。节点按 x 递增排列，y 是这一段的天际高度。
struct Skyline {
    nodes: Vec<SkylineNode>,
    width: u32,
    height: u32,
}

impl Skyline {
    fn new(width: u32, height: u32) -> Self {
        Self {
            nodes: vec![SkylineNode {
                x: 0,
                y: 0,
                width,
            }],
            width,
            height,
        }
    }

    /// 从节点 `start` 起向右跨过宽度 `w`，需要抬到多高？跨不过去返回 None。
    fn fit_y(&self, start: usize, w: u32) -> Option<u32> {
        let mut remaining = w;
        let mut y = 0u32;
        let mut i = start;
        loop {
            if i >= self.nodes.len() {
                return None;
            }
            y = y.max(self.nodes[i].y);
            if self.nodes[i].width >= remaining {
                return Some(y);
            }
            remaining -= self.nodes[i].width;
            i += 1;
        }
    }

    /// 找最低可放位置；同高度取更靠左的。返回 (x, y, 节点索引)。
    fn find(&self, w: u32, h: u32) -> Option<(u32, u32, usize)> {
        let mut best: Option<(u32, u32, usize)> = None;
        let mut best_y = u32::MAX;
        let mut best_x = u32::MAX;

        for i in 0..self.nodes.len() {
            let x = self.nodes[i].x;
            if x + w > self.width {
                continue;
            }
            let Some(y) = self.fit_y(i, w) else { continue };
            if y + h > self.height {
                continue;
            }
            if y < best_y || (y == best_y && x < best_x) {
                best_y = y;
                best_x = x;
                best = Some((x, y, i));
            }
        }

        best
    }

    fn place(&mut self, index: usize, x: u32, y: u32, w: u32, h: u32) {
        // 先收缩或删除被覆盖的旧节点。
        // 注意 i 不需要自增：remove(i) 之后下一个节点会顶到同一个下标。
        let mut remaining = w;
        let i = index;
        while i < self.nodes.len() && remaining > 0 {
            let node_w = self.nodes[i].width;
            if node_w <= remaining {
                remaining -= node_w;
                self.nodes.remove(i);
            } else {
                // 只覆盖了这个节点的一部分：把它右移，并保留**剩余**的宽度。
                self.nodes[i].x += remaining;
                self.nodes[i].width = node_w - remaining;
                remaining = 0;
            }
        }

        // 再插入新节点
        self.nodes.insert(
            index,
            SkylineNode {
                x,
                y: y + h,
                width: w,
            },
        );

        // 合并同高度的相邻节点
        let mut i = 0;
        while i + 1 < self.nodes.len() {
            if self.nodes[i].y == self.nodes[i + 1].y {
                self.nodes[i].width += self.nodes[i + 1].width;
                self.nodes.remove(i + 1);
            } else {
                i += 1;
            }
        }
    }
}

// ───────────────────────────── 打包 ─────────────────────────────

fn node_size(sw: u32, sh: u32, opts: &PackOptions) -> (u32, u32) {
    (
        sw + opts.extrude * 2 + opts.padding,
        sh + opts.extrude * 2 + opts.padding,
    )
}

/// 候选画布边长：64 起步逐级翻倍，最后落在 max_size。
fn candidate_sides(max_size: u32) -> Vec<u32> {
    let max_size = max_size.max(16);
    let mut v = Vec::new();
    let mut s = 64u32;
    while s < max_size {
        v.push(s);
        s = s.saturating_mul(2);
    }
    v.push(max_size);
    v.sort_unstable();
    v.dedup();
    v
}

fn sort_order(prep: &[Prepared], sort: PackSort) -> Vec<usize> {
    let mut order: Vec<usize> = (0..prep.len()).collect();
    match sort {
        PackSort::None => {}
        PackSort::Name => order.sort_by(|&a, &b| prep[a].name.cmp(&prep[b].name)),
        PackSort::Area => order.sort_by(|&a, &b| {
            let (aw, ah) = prep[a].pixels.dimensions();
            let (bw, bh) = prep[b].pixels.dimensions();
            (bw * bh).cmp(&(aw * ah)).then_with(|| prep[a].name.cmp(&prep[b].name))
        }),
        PackSort::MaxSide => order.sort_by(|&a, &b| {
            let (aw, ah) = prep[a].pixels.dimensions();
            let (bw, bh) = prep[b].pixels.dimensions();
            bw.max(bh)
                .cmp(&aw.max(ah))
                .then_with(|| prep[a].name.cmp(&prep[b].name))
        }),
        PackSort::Height => order.sort_by(|&a, &b| {
            prep[b].pixels.height().cmp(&prep[a].pixels.height())
        }),
        PackSort::Width => order.sort_by(|&a, &b| prep[b].pixels.width().cmp(&prep[a].pixels.width())),
    }
    order
}

fn try_pack(
    indices: &[usize],
    prep: &[Prepared],
    side: u32,
    opts: &PackOptions,
) -> (Vec<(usize, u32, u32)>, Vec<usize>) {
    let mut sky = Skyline::new(side, side);
    let mut placed = Vec::new();
    let mut unplaced = Vec::new();

    for &idx in indices {
        let (sw, sh) = prep[idx].pixels.dimensions();
        let (nw, nh) = node_size(sw, sh, opts);
        match sky.find(nw, nh) {
            Some((x, y, node_i)) => {
                sky.place(node_i, x, y, nw, nh);
                placed.push((idx, x, y));
            }
            None => unplaced.push(idx),
        }
    }

    (placed, unplaced)
}

fn round_up_4(v: u32) -> u32 {
    ((v + 3) / 4) * 4
}

fn render_page(
    placed: &[(usize, u32, u32)],
    prep: &[Prepared],
    side: u32,
    page_index: usize,
    opts: &PackOptions,
) -> AtlasPage {
    let e = opts.extrude;

    // shrink-wrap：按实际占用收紧画布，避免逐级放大带来的大片空白
    let mut used_w = 0u32;
    let mut used_h = 0u32;
    for &(idx, x, y) in placed {
        let (sw, sh) = prep[idx].pixels.dimensions();
        used_w = used_w.max(x + sw + e * 2);
        used_h = used_h.max(y + sh + e * 2);
    }
    let page_w = round_up_4(used_w.min(side).max(1));
    let page_h = round_up_4(used_h.min(side).max(1));

    let mut image = RgbaImage::new(page_w, page_h);
    let mut frames = Vec::with_capacity(placed.len());

    for &(idx, gx, gy) in placed {
        let sprite = &prep[idx].pixels;
        let (sw, sh) = sprite.dimensions();

        // 把 sprite + 一圈边缘外扩写进去：整个 (sw+2e)×(sh+2e) 区域用边缘像素钳位填充
        for by in 0..(sh + e * 2) {
            for bx in 0..(sw + e * 2) {
                let sx = (bx as i64 - e as i64).clamp(0, sw as i64 - 1) as u32;
                let sy = (by as i64 - e as i64).clamp(0, sh as i64 - 1) as u32;
                let (tx, ty) = (gx + bx, gy + by);
                if tx < page_w && ty < page_h {
                    image.put_pixel(tx, ty, *sprite.get_pixel(sx, sy));
                }
            }
        }

        // frame 指向 sprite 本体，不含外扩 —— 外扩像素是给采样器吃的，不属于这帧
        frames.push(AtlasFrame {
            filename: prep[idx].name.clone(),
            frame: RectI::new((gx + e) as i32, (gy + e) as i32, sw as i32, sh as i32),
            rotated: false,
            trimmed: prep[idx].trimmed,
            sprite_source_size: prep[idx].sprite_source_size,
            source_size: prep[idx].source_size,
        });
    }

    frames.sort_by(|a, b| a.filename.cmp(&b.filename));

    AtlasPage {
        image_name: page_file_names(&opts.base_name, page_index).0,
        width: page_w,
        height: page_h,
        frames,
        image,
    }
}

/// 打包。放不下会自动分多页；单页放得下时永远只产出 1 页。
pub fn pack(inputs: &[PackInput], opts: &PackOptions) -> Result<Atlas, String> {
    let mut warnings = Vec::new();
    let mut prep: Vec<Prepared> = Vec::new();

    for input in inputs {
        match prepare(input, opts.trim) {
            Some(p) => prep.push(p),
            None => warnings.push(format!("{} 没有任何不透明像素，已跳过", input.name)),
        }
    }

    if prep.is_empty() {
        return Err("没有可打包的内容（输入全是空白图）".into());
    }

    let mut remaining = sort_order(&prep, opts.sort);
    let candidates = candidate_sides(opts.max_size);
    let mut pages: Vec<AtlasPage> = Vec::new();

    while !remaining.is_empty() {
        // 优先找一个能装下**全部**剩余精灵的最小边长。
        //
        // 这一点很关键：如果判据只是"至少放下一个"，那么最小的候选边长（64）
        // 几乎总能满足，分页会退化成一页只放几个，白白产出几十页。
        let mut chosen: Option<(u32, Vec<(usize, u32, u32)>, Vec<usize>)> = None;

        for &side in &candidates {
            let (placed, unplaced) = try_pack(&remaining, &prep, side, opts);
            if unplaced.is_empty() {
                chosen = Some((side, placed, unplaced));
                break;
            }
        }

        // 连最大边长也装不下全部 → 只能分页：这一页装尽可能多，剩下的留给下一页
        let (side, placed, unplaced) = match chosen {
            Some(v) => v,
            None => {
                let max_side = *candidates.last().expect("候选边长不应为空");
                let (placed, unplaced) = try_pack(&remaining, &prep, max_side, opts);
                if placed.is_empty() {
                    return Err(format!(
                        "有精灵在 {max_side}×{max_side} 内放不下——可能是单个精灵尺寸超过上限"
                    ));
                }
                (max_side, placed, unplaced)
            }
        };

        pages.push(render_page(&placed, &prep, side, pages.len(), opts));

        if pages.len() > 64 {
            return Err("页数超过 64，已中止（请提高单页尺寸上限）".into());
        }

        remaining = unplaced;
    }

    Ok(Atlas { pages, warnings })
}

/// 图集的输出目录：`<out_root>/<base_name>`。
///
/// 和切图一样**独占一层**：以前图集直接写进所选目录、还固定叫 `atlas.png`，
/// 于是两次打包就会互相覆盖，也会冲掉用户原有的同名文件。
pub fn plan_atlas_dir(out_root: &Path, base_name: &str) -> PathBuf {
    out_root.join(base_name)
}

/// 列出目录里不属于 `allowed` 的条目（只看一层——打包的产出都在同一层）。
///
/// 目录不存在时返回空（首次输出）。
fn find_foreign_entries(dir: &Path, allowed: &[String]) -> Result<Vec<String>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut foreign: Vec<String> = Vec::new();

    for entry in std::fs::read_dir(dir).map_err(|e| format!("无法读取输出目录：{e}"))? {
        let entry = entry.map_err(|e| format!("无法读取输出目录：{e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();

        if entry.path().is_dir() {
            foreign.push(format!("{name}/"));
            continue;
        }
        if !allowed.iter().any(|a| a == &name) {
            foreign.push(name);
        }
    }

    foreign.sort();
    Ok(foreign)
}

/// 把图集写到磁盘：每页一个 PNG + 一个 TexturePacker JSON。
///
/// `out_dir` 是**这张图集自己的目录**，由调用方用 `plan_atlas_dir` 算好。
///
/// **写入前会检查该目录里有没有"不是我们这次要写的"文件**（含子目录），
/// 有就整个中止、一个字节都不写——这和切图导出是同一套护栏。
/// 对同一个图集重复打包不受影响：目录里的东西都是我们自己写的。
///
/// 返回写出的文件名列表。
pub fn write_atlas(
    atlas: &Atlas,
    out_dir: &Path,
    base_name: &str,
    json_opts: &JsonOptions,
) -> Result<Vec<String>, String> {
    // 先算清这次要写哪些文件，再拿它当"合法性白名单"
    let mut planned: Vec<String> = Vec::new();
    for i in 0..atlas.pages.len() {
        let (image_name, json_name) = page_file_names(base_name, i);
        planned.push(image_name);
        planned.push(json_name);
    }

    let foreign = find_foreign_entries(out_dir, &planned)?;
    if !foreign.is_empty() {
        let preview: Vec<String> = foreign.iter().take(5).cloned().collect();
        let more = if foreign.len() > preview.len() {
            format!(" 等 {} 个", foreign.len())
        } else {
            String::new()
        };
        return Err(format!(
            "输出目录 `{}` 里已有本工具之外的文件（{}{more}），已中止，未写入任何内容。请换一个输出目录。",
            out_dir.display(),
            preview.join("、")
        ));
    }

    std::fs::create_dir_all(out_dir).map_err(|e| format!("无法创建输出目录：{e}"))?;

    let mut written = Vec::new();

    for (i, page) in atlas.pages.iter().enumerate() {
        let (image_name, json_name) = page_file_names(base_name, i);

        page.image
            .save_with_format(out_dir.join(&image_name), image::ImageFormat::Png)
            .map_err(|e| format!("写入 {image_name} 失败：{e}"))?;

        crate::atlas::write_page_json(
            &out_dir.join(&json_name),
            &image_name,
            page.width,
            page.height,
            &page.frames,
            json_opts,
        )?;

        written.push(image_name);
        written.push(json_name);
    }

    Ok(written)
}
