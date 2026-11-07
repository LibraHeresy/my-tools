//! 生成测试用图集 PNG，用来验证 CLI / GUI 和那张调参对照表。
//!
//! 用法：
//!   cargo run -p slicer-io --example make_test_sheet -- <输出目录>
//!
//! 每一类都**刻意做成"只有某个参数能救"**，否则它就没有验证价值：
//!
//! | 文件名 | 特征 | 只有这个参数能救 |
//! |---|---|---|
//! | `clean_*.png`   | 透明间隔清晰 | 默认参数就该全对（对照组） |
//! | `sparse_*.png`  | 排布松散、留白很大 | `pack --from-sheet` 的重排收益 |
//! | `glued_*.png`   | 相邻精灵被 1px 细桥真正连起来 | `--erode 1` |
//! | `shadow_*.png`  | 整张图残留 alpha=8 的淡底色 + alpha=20 的光晕 | `--threshold 8` |
//! | `noisy_*.png`   | 撒了 200 个 4~16 像素的碎块 | `--min-area 40` |

use image::{Rgba, RgbaImage};
use std::path::PathBuf;

const SHAPES: [(u32, u32); 6] = [(32, 24), (20, 20), (40, 16), (16, 32), (28, 28), (24, 36)];

fn fill(img: &mut RgbaImage, ox: u32, oy: u32, w: u32, h: u32, pixel: Rgba<u8>) {
    for y in oy..(oy + h).min(img.height()) {
        for x in ox..(ox + w).min(img.width()) {
            img.put_pixel(x, y, pixel);
        }
    }
}

/// 网格布局里的每个精灵矩形（精灵在各自格子里居中）。
fn grid_rects(cell: u32, cols: u32, rows: u32, seed: u32) -> Vec<(u32, u32, u32, u32)> {
    let mut rects = Vec::new();
    let mut n = seed * 7;
    for row in 0..rows {
        for col in 0..cols {
            let (w, h) = SHAPES[(n as usize) % SHAPES.len()];
            rects.push((col * cell + (cell - w) / 2, row * cell + (cell - h) / 2, w, h));
            n += 1;
        }
    }
    rects
}

fn draw_all(img: &mut RgbaImage, rects: &[(u32, u32, u32, u32)]) {
    for (i, &(x, y, w, h)) in rects.iter().enumerate() {
        fill(
            img,
            x,
            y,
            w,
            h,
            Rgba([((i as u32 * 41) % 190 + 40) as u8, 130, 200, 255]),
        );
    }
}

fn make_clean(seed: u32) -> RgbaImage {
    let (cell, cols, rows) = (56u32, 6u32, 4u32);
    let mut img = RgbaImage::new(cell * cols, cell * rows);
    draw_all(&mut img, &grid_rects(cell, cols, rows, seed));
    img
}

fn make_sparse(seed: u32) -> RgbaImage {
    // 格子 96、精灵最大 40 → 水平留白至少 56 像素，重排收益很大
    let (cell, cols, rows) = (96u32, 5u32, 3u32);
    let mut img = RgbaImage::new(cell * cols, cell * rows);
    draw_all(&mut img, &grid_rects(cell, cols, rows, seed));
    img
}

fn make_glued(seed: u32) -> RgbaImage {
    let (cell, cols, rows) = (56u32, 6u32, 4u32);
    let rects = grid_rects(cell, cols, rows, seed);
    let mut img = RgbaImage::new(cell * cols, cell * rows);
    draw_all(&mut img, &rects);

    // 关键：把每行前两个精灵**真正连起来**——从左边那个的右边缘画到右边那个的左边缘。
    // 桥只有 1px 高，所以默认参数会把它们并成一块，只有腐蚀能断开。
    for row in 0..rows {
        let left = rects[(row * cols) as usize];
        let right = rects[(row * cols + 1) as usize];
        let y = row * cell + cell / 2; // 所有精灵都在格子里垂直居中，必然包含这条中线

        let x_start = left.0 + left.2 - 1; // 左边精灵的最后一个不透明像素
        if right.0 > x_start {
            for x in x_start..right.0 {
                img.put_pixel(x, y, Rgba([210, 130, 200, 255]));
            }
        }
    }
    img
}

fn make_shadow(seed: u32) -> RgbaImage {
    let (cell, cols, rows) = (56u32, 6u32, 4u32);
    let mut img = RgbaImage::new(cell * cols, cell * rows);
    let rects = grid_rects(cell, cols, rows, seed);

    // 1) 整张图残留一层 alpha=8 的淡底色 —— 现实里非常常见
    //    （图集被有损工具处理过、或导出时没清干净 alpha）。
    //    阈值 1 时它算前景 → 所有精灵被这层底连成一大块；
    //    阈值 8 时 alpha>8 不成立 → 干净切出来。
    let (full_w, full_h) = (img.width(), img.height());
    fill(&mut img, 0, 0, full_w, full_h, Rgba([250, 250, 250, 8]));

    // 2) 每个精灵外一圈 alpha=20 的光晕，阈值 8 时它仍算前景，
    //    所以包围盒会比实体大 1 像素（这是正确行为，不是 bug）。
    for &(x, y, w, h) in &rects {
        if x > 0 && y > 0 {
            fill(
                &mut img,
                x - 1,
                y - 1,
                w + 2,
                h + 2,
                Rgba([200, 200, 200, 20]),
            );
        }
    }

    draw_all(&mut img, &rects);
    img
}

fn make_noisy(seed: u32) -> RgbaImage {
    let mut img = make_clean(seed);
    let (w, h) = img.dimensions();
    let mut state = 0x1234_5678u32 ^ (seed.wrapping_mul(2_654_435_761));

    let mut rng = move || {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        state
    };

    // 200 个 2~4 边长（4~16 像素）的碎块：够大，能通过默认的 min-area=4，
    // 但远小于 40，所以只有把「最小像素数」调上去才滤得掉。
    for _ in 0..200 {
        let x = rng() % w;
        let y = rng() % h;
        let size = 2 + rng() % 3;
        if x + size < w && y + size < h {
            fill(&mut img, x, y, size, size, Rgba([255, 80, 80, 255]));
        }
    }
    img
}

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().unwrap_or_else(|| "testdata".into()));

    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("无法创建目录 {}：{e}", dir.display());
        std::process::exit(1);
    }

    let generators: [(&str, fn(u32) -> RgbaImage); 5] = [
        ("clean", make_clean),
        ("sparse", make_sparse),
        ("glued", make_glued),
        ("shadow", make_shadow),
        ("noisy", make_noisy),
    ];

    let mut written = 0;
    for (name, generate) in generators {
        for seed in 0..2u32 {
            let img = generate(seed);
            let file = dir.join(format!("{name}_{seed}.png"));
            match img.save(&file) {
                Ok(()) => {
                    println!(
                        "  {:<24} {}×{}",
                        file.file_name().unwrap().to_string_lossy(),
                        img.width(),
                        img.height()
                    );
                    written += 1;
                }
                Err(e) => eprintln!("写入 {} 失败：{e}", file.display()),
            }
        }
    }

    println!("\n生成 {written} 张测试图集 → {}", dir.display());
}
