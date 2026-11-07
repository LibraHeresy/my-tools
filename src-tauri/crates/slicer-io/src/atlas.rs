//! 图集数据模型 + TexturePacker JSON 导出。
//!
//! **拆（slice）和合（pack）共用这一份模型**，这不是为了省代码，而是为了换来一件事：
//!
//! > 切图产出的描述文件可以直接喂给打包器。于是"切开再打包回去、逐像素比对"
//! > 成为一个天然的往返测试，也是这类工具最好的回归测试。
//!
//! ## 关于 TexturePacker JSON 的三个字段
//!
//! 这是整个格式里最容易做错的地方，做错了引擎里所有贴图都会错位：
//!
//! | 字段 | 含义 |
//! |---|---|
//! | `frame` | 精灵**在图集里**的位置和尺寸 |
//! | `sourceSize` | 精灵**原始帧**的尺寸（裁剪之前） |
//! | `spriteSourceSize` | 裁剪后的内容在原始帧里的矩形（`x`/`y` 是偏移） |
//!
//! 关闭 trim 时，`spriteSourceSize` 为 `{0,0,w,h}` 且 `trimmed = false`。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RectI {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl RectI {
    pub const fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        Self { x, y, w, h }
    }

    pub const fn right(&self) -> i32 {
        self.x + self.w
    }

    pub const fn bottom(&self) -> i32 {
        self.y + self.h
    }

    pub const fn is_empty(&self) -> bool {
        self.w <= 0 || self.h <= 0
    }

    /// 半开区间是否相交（用于测试断言"两个精灵不重叠"）。
    pub fn intersects(&self, other: &RectI) -> bool {
        self.x < other.right()
            && other.x < self.right()
            && self.y < other.bottom()
            && other.y < self.bottom()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SizeI {
    pub w: i32,
    pub h: i32,
}

/// 一帧。字段顺序即 JSON 里的键顺序，按 TexturePacker 的习惯排列以便肉眼比对。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtlasFrame {
    pub filename: String,
    pub frame: RectI,
    #[serde(default)]
    pub rotated: bool,
    #[serde(default)]
    pub trimmed: bool,
    #[serde(rename = "spriteSourceSize")]
    pub sprite_source_size: RectI,
    #[serde(rename = "sourceSize")]
    pub source_size: SizeI,
}

/// 图集的一页。
#[derive(Debug)]
pub struct AtlasPage {
    /// 输出图片文件名，如 `atlas.png`
    pub image_name: String,
    pub width: u32,
    pub height: u32,
    pub frames: Vec<AtlasFrame>,
    /// 位图本身。不参与序列化。
    pub image: image::RgbaImage,
}

/// 一份图集。
///
/// `pages` 从第一天就是 `Vec`——即使当前版本通常只产出 1 页。
/// 这样以后加多页不需要动数据模型，也不会破坏已导出的格式。
#[derive(Debug)]
pub struct Atlas {
    pub pages: Vec<AtlasPage>,
    /// 打包过程中的非致命问题（例如空图片被跳过）。
    pub warnings: Vec<String>,
}

impl Atlas {
    pub fn is_empty(&self) -> bool {
        self.pages.iter().all(|p| p.frames.is_empty())
    }

    pub fn frame_count(&self) -> usize {
        self.pages.iter().map(|p| p.frames.len()).sum()
    }
}

/// `frames` 的两种排布。TexturePacker 两种都支持，消费方要求不一。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JsonLayout {
    /// `"frames": [ {filename, ...}, ... ]`
    Array,
    /// `"frames": { "name.png": { ... } }`
    Hash,
}

#[derive(Debug, Clone, Copy)]
pub struct JsonOptions {
    pub layout: JsonLayout,
    /// 写进 `meta.app`。用我们自己的名字——这是信息字段，不是来源声明。
    pub app: &'static str,
}

impl Default for JsonOptions {
    fn default() -> Self {
        Self {
            layout: JsonLayout::Array,
            app: "sprite-slicer",
        }
    }
}

/// 把一页序列化成 TexturePacker JSON。
///
/// 刻意只接收元数据而不是 `&AtlasPage`：`AtlasPage` 持有位图，
/// 这里不该为了写一份 JSON 就把整张图 clone 一遍。
///
/// 帧按文件名排序，保证同样的输入产出完全一致的 JSON（便于 git diff 与缓存）。
pub fn page_to_json(
    image_name: &str,
    width: u32,
    height: u32,
    frames: &[AtlasFrame],
    opts: &JsonOptions,
) -> serde_json::Value {
    let mut sorted = frames.to_vec();
    sorted.sort_by(|a, b| a.filename.cmp(&b.filename));

    let frames_value = match opts.layout {
        JsonLayout::Array => serde_json::to_value(&sorted).unwrap_or(serde_json::Value::Null),
        JsonLayout::Hash => {
            let mut map = serde_json::Map::new();
            for f in &sorted {
                if let Ok(v) = serde_json::to_value(f) {
                    map.insert(f.filename.clone(), v);
                }
            }
            serde_json::Value::Object(map)
        }
    };

    serde_json::json!({
        "frames": frames_value,
        "meta": {
            "app": opts.app,
            "version": "1.0",
            "image": image_name,
            "format": "RGBA8888",
            "size": { "w": width, "h": height },
            "scale": "1",
        }
    })
}

/// 写一份 TexturePacker JSON 到磁盘。
pub fn write_page_json(
    path: &std::path::Path,
    image_name: &str,
    width: u32,
    height: u32,
    frames: &[AtlasFrame],
    opts: &JsonOptions,
) -> Result<(), String> {
    let json = page_to_json(image_name, width, height, frames, opts);
    std::fs::write(
        path,
        serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写入 {} 失败：{e}", path.display()))
}

/// 给一页起名字：第 0 页用 base，之后用 base_1、base_2……
///
/// 与 TexturePacker 的命名习惯一致：单页时就是 `atlas.png` / `atlas.json`。
pub fn page_file_names(base: &str, index: usize) -> (String, String) {
    if index == 0 {
        (format!("{base}.png"), format!("{base}.json"))
    } else {
        (format!("{base}_{index}.png"), format!("{base}_{index}.json"))
    }
}
