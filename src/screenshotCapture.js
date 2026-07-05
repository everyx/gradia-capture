import Cairo from 'gi://cairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { captureAndStoreScreenshot } from './screenshotStore.js';
import { getToolDef } from './tools.js';

export class ScreenshotCapture {
    constructor({ annotations, textEntryManager, toolbar, settings, isRecordingMode }) {
        this._annotations = annotations;
        this._textEntryManager = textEntryManager;
        this._toolbar = toolbar;
        this._settings = settings;
        this._isRecordingMode = isRecordingMode ?? (() => false);

        this.captureGeometry = null;
        this.captureScale = 1;
    }

    async capture({ copyOnly = false, ocr = false, externalSave = false, portalMode = false } = {}) {
        const ui = Main.screenshotUI;
        this._textEntryManager?.commit();
        if (ocr)
            copyOnly = false;

        if (!ui._selectionButton.checked && !ui._screenButton.checked && !ui._windowButton.checked)
            return;

        if (ui._selectionButton.checked) {
            const [,, w, h] = ui._areaSelector.getGeometry?.() ?? [0, 0, 0, 0];
            if (w <= 2 || h <= 2)
                return;
        }

        const shouldCopy = !ocr && !externalSave;
        const shouldSave = !copyOnly && !externalSave;
        const format = (portalMode || ocr) ? 'png' : this._settings.get_string('screenshot-format');
        const playSound = this._settings.get_boolean('play-sound');

        const _capture = (texture, geometry, scale, cursor, compositeFn, windowComposite = null) => {
            this.captureGeometry = geometry;
            this.captureScale = scale;
            const capturePromise = captureAndStoreScreenshot(
                texture, geometry, scale, cursor, compositeFn, windowComposite,
                { copy: shouldCopy, save: shouldSave, externalSave, format, playSound }
            );
            if (portalMode || ocr)
                return capturePromise;
            return true;
        };

        if (ui._windowButton.checked) {
            const selectedWindow =
                ui._windowSelectors.flatMap(sel => sel.windows())
                    .find(win => win.checked);
            if (!selectedWindow)
                return;

            let cursorTexture = selectedWindow.getCursorTexture()?.get_texture();
            if (!ui._cursor.visible)
                cursorTexture = null;

            if (this._settings.get_boolean('composite-window-capture')) {
                const windowComposite = this._buildWindowComposite(ui);
                if (!windowComposite)
                    return;

                windowComposite.cursor = {
                    texture: cursorTexture ?? null,
                    x: selectedWindow.cursorPoint.x + selectedWindow.boundingBox.x,
                    y: selectedWindow.cursorPoint.y + selectedWindow.boundingBox.y,
                    scale: ui._cursorScale,
                };
                return await _capture(null, null, 1, null, null, windowComposite);
            }

            const content = selectedWindow.windowContent;
            if (!content)
                return;

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
                null
            );
        }

        const content = ui._stageScreenshot.get_content();
        if (!content)
            return;

        let cursorTexture = ui._cursor.content?.get_texture();
        if (!ui._cursor.visible)
            cursorTexture = null;

        const hasStrokes = this._annotations?.hasStrokes ?? false;
        const strokeData = (hasStrokes && !ocr) ? this._buildStrokeData() : null;

        return await _capture(
            content.get_texture(),
            ui._getSelectedGeometry(true),
            ui._scale,
            {
                texture: cursorTexture ?? null,
                x: ui._cursor.x * ui._scale,
                y: ui._cursor.y * ui._scale,
                scale: ui._cursorScale,
            },
            strokeData ? (bytes, pixbuf) => this._compositeStrokesOntoPixbuf(bytes, pixbuf, strokeData) : null
        );
    }

    _buildWindowComposite(ui) {
        const selectedWindow =
            ui._windowSelectors.flatMap(sel => sel.windows())
                .find(win => win.checked);
        if (!selectedWindow)
            return null;

        const allActors = global.get_window_actors();
        const allUIWindows = ui._windowSelectors.flatMap(sel => sel.windows());

        function metaForBoundingBox(bb) {
            for (const actor of allActors) {
                const fr = actor.metaWindow.get_frame_rect();
                if (fr.x === bb.x && fr.y === bb.y &&
                    fr.width === bb.width && fr.height === bb.height)
                    return actor.metaWindow;
            }
            return null;
        }

        function entryForMeta(meta) {
            const fr = meta.get_frame_rect();
            const br = meta.get_buffer_rect();
            const uiWin = allUIWindows.find(w =>
                w.boundingBox.x === fr.x && w.boundingBox.y === fr.y &&
                w.boundingBox.width === fr.width && w.boundingBox.height === fr.height
            );
            if (uiWin) {
                const c = uiWin.windowContent;
                if (!c)
                    return null;
                return {
                    texture: c.get_texture(),
                    scale: uiWin.bufferScale,
                    rect: { x: br.x, y: br.y, width: br.width, height: br.height },
                };
            }
            const actor = allActors.find(a => {
                const afr = a.metaWindow.get_frame_rect();
                return afr.x === fr.x && afr.y === fr.y &&
                       afr.width === fr.width && afr.height === fr.height;
            });
            if (!actor)
                return null;
            const content = actor.paint_to_content(null);
            if (!content)
                return null;
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
        if (!selContent)
            return null;

        const selBr = selectedMeta?.get_buffer_rect() ?? selectedWindow.boundingBox;

        const entries = [
            {
                texture: selContent.get_texture(),
                scale: selectedWindow.bufferScale,
                rect: { x: selBr.x, y: selBr.y, width: selBr.width, height: selBr.height },
            },
            ...chain.map(entryForMeta).filter(e => e !== null),
        ];

        return { windows: entries };
    }

    _compositeStrokesOntoPixbuf(bytes, pixbuf, data) {
        const { selX, selY, selW, selH, strokes, stageScale } = data;
        if (selW <= 0 || selH <= 0)
            return null;

        const imgWidth = pixbuf.get_width();
        const imgHeight = pixbuf.get_height();
        const scaleX = imgWidth / selW;
        const scaleY = imgHeight / selH;

        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, imgWidth, imgHeight);
        const cr = new Cairo.Context(surface);
        imports.gi.Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
        cr.paint();

        for (const stroke of strokes) {
            const tool = getToolDef(stroke.toolId);
            if (!tool?.render)
                continue;

            const converted = stroke.stagePoints.map(p => ({
                x: (p.x / stageScale - selX) * scaleX,
                y: (p.y / stageScale - selY) * scaleY,
            }));

            const lw = stroke.strokeWidth * ((scaleX + scaleY) / 2);

            tool.render(cr, {
                color: stroke.color,
                points: converted,
                counter: stroke.counter,
                text: stroke.text,
            }, lw);
        }

        cr.$dispose();

        const newPixbuf = imports.gi.Gdk.pixbuf_get_from_surface(surface, 0, 0, imgWidth, imgHeight);
        if (!newPixbuf)
            return null;

        return { pixbuf: newPixbuf };
    }

    _buildStrokeData() {
        const ui = Main.screenshotUI;

        let selX = 0, selY = 0, selW = 0, selH = 0;

        if (ui._selectionButton.checked) {
            [selX, selY, selW, selH] = ui._areaSelector.getGeometry();
        } else if (ui._screenButton.checked) {
            const index = ui._screenSelectors.findIndex(s => s.checked);
            const monitor = Main.layoutManager.monitors[index];
            selX = monitor.x;
            selY = monitor.y;
            selW = monitor.width;
            selH = monitor.height;
        } else if (ui._windowButton.checked) {
            const window = ui._windowSelectors
                .flatMap(sel => sel.windows())
                .find(win => win.checked);

            if (window) {
                const box = window.boundingBox;
                selX = box.x;
                selY = box.y;
                selW = box.width;
                selH = box.height;
            }
        }

        return {
            selX, selY, selW, selH,
            strokes: this._annotations.strokeData,
            stageScale: global.stage.scale_factor || 1,
        };
    }
}
