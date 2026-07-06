import Cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function averageBlock(source, rowstride, nChannels, x0, y0, x1, y1) {
    let r = 0, g = 0, b = 0, a = 0, count = 0;

    for (let y = y0; y < y1; y++) {
        let off = y * rowstride + x0 * nChannels;
        for (let x = x0; x < x1; x++) {
            r += source[off];
            g += source[off + 1];
            b += source[off + 2];
            if (nChannels >= 4) a += source[off + 3];
            off += nChannels;
            count++;
        }
    }

    if (count === 0) return [0, 0, 0, 0];
    return [
        Math.round(r / count),
        Math.round(g / count),
        Math.round(b / count),
        nChannels >= 4 ? Math.round(a / count) : 255,
    ];
}

function _getBlocksInBounds(width, height, points, brushWidth, blockSize, originX = 0, originY = 0) {
    if (!points || points.length === 0) return [];

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    let minX = Math.min(...xs);
    let minY = Math.min(...ys);
    let maxX = Math.max(...xs);
    let maxY = Math.max(...ys);

    const pad = brushWidth / 2 + blockSize;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width, maxX + pad);
    maxY = Math.min(height, maxY + pad);

    const startBX = Math.floor((minX - originX) / blockSize);
    const startBY = Math.floor((minY - originY) / blockSize);
    const endBX = Math.ceil((maxX - originX) / blockSize);
    const endBY = Math.ceil((maxY - originY) / blockSize);

    const blocks = [];
    for (let by = startBY; by < endBY; by++) {
        for (let bx = startBX; bx < endBX; bx++) {
            const rawX = originX + bx * blockSize;
            const rawY = originY + by * blockSize;
            const x = Math.max(0, Math.min(width, rawX));
            const y = Math.max(0, Math.min(height, rawY));
            const w = Math.min(width - x, blockSize);
            const h = Math.min(height - y, blockSize);
            if (w > 0 && h > 0)
                blocks.push({ x, y, w, h });
        }
    }

    return blocks;
}

function _drawStrokeMaskSurface(width, height, points, brushWidth) {
    const surface = new Cairo.ImageSurface(Cairo.Format.A8, width, height);
    const ctx = new Cairo.Context(surface);

    ctx.setSourceRGBA(0, 0, 0, 0);
    ctx.paint();

    ctx.setSourceRGBA(1, 1, 1, 1);
    ctx.setLineWidth(brushWidth);
    ctx.setLineCap(Cairo.LineCap.ROUND);
    ctx.setLineJoin(Cairo.LineJoin.ROUND);
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++)
        ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();

    ctx.$dispose();
    return surface;
}

function _createMaskedBlocksSurface(pixbuf, points, brushWidth, blockSize, originX = 0, originY = 0) {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const source = pixbuf.get_pixels();
    const rowstride = pixbuf.get_rowstride();
    const nChannels = pixbuf.get_n_channels();

    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
    const ctx = new Cairo.Context(surface);

    const blocks = _getBlocksInBounds(width, height, points, brushWidth, blockSize, originX, originY);
    for (const b of blocks) {
        const [r, g, b_, a] = averageBlock(source, rowstride, nChannels, b.x, b.y, b.x + b.w, b.y + b.h);
        ctx.setSourceRGBA(r / 255, g / 255, b_ / 255, 1.0);
        ctx.rectangle(b.x, b.y, b.w, b.h);
        ctx.fill();
    }

    const maskSurf = _drawStrokeMaskSurface(width, height, points, brushWidth);
    ctx.setOperator(Cairo.Operator.DEST_IN);
    ctx.setSourceSurface(maskSurf, 0, 0);
    ctx.paint();
    maskSurf.finish();

    ctx.$dispose();
    return surface;
}

function makePixbufFromData(source, pixbuf) {
    const target = new Uint8Array(source);
    const bytes = GLib.Bytes.new(target);
    return GdkPixbuf.Pixbuf.new_from_bytes(
        bytes,
        GdkPixbuf.Colorspace.RGB,
        pixbuf.get_has_alpha(),
        pixbuf.get_bits_per_sample(),
        pixbuf.get_width(),
        pixbuf.get_height(),
        pixbuf.get_rowstride()
    );
}

export function pixelatePixbufAlongStroke(pixbuf, points, brushWidth, blockSize, originX = 0, originY = 0) {
    if (!pixbuf || !points || points.length < 2) return pixbuf;

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (width <= 0 || height <= 0) return pixbuf;

    const srcSurf = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
    const srcCtx = new Cairo.Context(srcSurf);
    imports.gi.Gdk.cairo_set_source_pixbuf(srcCtx, pixbuf, 0, 0);
    srcCtx.paint();
    srcCtx.$dispose();

    const blockSurf = _createMaskedBlocksSurface(pixbuf, points, brushWidth, blockSize, originX, originY);

    const resultCtx = new Cairo.Context(srcSurf);
    resultCtx.setSourceSurface(blockSurf, 0, 0);
    resultCtx.paint();
    resultCtx.$dispose();
    blockSurf.finish();

    const result = imports.gi.Gdk.pixbuf_get_from_surface(srcSurf, 0, 0, width, height);
    srcSurf.finish();
    return result || pixbuf;
}

export function pixelatePixbufRect(pixbuf, p0, p1, blockSize, originX = 0, originY = 0) {
    if (!pixbuf) return pixbuf;

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (width <= 0 || height <= 0) return pixbuf;

    const rx = Math.round(Math.min(p0.x, p1.x));
    const ry = Math.round(Math.min(p0.y, p1.y));
    const rw = Math.round(Math.abs(p1.x - p0.x));
    const rh = Math.round(Math.abs(p1.y - p0.y));

    const cx = Math.max(0, Math.min(rx, width));
    const cy = Math.max(0, Math.min(ry, height));
    const cw = Math.max(0, Math.min(rw, width - cx));
    const ch = Math.max(0, Math.min(rh, height - cy));
    if (cw <= 0 || ch <= 0) return pixbuf;

    const source = pixbuf.get_pixels();
    const rowstride = pixbuf.get_rowstride();
    const nChannels = pixbuf.get_n_channels();
    const target = new Uint8Array(source);

    const startBX = Math.floor((cx - originX) / blockSize);
    const startBY = Math.floor((cy - originY) / blockSize);
    const endBX = Math.ceil((cx + cw - originX) / blockSize);
    const endBY = Math.ceil((cy + ch - originY) / blockSize);

    for (let by = startBY; by < endBY; by++) {
        for (let bx = startBX; bx < endBX; bx++) {
            const rawX = originX + bx * blockSize;
            const rawY = originY + by * blockSize;
            const x0 = Math.max(cx, rawX);
            const y0 = Math.max(cy, rawY);
            const x1 = Math.min(cx + cw, rawX + blockSize);
            const y1 = Math.min(cy + ch, rawY + blockSize);
            if (x1 <= x0 || y1 <= y0) continue;
            const color = averageBlock(source, rowstride, nChannels, x0, y0, x1, y1);
            fillBlock(target, rowstride, nChannels, x0, y0, x1, y1, color);
        }
    }

    const bytes = GLib.Bytes.new(target);
    return GdkPixbuf.Pixbuf.new_from_bytes(
        bytes,
        GdkPixbuf.Colorspace.RGB,
        pixbuf.get_has_alpha(),
        pixbuf.get_bits_per_sample(),
        pixbuf.get_width(),
        pixbuf.get_height(),
        pixbuf.get_rowstride()
    );
}

function fillBlock(target, rowstride, nChannels, x0, y0, x1, y1, color) {
    for (let y = y0; y < y1; y++) {
        let off = y * rowstride + x0 * nChannels;
        for (let x = x0; x < x1; x++) {
            target[off] = color[0];
            target[off + 1] = color[1];
            target[off + 2] = color[2];
            if (nChannels >= 4) target[off + 3] = color[3];
            off += nChannels;
        }
    }
}

export function getAffectedPreviewSurface(pixbuf, points, brushWidth, blockSize, originX = 0, originY = 0) {
    if (!pixbuf || !points || points.length < 2) return null;

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (width <= 0 || height <= 0) return null;

    return _createMaskedBlocksSurface(pixbuf, points, brushWidth, blockSize, originX, originY);
}

export function getRectBlocks(pixbuf, p0, p1, blockSize, originX = 0, originY = 0) {
    if (!pixbuf) return [];

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (width <= 0 || height <= 0) return [];

    const rx = Math.round(Math.min(p0.x, p1.x));
    const ry = Math.round(Math.min(p0.y, p1.y));
    const rw = Math.round(Math.abs(p1.x - p0.x));
    const rh = Math.round(Math.abs(p1.y - p0.y));

    const cx = Math.max(0, Math.min(rx, width));
    const cy = Math.max(0, Math.min(ry, height));
    const cw = Math.max(0, Math.min(rw, width - cx));
    const ch = Math.max(0, Math.min(rh, height - cy));
    if (cw <= 0 || ch <= 0) return [];

    const source = pixbuf.get_pixels();
    const rowstride = pixbuf.get_rowstride();
    const nChannels = pixbuf.get_n_channels();
    const blocks = [];

    const startBX = Math.floor((cx - originX) / blockSize);
    const startBY = Math.floor((cy - originY) / blockSize);
    const endBX = Math.ceil((cx + cw - originX) / blockSize);
    const endBY = Math.ceil((cy + ch - originY) / blockSize);

    for (let by = startBY; by < endBY; by++) {
        for (let bx = startBX; bx < endBX; bx++) {
            const rawX = originX + bx * blockSize;
            const rawY = originY + by * blockSize;
            const x0 = Math.max(cx, rawX);
            const y0 = Math.max(cy, rawY);
            const x1 = Math.min(cx + cw, rawX + blockSize);
            const y1 = Math.min(cy + ch, rawY + blockSize);
            if (x1 <= x0 || y1 <= y0) continue;
            const [r, g, b] = averageBlock(source, rowstride, nChannels, x0, y0, x1, y1);
            blocks.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, r: r / 255, g: g / 255, b: b / 255 });
        }
    }

    return blocks;
}
