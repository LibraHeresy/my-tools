//! 二值化与形态学。
//!
//! 这一层只做"哪些像素属于前景"，不关心它们如何分组。

/// 二值前景掩码：alpha 严格大于阈值即视为前景。
///
/// 默认阈值建议为 1（即 alpha > 0）。对带有投影阴影或发光的图集，
/// 调高阈值可以把淡淡的边缘排除掉，代价是会切掉抗锯齿边缘。
pub fn build_mask(rgba: &[u8], threshold: u8) -> Vec<bool> {
    rgba.chunks_exact(4).map(|p| p[3] > threshold).collect()
}

/// 3x3 全邻域腐蚀，迭代 `iterations` 次。越界视为背景。
///
/// 用途只有一个：**断开**因抗锯齿、阴影、描边而粘在一起的两个 sprite。
/// 它会同时把每个连通域收缩 `iterations` 像素，所以调用方必须把包围盒
/// 再向外膨胀相同的像素数（见 `Rect::dilate`）。
pub fn erode(mask: &[bool], w: u32, h: u32, iterations: u8) -> Vec<bool> {
    if iterations == 0 {
        return mask.to_vec();
    }
    let wi = w as i64;
    let hi = h as i64;
    let mut cur = mask.to_vec();

    for _ in 0..iterations {
        let mut next = vec![false; cur.len()];
        for y in 0..hi {
            for x in 0..wi {
                let mut survives = true;
                'nb: for dy in -1..=1i64 {
                    for dx in -1..=1i64 {
                        let nx = x + dx;
                        let ny = y + dy;
                        if nx < 0 || ny < 0 || nx >= wi || ny >= hi {
                            survives = false;
                            break 'nb;
                        }
                        if !cur[(ny as usize) * (w as usize) + nx as usize] {
                            survives = false;
                            break 'nb;
                        }
                    }
                }
                if survives {
                    next[(y as usize) * (w as usize) + x as usize] = true;
                }
            }
        }
        cur = next;
    }
    cur
}
