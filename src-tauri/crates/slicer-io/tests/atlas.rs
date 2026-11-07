//! 打包器与图集格式测试。
//!
//! 核心是 `round_trip_slice_then_pack_is_pixel_identical`：用真实的检测器切一张
//! 合成图集，再把结果打包回去，逐像素比对。这是整个工具最有价值的一条回归测试——
//! 它同时覆盖了检测、裁剪、布局、边缘外扩、格式导出五段代码。

use image::{Rgba, RgbaImage};
use slicer_io::atlas::{page_to_json, JsonLayout, JsonOptions};
use slicer_io::pack::plan_atlas_dir;
use slicer_io::{
    pack, write_atlas, ExportOptions, PackInput, PackOptions, SliceOptions, SpriteOut,
};
use std::collections::HashMap;
use std::path::PathBuf;

fn solid(w: u32, h: u32, rgba: [u8; 4]) -> RgbaImage {
    RgbaImage::from_pixel(w, h, Rgba(rgba))
}

/// 中间实心、四周透明的图，用来验证 trim 的偏移记录。
fn padded(inner_w: u32, inner_h: u32, pad_x: u32, pad_y: u32, rgba: [u8; 4]) -> RgbaImage {
    let mut img = RgbaImage::new(inner_w + pad_x * 2, inner_h + pad_y * 2);
    for y in 0..inner_h {
        for x in 0..inner_w {
            img.put_pixel(pad_x + x, pad_y + y, Rgba(rgba));
        }
    }
    img
}

// ───────────────────────────── trim 与偏移 ─────────────────────────────

#[test]
fn trim_records_source_size_and_offset() {
    let input = PackInput {
        name: "a.png".into(),
        image: padded(6, 4, 3, 5, [10, 20, 30, 255]),
    };

    let opts = PackOptions {
        trim: true,
        extrude: 0,
        padding: 0,
        ..Default::default()
    };
    let atlas = pack(&[input], &opts).unwrap();

    assert_eq!(atlas.pages.len(), 1);
    let f = &atlas.pages[0].frames[0];

    assert!(f.trimmed, "trim=true 时 trimmed 应为 true");
    assert_eq!((f.frame.w, f.frame.h), (6, 4), "帧尺寸应是裁剪后的内容");
    assert_eq!(
        (f.source_size.w, f.source_size.h),
        (12, 14),
        "sourceSize 应是原始帧尺寸"
    );
    assert_eq!(
        (
            f.sprite_source_size.x,
            f.sprite_source_size.y,
            f.sprite_source_size.w,
            f.sprite_source_size.h
        ),
        (3, 5, 6, 4),
        "spriteSourceSize 必须记录内容在原始帧里的偏移"
    );
}

#[test]
fn no_trim_keeps_the_whole_frame() {
    let input = PackInput {
        name: "a.png".into(),
        image: padded(6, 4, 3, 5, [10, 20, 30, 255]),
    };

    let opts = PackOptions {
        trim: false,
        extrude: 0,
        padding: 0,
        ..Default::default()
    };
    let atlas = pack(&[input], &opts).unwrap();
    let f = &atlas.pages[0].frames[0];

    assert!(!f.trimmed);
    assert_eq!((f.frame.w, f.frame.h), (12, 14), "不裁剪时应保留整帧");
    assert_eq!((f.source_size.w, f.source_size.h), (12, 14));
    assert_eq!(
        (f.sprite_source_size.x, f.sprite_source_size.y),
        (0, 0),
        "不裁剪时偏移应为 0"
    );
}

// ───────────────────────────── 边缘外扩 ─────────────────────────────

#[test]
fn extrude_replicates_edge_pixels_around_the_frame() {
    // 2x2 的图，四角四种颜色，方便逐点验证钳位方向
    let mut img = RgbaImage::new(2, 2);
    img.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
    img.put_pixel(1, 0, Rgba([0, 255, 0, 255]));
    img.put_pixel(0, 1, Rgba([0, 0, 255, 255]));
    img.put_pixel(1, 1, Rgba([255, 255, 255, 255]));

    let opts = PackOptions {
        trim: false,
        extrude: 1,
        padding: 0,
        ..Default::default()
    };
    let atlas = pack(
        &[PackInput {
            name: "a.png".into(),
            image: img.clone(),
        }],
        &opts,
    )
    .unwrap();

    let page = &atlas.pages[0];
    let f = &page.frames[0];

    assert_eq!(
        (f.frame.x, f.frame.y, f.frame.w, f.frame.h),
        (1, 1, 2, 2),
        "frame 应指向精灵本体，外扩的像素在 frame 之外"
    );

    // 帧本体必须与原图逐像素一致
    for y in 0..2u32 {
        for x in 0..2u32 {
            assert_eq!(
                page.image.get_pixel(f.frame.x as u32 + x, f.frame.y as u32 + y),
                img.get_pixel(x, y),
                "帧本体在 ({x},{y}) 被外扩污染了"
            );
        }
    }

    // 外扩像素 = 最近的边缘像素
    assert_eq!(page.image.get_pixel(0, 1), img.get_pixel(0, 0), "左上角外扩");
    assert_eq!(page.image.get_pixel(0, 2), img.get_pixel(0, 1), "左下角外扩");
    assert_eq!(page.image.get_pixel(3, 1), img.get_pixel(1, 0), "右上角外扩");
    assert_eq!(page.image.get_pixel(3, 3), img.get_pixel(1, 1), "右下角外扩");
}

// ───────────────────────────── 布局约束 ─────────────────────────────

#[test]
fn frames_never_overlap_and_respect_padding() {
    let inputs: Vec<PackInput> = (0..7)
        .map(|i| PackInput {
            name: format!("s{i:02}.png"),
            image: solid(10 + i * 3, 8 + i, [i as u8 * 30, 100, 200, 255]),
        })
        .collect();

    let opts = PackOptions {
        trim: false,
        extrude: 1,
        padding: 4,
        ..Default::default()
    };
    let atlas = pack(&inputs, &opts).unwrap();

    let mut seen = 0usize;
    for page in &atlas.pages {
        for (i, a) in page.frames.iter().enumerate() {
            // 帧必须落在页面内
            assert!(
                a.frame.x >= 0
                    && a.frame.y >= 0
                    && a.frame.right() <= page.width as i32
                    && a.frame.bottom() <= page.height as i32,
                "帧 {} 超出了页面范围",
                a.filename
            );

            for b in page.frames.iter().skip(i + 1) {
                assert!(
                    !a.frame.intersects(&b.frame),
                    "帧 {} 与 {} 重叠了",
                    a.filename,
                    b.filename
                );

                // 帧之间至少留出 2*extrude + padding
                let gap_x = (b.frame.x - a.frame.right()).max(a.frame.x - b.frame.right());
                let gap_y = (b.frame.y - a.frame.bottom()).max(a.frame.y - b.frame.bottom());
                let gap = gap_x.max(gap_y);
                assert!(
                    gap >= 6,
                    "帧 {} 与 {} 的间隔只有 {gap}，应至少 6（2*extrude + padding）",
                    a.filename,
                    b.filename
                );
            }
            seen += 1;
        }
    }
    assert_eq!(seen, 7, "不能丢帧");
}

#[test]
fn shrink_wrap_removes_trailing_whitespace() {
    // 一个很小的精灵不该产出 64x64 的画布
    let opts = PackOptions {
        trim: false,
        extrude: 0,
        padding: 0,
        ..Default::default()
    };
    let atlas = pack(
        &[PackInput {
            name: "a.png".into(),
            image: solid(8, 6, [255, 0, 0, 255]),
        }],
        &opts,
    )
    .unwrap();

    let page = &atlas.pages[0];
    assert!(
        page.width <= 12 && page.height <= 12,
        "shrink-wrap 失效：产出 {}x{}",
        page.width,
        page.height
    );
    assert_eq!((page.width, page.height), (8, 8), "8x6 应被收到 8x8（4 对齐）");
}

// ───────────────────────────── 分页 ─────────────────────────────

#[test]
fn overflows_to_multiple_pages() {
    // 12 个 20x20 塞不进 64x64，会自动分页；不能丢帧
    let inputs: Vec<PackInput> = (0..12)
        .map(|i| PackInput {
            name: format!("s{i:02}.png"),
            image: solid(20, 20, [i as u8 * 20, 100, 200, 255]),
        })
        .collect();

    let opts = PackOptions {
        trim: false,
        extrude: 0,
        padding: 0,
        max_size: 64,
        ..Default::default()
    };
    let atlas = pack(&inputs, &opts).unwrap();

    assert!(atlas.pages.len() >= 2, "应该分页了");
    assert_eq!(atlas.frame_count(), 12, "分页不能丢帧");

    let mut names: Vec<String> = atlas
        .pages
        .iter()
        .flat_map(|p| p.frames.iter().map(|f| f.filename.clone()))
        .collect();
    names.sort();
    let mut expected: Vec<String> = (0..12).map(|i| format!("s{i:02}.png")).collect();
    expected.sort();
    assert_eq!(names, expected);
}

#[test]
fn sized_beyond_limit_reports_a_clear_error() {
    let opts = PackOptions {
        trim: false,
        extrude: 0,
        padding: 0,
        max_size: 64,
        ..Default::default()
    };
    let err = pack(
        &[PackInput {
            name: "huge.png".into(),
            image: solid(200, 200, [255, 0, 0, 255]),
        }],
        &opts,
    )
    .unwrap_err();

    assert!(err.contains("放不下"), "错误信息应说明原因，实际是：{err}");
}

// ───────────────────────────── 往返测试（核心） ─────────────────────────────

#[test]
fn round_trip_slice_then_pack_is_pixel_identical() {
    // 造一张 96x64 的假图集
    let (sw, sh) = (96u32, 64u32);
    let mut sheet = RgbaImage::new(sw, sh);
    let specs: [(u32, u32, u32, u32, [u8; 4]); 4] = [
        (4, 4, 20, 14, [220, 80, 60, 255]),
        (40, 6, 12, 12, [80, 200, 120, 255]),
        (8, 30, 30, 10, [90, 140, 220, 255]),
        (60, 36, 24, 20, [230, 200, 90, 255]),
    ];
    for &(x, y, w, h, c) in &specs {
        for yy in y..y + h {
            for xx in x..x + w {
                sheet.put_pixel(xx, yy, Rgba(c));
            }
        }
    }

    // 用真实检测器找出来 —— 让整个往返建立在 slicer-core 的真实行为上，而不是伪造的矩形
    let img = slicer_core::Image::new(sw, sh, sheet.as_raw()).unwrap();
    let rects = slicer_core::detect(&img, &slicer_core::DetectOptions::default());
    assert_eq!(rects.len(), 4, "检测器应找出 4 个精灵");

    // 切出来当打包输入
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

    // 打包（不 trim，这样帧内容必须与切片逐像素一致）
    let opts = PackOptions {
        trim: false,
        extrude: 1,
        padding: 2,
        ..Default::default()
    };
    let atlas = pack(&inputs, &opts).unwrap();
    assert_eq!(atlas.pages.len(), 1, "4 个小精灵应该装进一页");

    let page = &atlas.pages[0];
    assert_eq!(page.frames.len(), 4);
    assert!(page.frames.iter().all(|f| !f.trimmed));

    let by_name: HashMap<&str, &RgbaImage> =
        inputs.iter().map(|i| (i.name.as_str(), &i.image)).collect();

    // 逐像素比对
    for frame in &page.frames {
        let expected = by_name
            .get(frame.filename.as_str())
            .unwrap_or_else(|| panic!("帧 {} 找不到对应的输入", frame.filename));

        assert_eq!(
            expected.dimensions(),
            (frame.frame.w as u32, frame.frame.h as u32),
            "帧 {} 的尺寸对不上",
            frame.filename
        );

        for y in 0..frame.frame.h as u32 {
            for x in 0..frame.frame.w as u32 {
                let got = page
                    .image
                    .get_pixel(frame.frame.x as u32 + x, frame.frame.y as u32 + y);
                let want = expected.get_pixel(x, y);
                assert_eq!(
                    got, want,
                    "帧 {} 在 ({x},{y}) 与原始切片不一致",
                    frame.filename
                );
            }
        }
    }

    // 原图集 96x64 = 6144 像素；4 个精灵只占 1204 像素实体。
    // 重排后应该明显更紧凑 —— 这正是"切开再打包能减小体积"的量化证据。
    let packed_area = page.width * page.height;
    assert!(
        packed_area < sw * sh,
        "重排后 {packed_area} 不应大于原图集 {}",
        sw * sh
    );
}

// ───────────────────────────── JSON 格式 ─────────────────────────────

#[test]
fn json_matches_texture_packer_shape() {
    let inputs = vec![PackInput {
        name: "hero_idle.png".into(),
        image: padded(6, 4, 1, 2, [1, 2, 3, 255]),
    }];
    let opts = PackOptions {
        trim: true,
        extrude: 0,
        padding: 0,
        ..Default::default()
    };
    let atlas = pack(&inputs, &opts).unwrap();
    let page = &atlas.pages[0];

    let json = page_to_json(
        &page.image_name,
        page.width,
        page.height,
        &page.frames,
        &JsonOptions {
            layout: JsonLayout::Array,
            app: "sprite-slicer-test",
        },
    );

    assert!(json["frames"].is_array(), "Array 布局下 frames 应是数组");
    assert_eq!(json["meta"]["image"].as_str(), Some("atlas.png"));
    assert_eq!(json["meta"]["app"].as_str(), Some("sprite-slicer-test"));
    assert_eq!(json["meta"]["version"].as_str(), Some("1.0"));
    assert_eq!(json["meta"]["format"].as_str(), Some("RGBA8888"));
    assert_eq!(json["meta"]["scale"].as_str(), Some("1"));
    assert_eq!(
        json["meta"]["size"]["w"].as_u64(),
        Some(page.width as u64)
    );
    assert_eq!(
        json["meta"]["size"]["h"].as_u64(),
        Some(page.height as u64)
    );

    let f = &json["frames"][0];
    assert_eq!(f["filename"].as_str(), Some("hero_idle.png"));
    assert_eq!(f["rotated"].as_bool(), Some(false));
    assert_eq!(f["trimmed"].as_bool(), Some(true));
    assert!(f["frame"]["x"].is_number());
    assert!(f["frame"]["w"].is_number());
    assert_eq!(f["spriteSourceSize"]["x"].as_i64(), Some(1));
    assert_eq!(f["spriteSourceSize"]["y"].as_i64(), Some(2));
    assert_eq!(f["spriteSourceSize"]["w"].as_i64(), Some(6));
    assert_eq!(f["spriteSourceSize"]["h"].as_i64(), Some(4));
    assert_eq!(f["sourceSize"]["w"].as_i64(), Some(8));
    assert_eq!(f["sourceSize"]["h"].as_i64(), Some(8));

    // Hash 布局
    let hash = page_to_json(
        &page.image_name,
        page.width,
        page.height,
        &page.frames,
        &JsonOptions {
            layout: JsonLayout::Hash,
            app: "sprite-slicer-test",
        },
    );
    assert!(hash["frames"].is_object(), "Hash 布局下 frames 应是对象");
    assert!(hash["frames"]["hero_idle.png"].is_object());
}

// ───────────────────────────── 落盘 ─────────────────────────────

#[test]
fn write_atlas_emits_readable_png_and_json() {
    let dir = std::env::temp_dir().join("slicer_io_write_atlas_test");
    let _ = std::fs::remove_dir_all(&dir);

    let inputs = vec![PackInput {
        name: "a.png".into(),
        image: solid(8, 8, [255, 0, 0, 255]),
    }];
    let atlas = pack(&inputs, &PackOptions::default()).unwrap();
    let written = write_atlas(&atlas, &dir, "atlas", &JsonOptions::default()).unwrap();

    assert!(written.contains(&"atlas.png".to_string()));
    assert!(written.contains(&"atlas.json".to_string()));

    // PNG 必须能被读回来，且尺寸与声明一致
    let img = image::open(dir.join("atlas.png")).unwrap().to_rgba8();
    assert_eq!(
        img.dimensions(),
        (atlas.pages[0].width, atlas.pages[0].height)
    );

    // JSON 必须能被解析，且 frames 与页面一致
    let text = std::fs::read_to_string(dir.join("atlas.json")).unwrap();
    let json: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(json["frames"][0]["filename"].as_str(), Some("a.png"));
    assert_eq!(
        json["frames"].as_array().unwrap().len(),
        atlas.pages[0].frames.len()
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// ───────────────────────────── 切图导出布局 ─────────────────────────────

#[test]
fn export_sheet_produces_a_self_contained_layout() {
    let dir = std::env::temp_dir().join("slicer_io_export_layout_test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    // export_sheet 会 fs::copy 原文件，所以输入必须是一张真实存在的 PNG
    let mut sheet_img = RgbaImage::new(64, 48);
    for &(x, y, w, h) in &[(4u32, 4u32, 20u32, 14u32), (32, 6, 16, 16)] {
        for yy in y..y + h {
            for xx in x..x + w {
                sheet_img.put_pixel(xx, yy, Rgba([200, 100, 50, 255]));
            }
        }
    }
    let src = dir.join("source.png");
    sheet_img.save(&src).unwrap();

    let sheet = slicer_io::decode_png(&src).unwrap();
    let rects = slicer_io::detect_rects(&sheet, &SliceOptions::default()).unwrap();
    assert_eq!(rects.len(), 2);

    let out = dir.join("out");
    let result = slicer_io::export_sheet(&sheet, &rects, &out, &ExportOptions::default()).unwrap();

    // 图集文件现在跟着**源文件名**走，不再固定叫 atlas.png ——
    // 固定名字正是"两张图集导出到同一目录就互相覆盖"的根源
    assert!(out.join("source.png").is_file(), "应复制原图");
    assert!(out.join("source.json").is_file(), "应写出 TexturePacker JSON");
    assert!(
        out.join("sprites").join("sprite_0000.png").is_file(),
        "切图应位于 sprites/ 子目录"
    );
    assert!(!out.join("sprite_0000.png").exists(), "切图不应散落在输出根目录");
    assert_eq!(result.written, 2);

    // 原图副本必须与原文件**字节等价**（不是重新编码的）
    assert_eq!(
        std::fs::read(&src).unwrap(),
        std::fs::read(out.join("source.png")).unwrap(),
        "复制原图必须字节等价"
    );

    // JSON 必须是合法结构，且 meta.image 指向那张原图副本
    let text = std::fs::read_to_string(out.join("source.json")).unwrap();
    let json: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(json["meta"]["image"].as_str(), Some("source.png"));
    assert_eq!(json["meta"]["size"]["w"].as_i64(), Some(64));
    assert_eq!(json["meta"]["size"]["h"].as_i64(), Some(48));

    let frames = json["frames"].as_array().unwrap();
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0]["trimmed"].as_bool(), Some(false));
    assert_eq!(frames[0]["sourceSize"]["w"].as_i64(), Some(20));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn export_refuses_to_write_into_a_dir_with_foreign_files() {
    let dir = std::env::temp_dir().join("slicer_io_export_guard_test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let mut sheet_img = RgbaImage::new(48, 32);
    for yy in 4..20 {
        for xx in 4..20 {
            sheet_img.put_pixel(xx, yy, Rgba([200, 100, 50, 255]));
        }
    }
    let src = dir.join("hero.png");
    sheet_img.save(&src).unwrap();
    let sheet = slicer_io::decode_png(&src).unwrap();
    let rects = slicer_io::detect_rects(&sheet, &SliceOptions::default()).unwrap();

    let out = dir.join("out");
    std::fs::create_dir_all(&out).unwrap();
    // 用户自己原有的素材 —— 绝不能被冲掉
    std::fs::write(out.join("hero_idle.png"), b"user asset").unwrap();

    let err = slicer_io::export_sheet(&sheet, &rects, &out, &ExportOptions::default()).unwrap_err();
    assert!(err.contains("本工具之外的文件"), "实际错误：{err}");

    // 关键：一个字节都不能写
    assert_eq!(
        std::fs::read(out.join("hero_idle.png")).unwrap(),
        b"user asset",
        "用户的原有文件必须原封不动"
    );
    assert!(!out.join("hero.png").exists(), "中止后不应写出任何东西");
    assert!(!out.join("sprites").exists(), "中止后不应创建 sprites/");

    // 换成空目录就能正常写出
    let clean = dir.join("clean");
    slicer_io::export_sheet(&sheet, &rects, &clean, &ExportOptions::default()).unwrap();
    assert!(clean.join("hero.png").is_file());
    assert!(clean.join("sprites").join("sprite_0000.png").is_file());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn custom_prefix_changes_sprite_file_names() {
    let dir = std::env::temp_dir().join("slicer_io_prefix_test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let mut sheet_img = RgbaImage::new(48, 32);
    for yy in 4..20 {
        for xx in 4..20 {
            sheet_img.put_pixel(xx, yy, Rgba([200, 100, 50, 255]));
        }
    }
    let src = dir.join("bg.png");
    sheet_img.save(&src).unwrap();
    let sheet = slicer_io::decode_png(&src).unwrap();
    let rects = slicer_io::detect_rects(&sheet, &SliceOptions::default()).unwrap();

    let opts = ExportOptions {
        prefix: "hero_".into(),
        digits: 2,
    };
    let out = dir.join("out");
    slicer_io::export_sheet(&sheet, &rects, &out, &opts).unwrap();

    assert!(out.join("sprites").join("hero_00.png").is_file(), "前缀与位数据应生效");

    // manifest 里的 filename 必须跟着一起变，否则引擎找不到文件
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(out.join("bg.json")).unwrap()).unwrap();
    assert_eq!(json["frames"][0]["filename"].as_str(), Some("hero_00.png"));

    let _ = std::fs::remove_dir_all(&dir);
}

// ───────────────────────────── 重排用的输入裁剪 ─────────────────────────────

#[test]
fn repack_inputs_honor_excluded_and_use_the_given_rects() {
    let dir = std::env::temp_dir().join("slicer_io_repack_inputs_test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let mut img = RgbaImage::new(64, 32);
    for &(x, y, w, h) in &[(2u32, 2u32, 20u32, 16u32), (32, 2, 10, 10)] {
        for yy in y..y + h {
            for xx in x..x + w {
                img.put_pixel(xx, yy, Rgba([200, 100, 50, 255]));
            }
        }
    }
    let path = dir.join("sheet.png");
    img.save(&path).unwrap();
    let sheet = slicer_io::decode_png(&path).unwrap();

    let rects = vec![
        SpriteOut { id: 0, x: 2, y: 2, w: 20, h: 16, pixels: 320, excluded: false },
        SpriteOut { id: 1, x: 32, y: 2, w: 10, h: 10, pixels: 100, excluded: false },
        // 用户在界面上划掉的噪点 —— 重排绝对不能把它带上
        SpriteOut { id: 2, x: 50, y: 20, w: 3, h: 3, pixels: 9, excluded: true },
    ];

    let inputs = slicer_io::pack_inputs_from_rects(&sheet, &rects, "sprite_").unwrap();
    assert_eq!(inputs.len(), 2, "被排除的矩形不能进打包");
    assert_eq!(inputs[0].name, "sprite_0000.png");
    assert_eq!(inputs[1].name, "sprite_0001.png");
    assert_eq!(inputs[0].image.dimensions(), (20, 16));
    assert_eq!(inputs[1].image.dimensions(), (10, 10));

    // 前缀要生效
    let renamed = slicer_io::pack_inputs_from_rects(&sheet, &rects, "cat_").unwrap();
    assert_eq!(renamed[0].name, "cat_0000.png");

    // 全部被排除时要给出明确错误，而不是产出一张空图集
    let all_excluded: Vec<SpriteOut> = rects
        .iter()
        .cloned()
        .map(|mut r| {
            r.excluded = true;
            r
        })
        .collect();
    let err = slicer_io::pack_inputs_from_rects(&sheet, &all_excluded, "sprite_").unwrap_err();
    assert!(err.contains("没有可重排的精灵"), "实际错误：{err}");

    // 越界的框要被裁剪掉，而不是 panic
    let oob = vec![SpriteOut {
        id: 0,
        x: 60,
        y: 28,
        w: 100,
        h: 100,
        pixels: 0,
        excluded: false,
    }];
    let clipped = slicer_io::pack_inputs_from_rects(&sheet, &oob, "sprite_").unwrap();
    assert_eq!(clipped[0].image.dimensions(), (4, 4), "越界部分应被裁掉");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn write_atlas_refuses_to_clobber_foreign_files() {
    let dir = std::env::temp_dir().join("slicer_io_write_atlas_guard_test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let inputs = vec![PackInput {
        name: "a.png".into(),
        image: solid(8, 8, [255, 0, 0, 255]),
    }];
    let atlas = pack(&inputs, &PackOptions::default()).unwrap();

    // 输出目录里放着用户自己的素材
    std::fs::write(dir.join("my_hero.png"), b"user asset").unwrap();

    let err = write_atlas(&atlas, &dir, "atlas", &JsonOptions::default()).unwrap_err();
    assert!(err.contains("本工具之外的文件"), "实际错误：{err}");

    // 关键：用户的文件原封不动，而且什么都没写出来
    assert_eq!(
        std::fs::read(dir.join("my_hero.png")).unwrap(),
        b"user asset"
    );
    assert!(!dir.join("atlas.png").exists(), "中止后不应写出任何内容");

    // 换成空目录就能正常写出；重复打包也应放行（目录里都是我们自己写的）
    let clean = std::env::temp_dir().join("slicer_io_write_atlas_guard_clean");
    let _ = std::fs::remove_dir_all(&clean);
    write_atlas(&atlas, &clean, "atlas", &JsonOptions::default()).unwrap();
    assert!(clean.join("atlas.png").is_file());
    write_atlas(&atlas, &clean, "atlas", &JsonOptions::default())
        .expect("同一个图集重复打包不应被护栏拦住");

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&clean);
}

#[test]
fn plan_atlas_dir_gives_each_atlas_its_own_layer() {
    let root = PathBuf::from("out");
    assert_eq!(plan_atlas_dir(&root, "atlas"), PathBuf::from("out/atlas"));
    assert_eq!(plan_atlas_dir(&root, "hero"), PathBuf::from("out/hero"));
    // 两个不同的基础名永远不会落到同一个目录 —— 这正是"两次打包互相覆盖"的根治点
    assert_ne!(
        plan_atlas_dir(&root, "atlas"),
        plan_atlas_dir(&root, "hero")
    );
}

// ───────────────────────────── 异常输入 ─────────────────────────────

#[test]
fn fully_transparent_input_is_rejected_with_a_warning() {
    let input = PackInput {
        name: "blank.png".into(),
        image: RgbaImage::new(8, 8),
    };
    let err = pack(&[input], &PackOptions::default()).unwrap_err();
    assert!(err.contains("没有可打包的内容"), "实际错误：{err}");
}

#[test]
fn blank_inputs_are_skipped_but_the_rest_still_packs() {
    let inputs = vec![
        PackInput {
            name: "blank.png".into(),
            image: RgbaImage::new(8, 8),
        },
        PackInput {
            name: "real.png".into(),
            image: solid(10, 10, [0, 255, 0, 255]),
        },
    ];
    let atlas = pack(&inputs, &PackOptions::default()).unwrap();

    assert_eq!(atlas.frame_count(), 1);
    assert_eq!(atlas.pages[0].frames[0].filename, "real.png");
    assert_eq!(atlas.warnings.len(), 1, "应记录一条警告");
    assert!(atlas.warnings[0].contains("blank.png"));
}
