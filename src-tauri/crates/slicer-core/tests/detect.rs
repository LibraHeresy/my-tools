//! 用合成的图集验证检测结果。不依赖任何外部图片文件。

use slicer_core::components::Connectivity;
use slicer_core::{detect, DetectError, DetectOptions, Image, SortMode, Sprite};

struct Canvas {
    w: u32,
    h: u32,
    rgba: Vec<u8>,
}

impl Canvas {
    fn new(w: u32, h: u32) -> Self {
        Self {
            w,
            h,
            rgba: vec![0; w as usize * h as usize * 4],
        }
    }

    fn set(&mut self, x: u32, y: u32, a: u8) {
        let i = (y as usize * self.w as usize + x as usize) * 4;
        self.rgba[i] = 200;
        self.rgba[i + 1] = 120;
        self.rgba[i + 2] = 80;
        self.rgba[i + 3] = a;
    }

    fn fill(&mut self, x: u32, y: u32, w: u32, h: u32, a: u8) {
        for yy in y..y + h {
            for xx in x..x + w {
                self.set(xx, yy, a);
            }
        }
    }

    fn image(&self) -> Image<'_> {
        Image::new(self.w, self.h, &self.rgba).unwrap()
    }

    fn run(&self, opts: &DetectOptions) -> Vec<Sprite> {
        detect(&self.image(), opts)
    }
}

fn rects(sprites: &[Sprite]) -> Vec<(u32, u32, u32, u32)> {
    sprites.iter().map(|s| (s.rect.x, s.rect.y, s.rect.w, s.rect.h)).collect()
}

// ───────────────────────── 基础：切出多块 + 过滤噪点 ─────────────────────────

#[test]
fn detects_sprites_and_filters_noise_pixel() {
    let mut c = Canvas::new(80, 80);
    c.fill(4, 4, 10, 8, 255); // A 80px，第一行靠左
    c.fill(20, 4, 6, 6, 255); // B 36px，第一行靠右
    c.fill(4, 20, 12, 4, 255); // C 48px，第二行
    c.fill(30, 30, 5, 5, 255); // D 25px，第三行
    c.set(70, 70, 255); // 单像素噪点，应被 min_area 过滤

    let sprites = c.run(&DetectOptions::default());

    assert_eq!(
        rects(&sprites),
        vec![(4, 4, 10, 8), (20, 4, 6, 6), (4, 20, 12, 4), (30, 30, 5, 5)],
        "应切出 4 块，且按阅读顺序排列"
    );
    assert_eq!(
        sprites.iter().map(|s| s.pixels).collect::<Vec<_>>(),
        vec![80, 36, 48, 25],
        "像素数应等于各矩形的面积"
    );
    assert_eq!(
        sprites.iter().map(|s| s.index).collect::<Vec<_>>(),
        vec![0, 1, 2, 3],
        "index 应连续"
    );
}

#[test]
fn row_major_order_survives_ragged_heights() {
    // 同一行里高度差很大：如果只按 (y, x) 排序，第二行会被打散。
    let mut c = Canvas::new(80, 60);
    c.fill(4, 10, 4, 20, 255); // 高个子，y=10..30
    c.fill(20, 10, 4, 4, 255); // 矮个子，y=10..14
    c.fill(40, 12, 4, 4, 255); // 矮个子，y=12..16，仍属同一行
    c.fill(4, 40, 4, 4, 255); // 下一行

    let sprites = c.run(&DetectOptions::default());

    assert_eq!(
        rects(&sprites),
        vec![(4, 10, 4, 20), (20, 10, 4, 4), (40, 12, 4, 4), (4, 40, 4, 4)],
        "同一行应按 x 排序，且不因高度参差被打散"
    );
}

// ───────────────────────── 腐蚀：断开粘连但不切边 ─────────────────────────

#[test]
fn glue_is_one_component_without_erosion() {
    let mut c = Canvas::new(80, 80);
    c.fill(50, 50, 5, 5, 255);
    c.fill(60, 50, 5, 5, 255);
    for x in 55..60 {
        c.set(x, 52, 255); // 一条 1px 高的桥，把两块连起来
    }

    let sprites = c.run(&DetectOptions::default());

    assert_eq!(
        rects(&sprites),
        vec![(50, 50, 15, 5)],
        "默认不腐蚀，粘连的两块应被当成一个连通域"
    );
    assert_eq!(sprites[0].pixels, 55, "25 + 25 + 5 个桥像素");
}

#[test]
fn erosion_splits_glue_and_compensates_the_box() {
    let mut c = Canvas::new(80, 80);
    c.fill(50, 50, 5, 5, 255);
    c.fill(60, 50, 5, 5, 255);
    for x in 55..60 {
        c.set(x, 52, 255);
    }

    let opts = DetectOptions {
        erode_iterations: 1,
        ..DetectOptions::default()
    };
    let sprites = c.run(&opts);

    assert_eq!(
        rects(&sprites),
        vec![(50, 50, 5, 5), (60, 50, 5, 5)],
        "腐蚀应断开细桥，且包围盒膨胀补偿后必须回到原始尺寸，不能切边"
    );
    assert_eq!(
        sprites.iter().map(|s| s.pixels).collect::<Vec<_>>(),
        vec![25, 25],
        "被腐蚀掉的桥像素不应该被算进任何一块"
    );
}

// ───────────────────────── alpha 阈值 ─────────────────────────

#[test]
fn alpha_threshold_drops_faint_sprites() {
    let mut c = Canvas::new(40, 20);
    c.fill(4, 4, 4, 4, 3); // 极淡
    c.fill(20, 4, 4, 4, 200); // 实心

    let lenient = c.run(&DetectOptions::default());
    assert_eq!(rects(&lenient), vec![(4, 4, 4, 4), (20, 4, 4, 4)], "阈值 1 时两块都要");

    let strict = c.run(&DetectOptions {
        alpha_threshold: 8,
        ..DetectOptions::default()
    });
    assert_eq!(rects(&strict), vec![(20, 4, 4, 4)], "阈值 8 时只剩实心的那块");
}

// ───────────────────────── 合并语义 ─────────────────────────

#[test]
fn merge_gap_semantics() {
    let mut c = Canvas::new(40, 20);
    c.fill(4, 4, 4, 4, 255); // right = 8
    c.fill(10, 4, 4, 4, 255); // x = 10 → 间隔 2 像素

    let never = c.run(&DetectOptions::default());
    assert_eq!(rects(&never).len(), 2, "merge_gap=0 表示从不合并");

    let borderline = c.run(&DetectOptions {
        merge_gap: 2,
        ..DetectOptions::default()
    });
    assert_eq!(rects(&borderline).len(), 2, "间隔 2 不小于 merge_gap=2，不该合并");

    let merged = c.run(&DetectOptions {
        merge_gap: 3,
        ..DetectOptions::default()
    });
    assert_eq!(rects(&merged), vec![(4, 4, 10, 4)], "间隔 2 小于 merge_gap=3，应合并");
    assert_eq!(merged[0].pixels, 32, "合并后像素数应累加");
}

// ───────────────────────── 连通性 4 邻域 vs 8 邻域 ─────────────────────────

#[test]
fn diagonal_touch_depends_on_connectivity() {
    let mut c = Canvas::new(40, 40);
    c.fill(10, 10, 3, 3, 255); // 右下角像素 (12,12)
    c.fill(13, 13, 3, 3, 255); // 左上角像素 (13,13)，与前者对角相邻

    let eight = c.run(&DetectOptions::default());
    assert_eq!(rects(&eight), vec![(10, 10, 6, 6)], "8 邻域下对角相接算同一块");

    let four = c.run(&DetectOptions {
        connectivity: Connectivity::Four,
        ..DetectOptions::default()
    });
    assert_eq!(
        rects(&four),
        vec![(10, 10, 3, 3), (13, 13, 3, 3)],
        "4 邻域下对角相接算两块"
    );
}

// ───────────────────────── padding 与裁剪 ─────────────────────────

#[test]
fn padding_expands_and_clamps_to_image() {
    let mut c = Canvas::new(40, 20);
    c.fill(10, 5, 4, 4, 255);

    let padded = c.run(&DetectOptions {
        padding: 2,
        ..DetectOptions::default()
    });
    assert_eq!(rects(&padded), vec![(8, 3, 8, 8)]);
}

#[test]
fn padding_never_escapes_the_image_bounds() {
    let mut c = Canvas::new(20, 20);
    c.fill(0, 0, 3, 3, 255); // 紧贴左上角

    let padded = c.run(&DetectOptions {
        padding: 5,
        ..DetectOptions::default()
    });
    assert_eq!(rects(&padded), vec![(0, 0, 8, 8)], "左侧与上侧应被裁剪到 0");
}

// ───────────────────────── 参数校验 ─────────────────────────

#[test]
fn min_area_and_min_size_filter() {
    let mut c = Canvas::new(40, 20);
    c.fill(4, 4, 2, 2, 255); // 4 像素
    c.fill(20, 4, 6, 1, 255); // 6 像素，但是 1px 高

    let default = c.run(&DetectOptions::default());
    assert_eq!(rects(&default).len(), 2, "默认 min_area=4 两块都要");

    let by_area = c.run(&DetectOptions {
        min_area: 5,
        ..DetectOptions::default()
    });
    assert_eq!(rects(&by_area), vec![(20, 4, 6, 1)], "4 像素的那块应被面积过滤掉");

    let by_size = c.run(&DetectOptions {
        min_size: 2,
        ..DetectOptions::default()
    });
    assert_eq!(rects(&by_size), vec![(4, 4, 2, 2)], "1px 高的那块应被尺寸过滤掉");
}

#[test]
fn sort_mode_none_is_allowed() {
    let mut c = Canvas::new(40, 20);
    c.fill(20, 4, 4, 4, 255);
    c.fill(4, 4, 4, 4, 255);

    let sprites = c.run(&DetectOptions {
        sort: SortMode::None,
        ..DetectOptions::default()
    });
    assert_eq!(sprites.len(), 2);
}

#[test]
fn rejects_mismatched_buffer() {
    let bad = vec![0u8; 10];
    assert_eq!(
        Image::new(4, 4, &bad).unwrap_err(),
        DetectError::BufferSizeMismatch {
            expected: 64,
            actual: 10
        }
    );
    assert_eq!(Image::new(0, 4, &[]).unwrap_err(), DetectError::EmptyImage);
}

#[test]
fn fully_transparent_image_yields_nothing() {
    let c = Canvas::new(32, 32);
    assert!(c.run(&DetectOptions::default()).is_empty());
}

#[test]
fn fully_opaque_image_yields_one_sprite() {
    let mut c = Canvas::new(16, 12);
    c.fill(0, 0, 16, 12, 255);
    let sprites = c.run(&DetectOptions::default());
    assert_eq!(rects(&sprites), vec![(0, 0, 16, 12)]);
}
