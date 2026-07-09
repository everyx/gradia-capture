import Cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { captureAndStoreScreenshot } from './screenshotStore.js';
import { getCaptureContext } from './captureContext.js';
import { orderByPhase, splitByPhase } from '../board/strokeOrder.js';

function pixbufRegionCopy(full, stageRect, scale) {
    const cx = Math.round(stageRect.x * scale);
    const cy = Math.round(stageRect.y * scale);
    const cw = Math.round(stageRect.w * scale);
    const ch = Math.round(stageRect.h * scale);

    const fw = full.get_width();
    const fh = full.get_height();
    if (cx >= fw || cy >= fh || cx + cw <= 0 || cy + ch <= 0) return null;
    const cx2 = Math.max(0, Math.min(cx, fw - 1));
    const cy2 = Math.max(0, Math.min(cy, fh - 1));
    const cw2 = Math.min(cw, fw - cx2);
    const ch2 = Math.min(ch, fh - cy2);
    if (cw2 <= 0 || ch2 <= 0) return null;

    const fullPixels = full.get_pixels();
    const fullRstride = full.get_rowstride();
    const nch = full.get_n_channels();
    const correctStride = cw2 * nch;
    const newData = new Uint8Array(cw2 * ch2 * nch);

    for (let y = 0; y < ch2; y++) {
        const srcBase = (cy2 + y) * fullRstride + cx2 * nch;
        const dstBase = y * correctStride;
        for (let x = 0; x < cw2; x++) {
            const si = srcBase + x * nch;
            const di = dstBase + x * nch;
            newData[di] = fullPixels[si];
            newData[di + 1] = fullPixels[si + 1];
            newData[di + 2] = fullPixels[si + 2];
            if (nch >= 4) newData[di + 3] = fullPixels[si + 3];
        }
    }

    const bytes = GLib.Bytes.new(newData);
    return GdkPixbuf.Pixbuf.new_from_bytes(
        bytes,
        GdkPixbuf.Colorspace.RGB,
        nch >= 4,
        full.get_bits_per_sample(),
        cw2,
        ch2,
        correctStride,
    );
}

export class ScreenshotCapture {
    constructor({ canvases, textEntryManager, toolbar, settings, isRecordingMode }) {
        this._canvases = canvases;
        this._textEntryManager = textEntryManager;
        this._toolbar = toolbar;
        this._settings = settings;
        this._isRecordingMode = isRecordingMode ?? (() => false);
        this._cachedFullPixbuf = null;
        this._capturePromise = null;
        this.captureGeometry = null;
        this.captureScale = 1;
    }

    async capture({ copyOnly = false, ocr = false, externalSave = false, portalMode = false } = {}) {
        const ui = Main.screenshotUI;
        this._textEntryManager?.commit();
        if (ocr) copyOnly = false;

        const ctx = getCaptureContext(ui);
        if (ctx.mode === 'none') return;

        if (ctx.mode === 'selection') {
            if (ctx.origin.w <= 2 || ctx.origin.h <= 2) return;
        }

        const shouldCopy = !ocr && !externalSave;
        const shouldSave = !copyOnly && !externalSave;
        const format = portalMode || ocr ? 'png' : this._settings.get_string('screenshot-format');
        const playSound = this._settings.get_boolean('play-sound');

        const _capture = (texture, geometry, scale, cursor, compositeFn, windowComposite = null) => {
            this.captureGeometry = geometry;
            this.captureScale = scale;
            const capturePromise = captureAndStoreScreenshot(
                texture,
                geometry,
                scale,
                cursor,
                compositeFn,
                windowComposite,
                { copy: shouldCopy, save: shouldSave, externalSave, format, playSound, tempFile: ocr },
            );
            if (portalMode || ocr) return capturePromise;
            return true;
        };

        if (ctx.mode === 'window') {
            const selectedWindow = ui._windowSelectors.flatMap((sel) => sel.windows()).find((win) => win.checked);
            if (!selectedWindow) return;

            let cursorTexture = selectedWindow.getCursorTexture()?.get_texture();
            if (!ui._cursor.visible) cursorTexture = null;

            if (this._settings.get_boolean('composite-window-capture')) {
                const windowComposite = this._buildWindowComposite(ui);
                if (!windowComposite) return;

                windowComposite.cursor = {
                    texture: cursorTexture ?? null,
                    x: selectedWindow.cursorPoint.x + selectedWindow.boundingBox.x,
                    y: selectedWindow.cursorPoint.y + selectedWindow.boundingBox.y,
                    scale: ui._cursorScale,
                };
                return await _capture(null, null, 1, null, null, windowComposite);
            }

            const content = selectedWindow.windowContent;
            if (!content) return;

            return await _capture(
                content.get_texture(),
                null,
                selectedWindow.bufferScale,
                {
                    texture: cursorTexture ?? null,
                    x: selectedWindow.cursorPoint.x * selectedWindow.bufferScale,
                    y: selectedWindow.cursorPoint.y * selectedWindow.bufferScale,
                    scale: ui._cursorScale,
                },
                null,
            );
        }

        const content = ui._stageScreenshot.get_content();
        if (!content) return;

        let cursorTexture = ui._cursor.content?.get_texture();
        if (!ui._cursor.visible) cursorTexture = null;

        const hasStrokes = this._canvases?.hasStrokes ?? false;
        const strokeData = hasStrokes && !ocr ? this._buildStrokeData() : null;

        return await _capture(
            content.get_texture(),
            ui._getSelectedGeometry(true),
            ctx.scale,
            {
                texture: cursorTexture ?? null,
                x: ui._cursor.x * ctx.scale,
                y: ui._cursor.y * ctx.scale,
                scale: ui._cursorScale,
            },
            strokeData ? (bytes, pixbuf) => this._compositeStrokesOntoPixbuf(bytes, pixbuf, strokeData) : null,
        );
    }

    _buildWindowComposite(ui) {
        const selectedWindow = ui._windowSelectors.flatMap((sel) => sel.windows()).find((win) => win.checked);
        if (!selectedWindow) return null;

        const allActors = global.get_window_actors();
        const allUIWindows = ui._windowSelectors.flatMap((sel) => sel.windows());

        function metaForBoundingBox(bb) {
            for (const actor of allActors) {
                const fr = actor.metaWindow.get_frame_rect();
                if (fr.x === bb.x && fr.y === bb.y && fr.width === bb.width && fr.height === bb.height)
                    return actor.metaWindow;
            }
            return null;
        }

        function entryForMeta(meta) {
            const fr = meta.get_frame_rect();
            const br = meta.get_buffer_rect();
            const uiWin = allUIWindows.find(
                (w) =>
                    w.boundingBox.x === fr.x &&
                    w.boundingBox.y === fr.y &&
                    w.boundingBox.width === fr.width &&
                    w.boundingBox.height === fr.height,
            );
            if (uiWin) {
                const c = uiWin.windowContent;
                if (!c) return null;
                return {
                    texture: c.get_texture(),
                    scale: uiWin.bufferScale,
                    rect: { x: br.x, y: br.y, width: br.width, height: br.height },
                };
            }
            const actor = allActors.find((a) => {
                const afr = a.metaWindow.get_frame_rect();
                return afr.x === fr.x && afr.y === fr.y && afr.width === fr.width && afr.height === fr.height;
            });
            if (!actor) return null;
            const content = actor.paint_to_content(null);
            if (!content) return null;
            return {
                texture: content.get_texture(),
                scale: actor.get_resource_scale(),
                rect: { x: br.x, y: br.y, width: br.width, height: br.height },
            };
        }

        const selectedMeta = metaForBoundingBox(selectedWindow.boundingBox);
        const chain = [];
        if (selectedMeta) {
            let cur = selectedMeta.get_transient_for();
            while (cur) {
                chain.push(cur);
                cur = cur.get_transient_for();
            }
        }

        const selContent = selectedWindow.windowContent;
        if (!selContent) return null;

        const selBr = selectedMeta?.get_buffer_rect() ?? selectedWindow.boundingBox;

        const entries = [
            {
                texture: selContent.get_texture(),
                scale: selectedWindow.bufferScale,
                rect: { x: selBr.x, y: selBr.y, width: selBr.width, height: selBr.height },
            },
            ...chain.map(entryForMeta).filter((e) => e !== null),
        ];

        return { windows: entries };
    }

    async _ensureFullCapture() {
        if (this._cachedFullPixbuf) return true;
        if (this._capturePromise) return this._capturePromise;
        this._capturePromise = this._doCapture();
        const result = await this._capturePromise;
        this._capturePromise = null;
        return result;
    }

    async _doCapture() {
        const ui = Main.screenshotUI;
        let texture;
        if (ui._windowButton.checked) {
            const win = ui._windowSelectors.flatMap((s) => s.windows()).find((w) => w.checked);
            if (!win) return false;
            texture = win.windowContent.get_texture();
        } else {
            const content = ui._stageScreenshot?.get_content();
            if (!content) return false;
            texture = content.get_texture();
        }
        if (!texture) return false;
        const stream = Gio.MemoryOutputStream.new_resizable();
        const full = await Shell.Screenshot.composite_to_stream(texture, 0, 0, -1, -1, 1, null, 0, 0, 1, stream);
        stream.close(null);
        if (!full) return false;
        this._cachedFullPixbuf = full;
        return true;
    }

    async captureRegion(stageRect) {
        if (!this._cachedFullPixbuf) {
            const ok = await this._ensureFullCapture();
            if (!ok) return null;
        }
        return pixbufRegionCopy(this._cachedFullPixbuf, stageRect, Main.screenshotUI._scale || 1);
    }

    getRegionSync(stageRect) {
        if (!this._cachedFullPixbuf) return null;
        return pixbufRegionCopy(this._cachedFullPixbuf, stageRect, Main.screenshotUI._scale || 1);
    }

    async ensureCache() {
        if (this._cachedFullPixbuf) return;
        if (!Main.screenshotUI) return;
        await this._ensureFullCapture();
    }

    _compositeStrokesOntoPixbuf(bytes, pixbuf, data) {
        const { selX, selY, selW, selH, strokes, stageScale } = data;
        if (selW <= 0 || selH <= 0) return null;

        const ctx = { selX, selY, selW, selH, stageScale };

        const { underlay, overlay } = splitByPhase(orderByPhase(strokes));

        let out = pixbuf;
        for (const s of underlay) {
            out = s.paintTo(out, ctx);
            if (!out) return null;
        }

        const underlaid = out;

        let surface = null;
        let cr = null;
        for (const s of overlay) {
            if (!cr) {
                const imgW = underlaid.get_width();
                const imgH = underlaid.get_height();
                surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, imgW, imgH);
                cr = new Cairo.Context(surface);
                imports.gi.Gdk.cairo_set_source_pixbuf(cr, underlaid, 0, 0);
                cr.paint();
            }
            s.paintTo(cr, ctx);
        }

        if (cr) {
            cr.$dispose();
            const result = imports.gi.Gdk.pixbuf_get_from_surface(
                surface,
                0,
                0,
                surface.get_width(),
                surface.get_height(),
            );
            surface = null;
            if (result) return { pixbuf: result };
        }

        return { pixbuf: underlaid };
    }

    _buildStrokeData() {
        const ctx = getCaptureContext();

        return {
            selX: ctx.origin.x,
            selY: ctx.origin.y,
            selW: ctx.origin.w,
            selH: ctx.origin.h,
            strokes: this._canvases.strokeData,
            stageScale: global.stage.scale_factor || 1,
        };
    }
}
