//! 后处理：按间隔合并碎片、按阅读顺序排序。

use crate::components::Component;

/// 把间隔小于 `merge_gap` 像素的矩形合并成一个。
///
/// 语义说明：`merge_gap = 0` 表示**从不合并**；`merge_gap = 1` 会合并
/// 紧邻（间隔 0 像素）的矩形；`merge_gap = 3` 会合并间隔 0、1、2 像素的矩形。
///
/// 典型用途：一个 sprite 被腐蚀切成了两三块，或者被花纹挖出了空洞导致断开。
pub fn merge_rects(mut comps: Vec<Component>, merge_gap: u32) -> Vec<Component> {
    if merge_gap == 0 || comps.len() < 2 {
        return comps;
    }

    loop {
        let mut merged_any = false;

        'scan: for i in 0..comps.len() {
            for j in (i + 1)..comps.len() {
                if comps[i].rect.gap_to(&comps[j].rect) < merge_gap {
                    let union = comps[i].rect.union(&comps[j].rect);
                    let pixels = comps[i].pixels.saturating_add(comps[j].pixels);
                    comps[i].rect = union;
                    comps[i].pixels = pixels;
                    comps.remove(j);
                    merged_any = true;
                    break 'scan;
                }
            }
        }

        if !merged_any {
            return comps;
        }
    }
}

/// 按"从上到下、从左到右"的阅读顺序排序。
///
/// 直接按 (y, x) 排序是不够的：同一行里不同 sprite 的高度不同，
/// y 坐标会参差不齐，导致行被打散。这里先按纵向重叠度分行，
/// 再在行内按 x 排序。
pub fn sort_row_major(comps: &mut Vec<Component>) {
    if comps.len() < 2 {
        return;
    }

    let mut sorted: Vec<Component> = std::mem::take(comps);
    sorted.sort_by_key(|c| (c.rect.y, c.rect.x));

    let mut rows: Vec<Vec<Component>> = Vec::new();

    for c in sorted {
        // 先只读地判断"是否属于上一行"，再决定要不要移动 c。
        let same_row = match rows.last() {
            Some(row) => {
                let row_top = row.iter().map(|s| s.rect.y).min().unwrap_or(c.rect.y);
                let row_bottom = row
                    .iter()
                    .map(|s| s.rect.bottom())
                    .max()
                    .unwrap_or(c.rect.bottom());
                let row_h = row_bottom - row_top;

                let overlap_top = row_top.max(c.rect.y);
                let overlap_bottom = row_bottom.min(c.rect.bottom());
                let overlap = overlap_bottom.saturating_sub(overlap_top);

                // 纵向重叠超过较矮者的一半，就认为属于同一行。
                let shorter = row_h.min(c.rect.h).max(1);
                overlap.saturating_mul(2) >= shorter
            }
            None => false,
        };

        if same_row {
            rows.last_mut().expect("same_row 为真时必然有上一行").push(c);
        } else {
            rows.push(vec![c]);
        }
    }

    let mut out = Vec::new();
    for mut row in rows {
        row.sort_by_key(|s| s.rect.x);
        out.extend(row);
    }
    *comps = out;
}
