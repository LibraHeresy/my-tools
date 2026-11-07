//! 演示打包器的两个价值点，以及一个容易误解的地方。
//!
//! 1. **重排**：把排布松散的图集切开，再紧凑打包回去 → 显著省空间
//! 2. **trim**：打包"固定画布帧"（美术导出时每帧都是同样大小、内容是居中的小块）
//!    → 裁掉大片透明边，收益很大
//!
//! ⚠️ 容易误解的点：**对切片器（detect）的产出做 trim 是没有任何效果的。**
//! 因为检测出来的矩形本来就是紧致包围盒，再裁也裁不掉东西。
//! `trim` 的价值只在输入自带透明边时才体现——两种情况的对比就在下面。
//!
//! 运行：cargo run -p slicer-io --release --example slice_then_pack

use image::{Rgba, RgbaImage};
use slicer_io::{pack, PackInput, PackOptions};

fn solid(img: &mut RgbaImage, ox: u32, oy: u32, w: u32, h: u32, shade: u8) {
    for y in oy..oy + h {
        for x in ox..ox + w {
            img.put_pixel(x, y, Rgba([shade, 120, 200, 255]));
        }
    }
}

fn report(label: &str, inputs: &[PackInput], original_area: u64) {
    println!("\n{label}");
    println!("  输入 {} 张", inputs.len());

    for (tag, trim) in [("trim=off", false), ("trim=on ", true)] {
        let opts = PackOptions {
            trim,
            ..Default::default()
        };
        let atlas = pack(inputs, &opts).unwrap();
        let total: u32 = atlas.pages.iter().map(|p| p.width * p.height).sum();
        let pages: Vec<String> = atlas
            .pages
            .iter()
            .map(|p| format!("{}×{}", p.width, p.height))
            .collect();

        println!(
            "  {tag} → {} 页 [{}]  合计 {:>7} 像素  占原始 {:.1}%",
            atlas.pages.len(),
            pages.join(", "),
            total,
            total as f64 / original_area as f64 * 100.0
        );
    }
}

/// 情况一：排布松散的图集 —— 先切再合
fn case_relayout() {
    let cell = 64u32;
    let (cols, rows) = (6u32, 4u32);
    let (sw, sh) = (cell * cols, cell * rows);
    let mut sheet = RgbaImage::new(sw, sh);

    let sizes: [(u32, u32); 8] = [
        (48, 40),
        (32, 28),
        (56, 20),
        (24, 24),
        (40, 36),
        (20, 52),
        (36, 30),
        (28, 44),
    ];

    let mut n = 0u32;
    for row in 0..rows {
        for col in 0..cols {
            let (iw, ih) = sizes[(n as usize) % sizes.len()];
            let ox = col * cell + (cell - iw) / 2;
            let oy = row * cell + (cell - ih) / 2;
            solid(&mut sheet, ox, oy, iw, ih, ((n * 37) % 200) as u8);
            n += 1;
        }
    }

    let img = slicer_core::Image::new(sw, sh, sheet.as_raw()).unwrap();
    let rects = slicer_core::detect(&img, &slicer_core::DetectOptions::default());

    let inputs: Vec<PackInput> = rects
        .iter()
        .map(|r| {
            PackInput::from_region(
                &sheet,
                r.rect.x,
                r.rect.y,
                r.rect.w,
                r.rect.h,
                format!("sprite_{:04}.png", r.index),
            )
        })
        .collect();

    println!("原图集 {sw}×{sh} = {} 像素，检出 {} 个精灵", sw * sh, rects.len());
    report("情况一：切开再重排（切片结果本来就没有透明边 → trim 无差异）", &inputs, (sw * sh) as u64);
}

/// 情况二：固定画布帧 —— 每帧同样大小，内容居中，四周大片透明
fn case_trim() {
    let canvas = 64u32;
    let count = 18u32;
    let sizes: [(u32, u32); 6] = [(40, 32), (28, 24), (48, 18), (20, 20), (34, 30), (24, 40)];

    let inputs: Vec<PackInput> = (0..count)
        .map(|i| {
            let (iw, ih) = sizes[(i as usize) % sizes.len()];
            let mut frame = RgbaImage::new(canvas, canvas);
            solid(
                &mut frame,
                (canvas - iw) / 2,
                (canvas - ih) / 2,
                iw,
                ih,
                ((i * 37) % 200) as u8,
            );
            PackInput {
                name: format!("frame_{i:03}.png"),
                image: frame,
            }
        })
        .collect();

    println!(
        "\n固定画布帧：{count} 张，每张 {canvas}×{canvas} = {} 像素",
        canvas * canvas * count
    );
    report("情况二：美术导出的固定画布帧（trim 的价值在这里体现）", &inputs, (canvas * canvas * count) as u64);
}

fn main() {
    case_relayout();
    case_trim();
}
