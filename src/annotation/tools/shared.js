import Cairo from 'gi://cairo';

export const SELECTION_PADDING = 8;
const PIXELATE_BLOCK_SIZE = 16;

let _patternCache = null;

export function createPixelatePattern(blockSize) {
    const size = blockSize || PIXELATE_BLOCK_SIZE;
    if (_patternCache && _patternCache._size === size) return _patternCache;
    const ts = size * 2;
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, ts, ts);
    const cr = new Cairo.Context(surface);
    cr.setSourceRGB(1, 1, 1);
    cr.paint();
    cr.setSourceRGB(0, 0, 0);
    cr.rectangle(0, 0, size, size);
    cr.rectangle(size, size, size, size);
    cr.fill();
    cr.$dispose();
    const pattern = new Cairo.SurfacePattern(surface);
    pattern.setExtend(Cairo.Extend.REPEAT);
    pattern.setFilter(Cairo.Filter.NEAREST);
    pattern._size = size;
    _patternCache = pattern;
    return pattern;
}

export function hexToRgb(hex) {
    return {
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255,
    };
}

export function rectBounds(pts, pad) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function rectHit(bounds, sx, sy) {
    return sx >= bounds.minX && sx <= bounds.maxX && sy >= bounds.minY && sy <= bounds.maxY;
}

export function standardHitTest(stroke, sx, sy) {
    return rectHit(this.bounds(stroke), sx, sy);
}
