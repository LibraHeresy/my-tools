//! 连通域标记：两遍扫描 + 并查集。
//!
//! 只在"第一遍已经扫过"的邻居里找标签，所以内存只需要一张标签图
//! 加上一张与**临时标签数**（而非像素数）成正比的并查集表。

use crate::Rect;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Connectivity {
    /// 4 邻域（上下左右）。更保守，不会把对角相接的像素判为同一块。
    Four,
    /// 8 邻域（含对角）。sprite sheet 的默认选择。
    Eight,
}

/// 一个连通域：包围盒 + 前景像素数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Component {
    pub rect: Rect,
    pub pixels: u32,
}

struct DisjointSet {
    parent: Vec<u32>,
}

impl DisjointSet {
    fn new() -> Self {
        Self { parent: vec![0] } // 索引 0 占位，标签从 1 开始
    }

    fn push_label(&mut self) -> u32 {
        let id = self.parent.len() as u32;
        self.parent.push(id);
        id
    }

    fn find(&mut self, mut x: u32) -> u32 {
        while self.parent[x as usize] != x {
            let grand = self.parent[self.parent[x as usize] as usize];
            self.parent[x as usize] = grand;
            x = grand;
        }
        x
    }

    /// 总是把较大的根挂到较小的根上，保证结果与扫描顺序无关。
    fn union(&mut self, a: u32, b: u32) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            let (lo, hi) = if ra < rb { (ra, rb) } else { (rb, ra) };
            self.parent[hi as usize] = lo;
        }
    }
}

/// 对二值掩码做连通域标记，返回每个连通域的紧致包围盒与像素数。
///
/// 返回顺序不确定（取决于像素扫描顺序），调用方如需稳定顺序应自行排序。
pub fn label_components(mask: &[bool], w: u32, h: u32, conn: Connectivity) -> Vec<Component> {
    if w == 0 || h == 0 || mask.is_empty() {
        return Vec::new();
    }

    let wi = w as i64;
    let hi = h as i64;
    let stride = w as usize;

    // 第一遍：临时标签 + 等价关系。
    let mut labels = vec![0u32; mask.len()];
    let mut ds = DisjointSet::new();

    // 只查"已经扫过"的邻居，因此偏移量固定为左 / 左上 / 上 / 右上。
    let offsets: &[(i64, i64)] = match conn {
        Connectivity::Four => &[(-1, 0), (0, -1)],
        Connectivity::Eight => &[(-1, 0), (-1, -1), (0, -1), (1, -1)],
    };

    for y in 0..hi {
        for x in 0..wi {
            let idx = (y as usize) * stride + x as usize;
            if !mask[idx] {
                continue;
            }

            let mut chosen = 0u32;
            let mut seen: [u32; 4] = [0; 4];
            let mut seen_len = 0usize;

            for &(dx, dy) in offsets {
                let nx = x + dx;
                let ny = y + dy;
                if nx < 0 || ny < 0 || nx >= wi || ny >= hi {
                    continue;
                }
                let n = labels[(ny as usize) * stride + nx as usize];
                if n == 0 {
                    continue;
                }
                if chosen == 0 || n < chosen {
                    chosen = n;
                }
                seen[seen_len] = n;
                seen_len += 1;
            }

            if chosen == 0 {
                chosen = ds.push_label();
            } else {
                for &n in &seen[..seen_len] {
                    ds.union(chosen, n);
                }
            }
            labels[idx] = chosen;
        }
    }

    // 第二遍：把临时标签归并到根，并就地累积包围盒与像素数。
    let mut compact_of_root = vec![0u32; ds.parent.len()];
    let mut comps: Vec<Component> = Vec::new();

    for y in 0..hi {
        for x in 0..wi {
            let idx = (y as usize) * stride + x as usize;
            let l = labels[idx];
            if l == 0 {
                continue;
            }
            let root = ds.find(l);
            let mut c = compact_of_root[root as usize];
            if c == 0 {
                c = comps.len() as u32 + 1;
                compact_of_root[root as usize] = c;
                comps.push(Component {
                    rect: Rect::new(x as u32, y as u32, 1, 1),
                    pixels: 0,
                });
            }

            let comp = &mut comps[(c - 1) as usize];
            let min_x = comp.rect.x.min(x as u32);
            let min_y = comp.rect.y.min(y as u32);
            let max_x = comp.rect.right().max(x as u32 + 1);
            let max_y = comp.rect.bottom().max(y as u32 + 1);
            comp.rect = Rect::new(min_x, min_y, max_x - min_x, max_y - min_y);
            comp.pixels += 1;
        }
    }

    comps
}
