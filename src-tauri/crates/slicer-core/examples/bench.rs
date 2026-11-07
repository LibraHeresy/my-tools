//! 在合成的 4096x4096 图集上测检测耗时，用来验证性能假设。
//! 运行：cargo run --release --example bench

use slicer_core::{detect, DetectOptions, Image};
use std::time::Instant;

struct Rng(u32);

impl Rng {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }
}

fn main() {
    let w = 4096u32;
    let h = 4096u32;
    let cell = 128u32;

    let mut rgba = vec![0u8; w as usize * h as usize * 4];
    let mut rng = Rng(0x9E37_79B9);
    let mut count = 0u32;

    // 每 128x128 的格子里随机放一个 16~112 像素的精灵。
    // sprite 最大 112 < 128，所以块之间至少留 16 像素间隔，必然可分离。
    let mut y = 0;
    while y + cell <= h {
        let mut x = 0;
        while x + cell <= w {
            let sw = 16 + rng.next() % (cell - 32);
            let sh = 16 + rng.next() % (cell - 32);
            let ox = x + rng.next() % (cell - sw);
            let oy = y + rng.next() % (cell - sh);

            for yy in oy..oy + sh {
                let row = yy as usize * w as usize;
                for xx in ox..ox + sw {
                    rgba[(row + xx as usize) * 4 + 3] = 255;
                }
            }

            count += 1;
            x += cell;
        }
        y += cell;
    }

    let img = Image::new(w, h, &rgba).unwrap();
    println!(
        "输入：{}x{} RGBA（{} MB），合成 {} 个 sprite",
        w,
        h,
        rgba.len() / 1024 / 1024,
        count
    );
    println!();

    for erode in [0u8, 1] {
        let opts = DetectOptions {
            erode_iterations: erode,
            ..DetectOptions::default()
        };

        // 跑两遍，取第二遍（避免首次分配噪声）
        let mut best = u128::MAX;
        let mut found = 0usize;
        for _ in 0..2 {
            let t = Instant::now();
            let sprites = detect(&img, &opts);
            let us = t.elapsed().as_micros();
            found = sprites.len();
            best = best.min(us);
        }

        println!(
            "erode={}  检出 {:>5} 块  耗时 {:>7.1} ms",
            erode,
            found,
            best as f64 / 1000.0
        );
    }
}
