import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

import { stageToImageCoords, imageScaleFactors, stageLineWidth } from '../../../platform/stageToImage.js';

/*
 * 坐标系不变式（blur 预览/提交路径）
 *
 * 三个度量空间的坐标：
 *   stage 坐标    — 用户输入位置，单位=stage pixel（鼠标/actor 空间）
 *   device 坐标   — 实际像素，= stage × _stageScale (= Main.screenshotUI._scale)
 *   surface 坐标  — 马赛克 surface 内的偏移，原点对应抓取矩形的左上角
 *
 * 关键区域：
 *   region       — 预览矩形（stage 坐标），= _computeBlurRegionBounds(stroke)
 *   regionAbs    — region × _stageScale 取整后的 device 坐标
 *   originAbs    — 第一个落笔点 × _stageScale 取整（block 栅格的锚点）
 *                   **必须用绝对坐标锚定起点**，不可依赖 region，
 *                   否则拖拽时已绘制的马赛克格子会随 region 滑动。
 *
 * 核心陷阱：分数 _stageScale 下
 *   round(A × _stageScale) - round(B × _stageScale) ≠ round((A - B) × _stageScale)
 * 差 ±1 device pixel → 可见抖动。
 *
 * 解法：surface 的放置原点必须用 regionAbs / _stageScale 而非 region。
 *       因为 mask 与 block 坐标都相对于 regionAbs，放置也用 regionAbs/_stageScale，
 *       三个量中的 regionAbs 在屏幕空间坐标里自然消掉：
 *         mask 屏幕位置 = regionAbs/ds + (pts[i]×ds - regionAbs)/ds = pts[i] ✓
 *         block 屏幕位置 = regionAbs/ds + (originAbs - regionAbs)/ds = originAbs/ds ✓
 *       都不依赖 regionAbs → 无抖动。
 */

function _averageBlock(source, rowstride, nChannels, x0, y0, x1, y1, srcW = Infinity, srcH = Infinity) {
    let r = 0,
        g = 0,
        b = 0,
        a = 0,
        count = 0;

    x0 = Math.max(0, Math.min(x0, srcW - 1));
    y0 = Math.max(0, Math.min(y0, srcH - 1));
    x1 = Math.max(x0, Math.min(x1, srcW));
    y1 = Math.max(y0, Math.min(y1, srcH));

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

function _forEachBlockInStroke(regionAbs, pointsAbs, brushWidth, blockSize, fn, originAbsX = 0, originAbsY = 0) {
    if (!pointsAbs || pointsAbs.length === 0) return;

    const xs = pointsAbs.map((p) => p.x);
    const ys = pointsAbs.map((p) => p.y);
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

    for (let by = startBY; by < endBY; by++) {
        for (let bx = startBX; bx < endBX; bx++) {
            const rawX = originAbsX + bx * blockSize;
            const rawY = originAbsY + by * blockSize;
            const x = Math.max(regionAbs.x, Math.min(regionAbs.x + regionAbs.w, rawX));
            const y = Math.max(regionAbs.y, Math.min(regionAbs.y + regionAbs.h, rawY));
            const w = Math.min(regionAbs.x + regionAbs.w - x, blockSize);
            const h = Math.min(regionAbs.y + regionAbs.h - y, blockSize);
            if (w > 0 && h > 0) fn(x, y, w, h);
        }
    }
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
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();

    ctx.$dispose();
    return surface;
}

function _createMaskedBlocksSurface(
    pixbuf,
    regionAbs,
    pointsAbs,
    brushWidth,
    blockSize,
    originAbsX = 0,
    originAbsY = 0,
) {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const source = pixbuf.get_pixels();
    const rowstride = pixbuf.get_rowstride();
    const nChannels = pixbuf.get_n_channels();

    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
    const ctx = new Cairo.Context(surface);

    _forEachBlockInStroke(
        regionAbs,
        pointsAbs,
        brushWidth,
        blockSize,
        (x, y, w, h) => {
            const px = x - regionAbs.x;
            const py = y - regionAbs.y;
            const [r, g, b_, _a] = _averageBlock(source, rowstride, nChannels, px, py, px + w, py + h, width, height);
            ctx.setSourceRGBA(r / 255, g / 255, b_ / 255, 1.0);
            ctx.rectangle(px, py, w, h);
            ctx.fill();
        },
        originAbsX,
        originAbsY,
    );

    const relPoints = pointsAbs.map((p) => ({ x: p.x - regionAbs.x, y: p.y - regionAbs.y }));
    const maskSurf = _drawStrokeMaskSurface(width, height, relPoints, brushWidth);
    ctx.setOperator(Cairo.Operator.DEST_IN);
    ctx.setSourceSurface(maskSurf, 0, 0);
    ctx.paint();
    maskSurf.finish();

    ctx.$dispose();
    return surface;
}

function _pixelateBlock(source, rowstride, nChannels, x0, y0, x1, y1, srcW, srcH) {
    let r = 0,
        g = 0,
        b = 0,
        count = 0;

    x0 = Math.max(0, Math.min(x0, srcW - 1));
    y0 = Math.max(0, Math.min(y0, srcH - 1));
    x1 = Math.max(x0, Math.min(x1, srcW));
    y1 = Math.max(y0, Math.min(y1, srcH));

    for (let y = y0; y < y1; y++) {
        let off = y * rowstride + x0 * nChannels;
        for (let x = x0; x < x1; x++) {
            r += source[off];
            g += source[off + 1];
            b += source[off + 2];
            off += nChannels;
            count++;
        }
    }

    if (count === 0) return;

    const c = new Uint8Array([Math.round(r / count), Math.round(g / count), Math.round(b / count), 255]);

    for (let y = y0; y < y1; y++) {
        let off = y * rowstride + x0 * nChannels;
        for (let x = x0; x < x1; x++) {
            source[off] = c[0];
            source[off + 1] = c[1];
            source[off + 2] = c[2];
            if (nChannels >= 4) source[off + 3] = c[3];
            off += nChannels;
        }
    }
}

function _makePixbufFromData(source, pixbuf) {
    const target = new Uint8Array(source);
    const bytes = GLib.Bytes.new(target);
    return GdkPixbuf.Pixbuf.new_from_bytes(
        bytes,
        GdkPixbuf.Colorspace.RGB,
        pixbuf.get_has_alpha(),
        pixbuf.get_bits_per_sample(),
        pixbuf.get_width(),
        pixbuf.get_height(),
        pixbuf.get_rowstride(),
    );
}

function _pixelatePixbufAlongStroke(
    pixbuf,
    regionAbs,
    pointsAbs,
    brushWidth,
    blockSize,
    originAbsX = 0,
    originAbsY = 0,
) {
    if (!pixbuf || !pointsAbs || pointsAbs.length < 2) return pixbuf;

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (width <= 0 || height <= 0) return pixbuf;

    const srcSurf = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
    const srcCtx = new Cairo.Context(srcSurf);
    imports.gi.Gdk.cairo_set_source_pixbuf(srcCtx, pixbuf, 0, 0);
    srcCtx.paint();
    srcCtx.$dispose();

    const blockSurf = _createMaskedBlocksSurface(
        pixbuf,
        regionAbs,
        pointsAbs,
        brushWidth,
        blockSize,
        originAbsX,
        originAbsY,
    );

    const resultCtx = new Cairo.Context(srcSurf);
    resultCtx.setSourceSurface(blockSurf, 0, 0);
    resultCtx.paint();
    resultCtx.$dispose();
    blockSurf.finish();

    const result = imports.gi.Gdk.pixbuf_get_from_surface(srcSurf, 0, 0, width, height);
    srcSurf.finish();
    return result || pixbuf;
}

function _pixelatePixbufRect(pixbuf, regionAbs, p0Abs, p1Abs, blockSize, originAbsX = 0, originAbsY = 0) {
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

    const rowstride = pixbuf.get_rowstride();
    const nChannels = pixbuf.get_n_channels();
    const srcW = pixbuf.get_width();
    const srcH = pixbuf.get_height();
    const target = new Uint8Array(pixbuf.get_pixels());

    _forEachBlockInRect(
        { x: cxAbs, y: cyAbs, w: cwAbs, h: chAbs },
        blockSize,
        originAbsX,
        originAbsY,
        (x0, y0, x1, y1) => {
            const px = x0 - regionAbs.x;
            const py = y0 - regionAbs.y;
            _pixelateBlock(target, rowstride, nChannels, px, py, px + (x1 - x0), py + (y1 - y0), srcW, srcH);
        },
    );

    return _makePixbufFromData(target, pixbuf);
}

function _getAffectedPreviewSurface(
    pixbuf,
    regionAbs,
    pointsAbs,
    brushWidth,
    blockSize,
    originAbsX = 0,
    originAbsY = 0,
) {
    if (!pixbuf || !pointsAbs || pointsAbs.length < 2) return null;

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (width <= 0 || height <= 0) return null;

    return _createMaskedBlocksSurface(pixbuf, regionAbs, pointsAbs, brushWidth, blockSize, originAbsX, originAbsY);
}

function _getAffectedRectPreviewSurface(pixbuf, regionAbs, blockSize, originAbsX = 0, originAbsY = 0) {
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

    _forEachBlockInRect(
        { x: regionAbs.x, y: regionAbs.y, w: cw, h: ch },
        blockSize,
        originAbsX,
        originAbsY,
        (x0, y0, x1, y1) => {
            const px = x0 - regionAbs.x;
            const py = y0 - regionAbs.y;
            const [r, g, b] = _averageBlock(
                source,
                rowstride,
                nChannels,
                px,
                py,
                px + (x1 - x0),
                py + (y1 - y0),
                width,
                height,
            );
            ctx.setSourceRGBA(r / 255, g / 255, b / 255, 1.0);
            ctx.rectangle(px, py, x1 - x0, y1 - y0);
            ctx.fill();
        },
    );

    ctx.$dispose();
    return surface;
}

function _computeBlurRegionBounds(stroke) {
    const mode = stroke.blurMode || 'brush';
    const blockSize = stroke.blockSize || 16;
    const lw = stroke.strokeWidth || 4;
    const pts = stroke.stagePoints;

    if (mode === 'selection') {
        const p0 = pts[0];
        const p1 = pts[pts.length - 1];
        const maxX = Math.round(Math.max(p0.x, p1.x));
        const maxY = Math.round(Math.max(p0.y, p1.y));
        const minX = Math.round(Math.min(p0.x, p1.x));
        const minY = Math.round(Math.min(p0.y, p1.y));
        return {
            x: minX,
            y: minY,
            w: Math.max(1, maxX - minX),
            h: Math.max(1, maxY - minY),
        };
    }

    const pad = Math.ceil(lw / 2 + blockSize / 2);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const rx = Math.round(Math.max(0, Math.min(...xs) - pad));
    const ry = Math.round(Math.max(0, Math.min(...ys) - pad));
    return {
        x: rx,
        y: ry,
        w: Math.max(1, Math.round(Math.max(...xs) + pad - rx)),
        h: Math.max(1, Math.round(Math.max(...ys) + pad - ry)),
    };
}

export class BlurSelector {
    constructor({
        captureRegion,
        getRegionSync,
        stageScale,
        onBlockSizeChanged,
        forEachCanvas,
        ensureCache,
        toolbar,
        bus,
    }) {
        this._captureRegion = captureRegion;
        this._getRegionSync = getRegionSync;
        this._stageScale = stageScale ?? 1;
        this._onBlockSizeChanged = onBlockSizeChanged ?? (() => {});
        this._forEachCanvas = forEachCanvas ?? (() => {});
        this._ensureCache = ensureCache ?? (() => {});
        this._toolbar = toolbar ?? null;

        this._mode = 'brush';
        this._blockSize = 16;
        this._previewCache = { pixbuf: null };

        this._forEachCanvas((c) => this.registerCanvas(c));

        if (bus) {
            bus.connect('tool-changed', (id) => {
                if (id === 'blur') {
                    this.onActivate();
                    this.refreshCursor(id, this._toolbar?.size);
                }
            });
            if (this._toolbar) {
                this._toolbar.connect('tool-property-changed', (_, payload) => {
                    const props = JSON.parse(payload);
                    if (props.mode !== undefined) this.setMode(props.mode);
                    if (props.blockSize !== undefined) this.setBlockSize(props.blockSize);
                    this.onPropertyChanged(props, this._toolbar?.selectedTool, this._toolbar?.size);
                });
            }
            bus.connect('hover', (stageX, stageY) => {
                this.handleHoverMotion(this._toolbar?.selectedTool, stageX, stageY);
            });
        }

        this._onModeChanged = () => this.refreshCursor(this._toolbar?.selectedTool, this._toolbar?.size);

        if (this._toolbar) this.restoreState(this._toolbar.blurInitialState);
    }

    get mode() {
        return this._mode;
    }
    get blockSize() {
        return this._blockSize;
    }

    setMode(mode) {
        if (this._mode === mode) return;
        this._mode = mode;
        this._onModeChanged(mode);
    }

    setBlockSize(size) {
        const clamped = Math.max(4, Math.min(32, size));
        if (this._blockSize === clamped) return;
        this._blockSize = clamped;
        this._onBlockSizeChanged(clamped);
    }

    adjustBlockSize(delta) {
        this.setBlockSize(this._blockSize + delta);
    }

    restoreState({ blurMode, blockSize }) {
        this._mode = blurMode ?? 'brush';
        this._blockSize = Math.max(4, Math.min(32, blockSize ?? 16));
    }

    registerCanvas(canvas) {
        canvas._onStrokeCommitted = (stroke) => this.onStrokeCommitted(canvas, stroke);
        canvas._onStrokePreview = (c, stroke) => {
            stroke.blurMode = this._mode;
            stroke.blockSize = this._blockSize;
            this.onStrokePreview(c, stroke);
        };
        canvas._onScroll = (event) => this.handleScroll(event);
        canvas._getBlurState = () => ({ mode: this._mode, blockSize: this._blockSize });
        canvas._onRenderBlurStroke = (cr, stroke, ss, c) => this.renderPreviewSurface(cr, stroke, ss, c);
    }

    onActivate() {
        this._ensureCache();
    }

    handleScroll(event) {
        const mods = event.get_state();
        if (!(mods & Clutter.ModifierType.CONTROL_MASK)) return Clutter.EVENT_PROPAGATE;

        let delta = 0;
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP) delta = 2;
        else if (direction === Clutter.ScrollDirection.DOWN) delta = -2;
        else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [, dy] = event.get_scroll_delta();
            if (dy < 0) delta = 2;
            else if (dy > 0) delta = -2;
        }

        if (delta === 0) return Clutter.EVENT_STOP;

        const oldSize = this._blockSize;
        this.adjustBlockSize(delta);
        if (this._blockSize === oldSize) return Clutter.EVENT_STOP;

        this._forEachCanvas((c) => this.refreshPreview(c));
        return Clutter.EVENT_STOP;
    }

    refreshCursor(toolId, size) {
        const [px, py] = global.get_pointer();
        this._forEachCanvas((c) => {
            if (toolId === 'blur' && this._mode === 'brush') {
                c.moveCursor(px, py);
                c.showCursor((size ?? 8) / 2);
            } else if (toolId === 'blur' && this._mode === 'selection') {
                c.hideCursor(Clutter.CursorType.CROSSHAIR);
            } else {
                c.hideCursor();
            }
        });
    }

    handleHoverMotion(toolId, stageX, stageY) {
        if (toolId === 'blur' && this._mode === 'brush') this._forEachCanvas((c) => c.moveCursor(stageX, stageY));
    }

    onPropertyChanged(props, toolId, size) {
        if (props.size !== undefined || props.mode !== undefined) this.refreshCursor(toolId, size);
        if (props.blockSize !== undefined || props.mode !== undefined)
            this._forEachCanvas((c) => this.refreshPreview(c));
    }

    clearCache() {
        if (this._previewCache.surface) {
            this._previewCache.surface.finish();
            this._previewCache.surface = null;
        }
        this._previewCache.pixbuf = null;
    }

    renderPreviewSurface(cr, stroke, ss, canvas) {
        if (stroke.previewSurface) {
            const origin = stroke.previewOrigin;
            const local = origin ? canvas._stageToLocal(origin.x, origin.y) : null;
            if (!local) return;
            const ds = stroke.previewScale || ss;
            cr.save();
            cr.translate(local.x, local.y);
            cr.scale(1 / ds, 1 / ds);
            cr.setSourceSurface(stroke.previewSurface, 0, 0);
            const srcPat = cr.getSource();
            if (srcPat) srcPat.setFilter(Cairo.Filter.NEAREST);
            cr.paint();
            cr.restore();
            return;
        }

        if (this._previewCache.surface && this._previewCache.origin) {
            const origin = this._previewCache.origin;
            const local = canvas._stageToLocal(origin.x, origin.y);
            if (!local) return;
            cr.save();
            cr.translate(local.x, local.y);
            cr.scale(1 / this._stageScale, 1 / this._stageScale);
            cr.setSourceSurface(this._previewCache.surface, 0, 0);
            const pat = cr.getSource();
            if (pat) pat.setFilter(Cairo.Filter.NEAREST);
            cr.paint();
            cr.restore();
        }
    }

    onStrokePreview(canvas, stroke) {
        const mode = stroke.blurMode || this._mode;
        const blockSize = stroke.blockSize || this._blockSize;
        const lw = stroke.strokeWidth || 4;
        const pts = stroke.stagePoints;
        if (pts.length < 2) return;

        const region = _computeBlurRegionBounds(stroke);
        if (region.w <= 0 || region.h <= 0) return;

        const pixbuf = this._getRegionSync(region);
        if (!pixbuf) return;

        const ds = this._stageScale;
        const regionAbs = {
            x: Math.round(region.x * ds),
            y: Math.round(region.y * ds),
            w: Math.round(region.w * ds),
            h: Math.round(region.h * ds),
        };
        const originAbs = {
            x: Math.round(stroke.stagePoints[0].x * ds),
            y: Math.round(stroke.stagePoints[0].y * ds),
        };

        this._previewCache.pixbuf = pixbuf;

        this._buildDragSurface(stroke, region, regionAbs, originAbs, mode, blockSize, lw, ds);
        this._previewCache.origin = { x: regionAbs.x / ds, y: regionAbs.y / ds };
        canvas.queue_repaint();
    }

    onStrokeCommitted(canvas, stroke) {
        if (stroke.toolId !== 'blur') return;

        if (this._previewCache.surface && !this._previewCache.baked) {
            stroke.previewSurface = this._previewCache.surface;
            stroke.previewOrigin = this._previewCache.origin;
            stroke.previewScale = this._stageScale;
            this._previewCache.surface = null;
            this._previewCache.baked = true;
            canvas.queue_repaint();
            return;
        }

        const mode = stroke.blurMode || this._mode;
        const blockSize = stroke.blockSize || this._blockSize;
        const lw = stroke.strokeWidth || 4;
        const region = _computeBlurRegionBounds(stroke);
        const { x: regionX, y: regionY } = region;

        this._ensureCaptureAndCommit(canvas, stroke, region, regionX, regionY, mode, blockSize, lw);
    }

    async _ensureCaptureAndCommit(canvas, stroke, region, regionX, regionY, mode, blockSize, lw) {
        const stageRect = { x: region.x, y: region.y, w: region.w, h: region.h };
        const ds = this._stageScale;

        const pixbuf = await this._captureRegion(stageRect).catch(() => null);
        if (!pixbuf) return;

        const regionAbs = {
            x: Math.round(regionX * ds),
            y: Math.round(regionY * ds),
            w: Math.round(region.w * ds),
            h: Math.round(region.h * ds),
        };
        const originAbs = {
            x: Math.round(stroke.stagePoints[0].x * ds),
            y: Math.round(stroke.stagePoints[0].y * ds),
        };

        if (mode === 'selection') {
            if (regionAbs.w > 0 && regionAbs.h > 0) {
                const surface = _getAffectedRectPreviewSurface(
                    pixbuf,
                    regionAbs,
                    Math.round(blockSize * ds),
                    originAbs.x,
                    originAbs.y,
                );
                if (surface) {
                    stroke.previewSurface = surface;
                    stroke.previewScale = ds;
                    stroke.previewOrigin = { x: regionAbs.x / ds, y: regionAbs.y / ds };
                }
            }
        } else {
            const pointsAbs = stroke.stagePoints.map((p) => ({ x: p.x * ds, y: p.y * ds }));
            const surface = _getAffectedPreviewSurface(
                pixbuf,
                regionAbs,
                pointsAbs,
                lw * ds,
                Math.round(blockSize * ds),
                originAbs.x,
                originAbs.y,
            );
            if (surface) {
                stroke.previewSurface = surface;
                stroke.previewScale = ds;
                stroke.previewOrigin = { x: regionAbs.x / ds, y: regionAbs.y / ds };
            }
        }

        canvas.queue_repaint();
    }

    _buildDragSurface(stroke, region, regionAbs, originAbs, mode, blockSize, lw, ds) {
        if (this._previewCache.surface) {
            this._previewCache.surface.finish();
            this._previewCache.surface = null;
        }

        const pixbuf = this._previewCache.pixbuf;
        if (!pixbuf) return;

        const pixW = pixbuf.get_width();
        const pixH = pixbuf.get_height();
        if (pixW <= 0 || pixH <= 0) return;

        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, pixW, pixH);
        const ctx = new Cairo.Context(surf);
        ctx.setAntialias(Cairo.Antialias.NONE);
        const source = pixbuf.get_pixels();
        const rs = pixbuf.get_rowstride();
        const nc = pixbuf.get_n_channels();

        _forEachBlockInRect(
            { x: regionAbs.x, y: regionAbs.y, w: pixW, h: pixH },
            Math.round(blockSize * ds),
            originAbs.x,
            originAbs.y,
            (x0, y0, x1, y1) => {
                const px = x0 - regionAbs.x;
                const py = y0 - regionAbs.y;
                const pw = x1 - x0;
                const ph = y1 - y0;
                const sx = Math.max(0, Math.min(px, pixW - 1));
                const sy = Math.max(0, Math.min(py, pixH - 1));
                const ex = Math.max(sx, Math.min(px + pw, pixW));
                const ey = Math.max(sy, Math.min(py + ph, pixH));
                const color = _averageBlock(source, rs, nc, sx, sy, ex, ey);
                ctx.setSourceRGBA(color[0] / 255, color[1] / 255, color[2] / 255, 1.0);
                ctx.rectangle(px, py, pw, ph);
                ctx.fill();
            },
        );

        if (mode === 'brush' && stroke.stagePoints && stroke.stagePoints.length >= 2) {
            ctx.setOperator(Cairo.Operator.DEST_IN);
            ctx.setSourceRGBA(1, 1, 1, 1);
            ctx.setLineJoin(Cairo.LineJoin.ROUND);
            ctx.setLineCap(Cairo.LineCap.ROUND);
            ctx.setLineWidth(lw * ds);
            ctx.moveTo(stroke.stagePoints[0].x * ds - regionAbs.x, stroke.stagePoints[0].y * ds - regionAbs.y);
            for (let i = 1; i < stroke.stagePoints.length; i++)
                ctx.lineTo(stroke.stagePoints[i].x * ds - regionAbs.x, stroke.stagePoints[i].y * ds - regionAbs.y);
            ctx.stroke();
        }

        ctx.$dispose();
        this._previewCache.surface = surf;
        this._previewCache.origin = { x: regionAbs.x / ds, y: regionAbs.y / ds };
        this._previewCache.baked = false;
    }

    refreshPreview(canvas) {
        let stroke = canvas._currentStroke?.toolId === 'blur' ? canvas._currentStroke : null;
        const isCurrent = !!stroke;
        if (!stroke) {
            const sts = canvas._strokes;
            for (let i = sts.length - 1; i >= 0; i--) {
                if (sts[i].toolId === 'blur') {
                    stroke = sts[i];
                    break;
                }
            }
        }
        if (!stroke) return;
        stroke.blockSize = this._blockSize;
        this.onStrokePreview(canvas, stroke);

        if (!isCurrent && this._previewCache.surface) {
            if (stroke.previewSurface) stroke.previewSurface.finish();
            stroke.previewSurface = this._previewCache.surface;
            stroke.previewOrigin = this._previewCache.origin;
            stroke.previewScale = this._stageScale;
            this._previewCache.surface = null;
            this._previewCache.baked = true;
        }
    }

    composeOutput(basePixbuf, strokes, ctx) {
        return composeBlurStrokes(basePixbuf, strokes, ctx);
    }
}

export function composeBlurStrokes(basePixbuf, strokes, { stageScale, selX, selY, selW, selH }) {
    const imgWidth = basePixbuf.get_width();
    const imgHeight = basePixbuf.get_height();
    const { scaleX, scaleY } = imageScaleFactors(imgWidth, imgHeight, selW, selH);

    let result = basePixbuf;
    for (const stroke of strokes) {
        const sp = stroke.stagePoints;
        if (sp.length < 2) continue;
        const pointsAbs = stageToImageCoords(sp, { stageScale, selX, selY, scaleX, scaleY });
        const lw = stageLineWidth(stroke.strokeWidth, scaleX, scaleY);
        const blockSize = stroke.blockSize || 16;
        const regionAbs = {
            x: 0,
            y: 0,
            w: result.get_width(),
            h: result.get_height(),
        };
        const originCoords = stageToImageCoords([sp[0]], { stageScale, selX, selY, scaleX, scaleY });
        const originAbs = {
            x: Math.round(originCoords[0].x),
            y: Math.round(originCoords[0].y),
        };

        if ((stroke.blurMode || 'brush') === 'selection') {
            if (pointsAbs.length >= 2) {
                result = _pixelatePixbufRect(
                    result,
                    regionAbs,
                    pointsAbs[0],
                    pointsAbs[pointsAbs.length - 1],
                    blockSize,
                    originAbs.x,
                    originAbs.y,
                );
            }
        } else {
            result = _pixelatePixbufAlongStroke(result, regionAbs, pointsAbs, lw, blockSize, originAbs.x, originAbs.y);
        }

        if (!result) return null;
    }
    return result;
}
