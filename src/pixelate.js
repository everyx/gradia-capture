import Cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

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

function _forEachBlockInRect(rectAbs, blockSize, originAbsX, originAbsY, fn) {
    const { x: cx, y: cy, w: cw, h: ch } = rectAbs;
    const startBX = Math.floor((cx - originAbsX) / blockSize);
    const startBY = Math.floor((cy - originAbsY) / blockSize);
    const endBX = Math.ceil((cx + cw - originAbsX) / blockSize);
    const endBY = Math.ceil((cy + ch - originAbsY) / blockSize);

    for (let by = startBY; by < endBY; by++) {
        for (let bx = startBX; bx < endBX; bx++) {
            const rawX = originAbsX + bx * blockSize;
            const rawY = originAbsY + by * blockSize;
            const x0 = Math.max(cx, rawX);
            const y0 = Math.max(cy, rawY);
            const x1 = Math.min(cx + cw, rawX + blockSize);
            const y1 = Math.min(cy + ch, rawY + blockSize);
            if (x1 <= x0 || y1 <= y0) continue;
            fn(x0, y0, x1, y1);
        }
    }
}

function _getBlocksInBounds(regionAbs, pointsAbs, brushWidth, blockSize, originAbsX = 0, originAbsY = 0) {
    if (!pointsAbs || pointsAbs.length === 0) return [];

    const xs = pointsAbs.map(p => p.x);
    const ys = pointsAbs.map(p => p.y);
    let minX = Math.min(...xs);
    let minY = Math.min(...ys);
    let maxX = Math.max(...xs);
    let maxY = Math.max(...ys);

    const pad = brushWidth / 2 + blockSize;
    minX = Math.max(regionAbs.x, minX - pad);
    minY = Math.max(regionAbs.y, minY - pad);
    maxX = Math.min(regionAbs.x + regionAbs.w, maxX + pad);
    maxY = Math.min(regionAbs.y + regionAbs.h, maxY + pad);

    const startBX = Math.floor((minX - originAbsX) / blockSize);
    const startBY = Math.floor((minY - originAbsY) / blockSize);
    const endBX = Math.ceil((maxX - originAbsX) / blockSize);
    const endBY = Math.ceil((maxY - originAbsY) / blockSize);

    const blocks = [];
    for (let by = startBY; by < endBY; by++) {
        for (let bx = startBX; bx < endBX; bx++) {
            const rawX = originAbsX + bx * blockSize;
            const rawY = originAbsY + by * blockSize;
            const x = Math.max(regionAbs.x, Math.min(regionAbs.x + regionAbs.w, rawX));
            const y = Math.max(regionAbs.y, Math.min(regionAbs.y + regionAbs.h, rawY));
            const w = Math.min(regionAbs.x + regionAbs.w - x, blockSize);
            const h = Math.min(regionAbs.y + regionAbs.h - y, blockSize);
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

function _createMaskedBlocksSurface(pixbuf, regionAbs, pointsAbs, brushWidth, blockSize, originAbsX = 0, originAbsY = 0) {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const source = pixbuf.get_pixels();
    const rowstride = pixbuf.get_rowstride();
    const nChannels = pixbuf.get_n_channels();

    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
    const ctx = new Cairo.Context(surface);

    const blocks = _getBlocksInBounds(regionAbs, pointsAbs, brushWidth, blockSize, originAbsX, originAbsY);
    for (const b of blocks) {
        const px = b.x - regionAbs.x;
        const py = b.y - regionAbs.y;
        const [r, g, b_, a] = averageBlock(source, rowstride, nChannels, px, py, px + b.w, py + b.h);
        ctx.setSourceRGBA(r / 255, g / 255, b_ / 255, 1.0);
        ctx.rectangle(px, py, b.w, b.h);
        ctx.fill();
    }

    const relPoints = pointsAbs.map(p => ({ x: p.x - regionAbs.x, y: p.y - regionAbs.y }));
    const maskSurf = _drawStrokeMaskSurface(width, height, relPoints, brushWidth);
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

export function pixelatePixbufAlongStroke(pixbuf, regionAbs, pointsAbs, brushWidth, blockSize, originAbsX = 0, originAbsY = 0) {
    if (!pixbuf || !pointsAbs || pointsAbs.length < 2) return pixbuf;

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (width <= 0 || height <= 0) return pixbuf;

    const srcSurf = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
    const srcCtx = new Cairo.Context(srcSurf);
    imports.gi.Gdk.cairo_set_source_pixbuf(srcCtx, pixbuf, 0, 0);
    srcCtx.paint();
    srcCtx.$dispose();

    const blockSurf = _createMaskedBlocksSurface(pixbuf, regionAbs, pointsAbs, brushWidth, blockSize, originAbsX, originAbsY);

    const resultCtx = new Cairo.Context(srcSurf);
    resultCtx.setSourceSurface(blockSurf, 0, 0);
    resultCtx.paint();
    resultCtx.$dispose();
    blockSurf.finish();

    const result = imports.gi.Gdk.pixbuf_get_from_surface(srcSurf, 0, 0, width, height);
    srcSurf.finish();
    return result || pixbuf;
}

export function pixelatePixbufRect(pixbuf, regionAbs, p0Abs, p1Abs, blockSize, originAbsX = 0, originAbsY = 0) {
    if (!pixbuf) return pixbuf;

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (width <= 0 || height <= 0) return pixbuf;

    const rx = Math.round(Math.min(p0Abs.x, p1Abs.x));
    const ry = Math.round(Math.min(p0Abs.y, p1Abs.y));
    const rw = Math.round(Math.abs(p1Abs.x - p0Abs.x));
    const rh = Math.round(Math.abs(p1Abs.y - p0Abs.y));

    const cxAbs = Math.max(regionAbs.x, Math.min(rx, regionAbs.x + regionAbs.w));
    const cyAbs = Math.max(regionAbs.y, Math.min(ry, regionAbs.y + regionAbs.h));
    const cwAbs = Math.max(1, Math.min(rw, regionAbs.x + regionAbs.w - cxAbs));
    const chAbs = Math.max(1, Math.min(rh, regionAbs.y + regionAbs.h - cyAbs));

    const source = pixbuf.get_pixels();
    const rowstride = pixbuf.get_rowstride();
    const nChannels = pixbuf.get_n_channels();
    const target = new Uint8Array(source);

    _forEachBlockInRect({ x: cxAbs, y: cyAbs, w: cwAbs, h: chAbs }, blockSize, originAbsX, originAbsY, (x0, y0, x1, y1) => {
        const px = x0 - regionAbs.x;
        const py = y0 - regionAbs.y;
        const color = averageBlock(source, rowstride, nChannels, px, py, px + (x1 - x0), py + (y1 - y0));
        fillBlock(target, rowstride, nChannels, px, py, px + (x1 - x0), py + (y1 - y0), color);
    });

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

export function getAffectedPreviewSurface(pixbuf, regionAbs, pointsAbs, brushWidth, blockSize, originAbsX = 0, originAbsY = 0) {
    if (!pixbuf || !pointsAbs || pointsAbs.length < 2) return null;

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (width <= 0 || height <= 0) return null;

    return _createMaskedBlocksSurface(pixbuf, regionAbs, pointsAbs, brushWidth, blockSize, originAbsX, originAbsY);
}

export function getAffectedRectPreviewSurface(pixbuf, regionAbs, blockSize, originAbsX = 0, originAbsY = 0) {
    if (!pixbuf) return null;

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (width <= 0 || height <= 0) return null;

    const cw = Math.max(1, Math.min(regionAbs.w, width));
    const ch = Math.max(1, Math.min(regionAbs.h, height));

    const source = pixbuf.get_pixels();
    const rowstride = pixbuf.get_rowstride();
    const nChannels = pixbuf.get_n_channels();

    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, cw, ch);
    const ctx = new Cairo.Context(surface);

    _forEachBlockInRect({ x: regionAbs.x, y: regionAbs.y, w: cw, h: ch }, blockSize, originAbsX, originAbsY, (x0, y0, x1, y1) => {
        const px = x0 - regionAbs.x;
        const py = y0 - regionAbs.y;
        const [r, g, b] = averageBlock(source, rowstride, nChannels, px, py, px + (x1 - x0), py + (y1 - y0));
        ctx.setSourceRGBA(r / 255, g / 255, b / 255, 1.0);
        ctx.rectangle(px, py, x1 - x0, y1 - y0);
        ctx.fill();
    });

    ctx.$dispose();
    return surface;
}
