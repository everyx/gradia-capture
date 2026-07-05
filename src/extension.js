import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

import { Toolbar, TRASH_BUTTON_RADIUS } from './topBar.js';
import { TOOLS, TOOL_SHORTCUTS } from './tools.js';
import { GradiaSettings } from './settings.js';
import { captureAndStoreScreenshot } from './screenshotStore.js';
import { ResolutionOverlay } from './resolutionOverlay.js';
import { isRapidOcrAvailable, runRapidOcr, createSettingsButton } from './gradiaIntegration.js';
import { destroyActiveToast } from './screenshotToast.js';
import { attachTooltip } from './tooltip.js';
import { SelectionClearer } from './selectionClearer.js';

const MAX_CANVAS_WIDTH = 1920;
const MAX_CANVAS_HEIGHT = 1080;

const MODE_BUTTONS = [
    ['_windowButton',    '_windowButtonId'],
    ['_selectionButton', '_selectionButtonId'],
    ['_screenButton',    '_screenButtonId'],
    ['_castButton',      '_castButtonId'],
];

export function setAreaSelectorHandlesVisible(selector, visible) {
    const handles = [
        selector?._topLeftHandle,
        selector?._topRightHandle,
        selector?._bottomLeftHandle,
        selector?._bottomRightHandle,
    ].filter(h => h != null);

    for (const handle of handles) {
        if (visible)
            handle.show();
        else
            handle.hide();
    }
}

function getToolDef(id) {
    return TOOLS.find(t => t.id === id) ?? null;
}

const DrawingCanvas = GObject.registerClass(
    class DrawingCanvas extends St.DrawingArea {
        _init(params) {
            super._init({
                reactive: false,
                x_expand: true,
                y_expand: true,
                ...params,
            });

            this._strokes = [];
            this._currentStroke = null;
            this._strokeColor = '#000000';
            this._toolId = 'freehand';
            this._strokeWidth = 3;
            this._drawing = false;
            this._dragButton = 0;
            this._dragGrab = null;
            this._stampCounter = 1;
            this._selectedStroke = null;

            this._scaleX = 1;
            this._scaleY = 1;

            this.connect('notify::allocation', () => this._updateScale());
        }

        get strokes() { return this._strokes; }
        get selectedStroke() { return this._selectedStroke; }

        setColor(hex) { this._strokeColor = hex; }
        setTool(id) {
            this._toolId = id;
            if (id !== 'drag')
                this._selectedStroke = null;
        }
        setStrokeWidth(w) { this._strokeWidth = w; }

        clear() {
            this._strokes = [];
            this._currentStroke = null;
            this._stampCounter = 1;
            this._selectedStroke = null;
            this.queue_repaint();
        }

        undo() {
            if (this._strokes.length > 0) {
                this._strokes.pop();
                this._selectedStroke = null;
                this.queue_repaint();
            }
        }

        hasStrokes() { return this._strokes.length > 0; }

        deleteSelectedStroke() {
            if (!this._selectedStroke)
                return false;
            const idx = this._strokes.indexOf(this._selectedStroke);
            if (idx !== -1)
                this._strokes.splice(idx, 1);
            this._selectedStroke = null;
            this.queue_repaint();
            return true;
        }

        selectStrokeAt(stageX, stageY) {
            for (let i = this._strokes.length - 1; i >= 0; i--) {
                const stroke = this._strokes[i];
                const tool = getToolDef(stroke.toolId);
                if (tool?.hitTest?.(stroke, stageX, stageY)) {
                    this._selectedStroke = stroke;
                    this.queue_repaint();
                    return stroke;
                }
            }
            this._selectedStroke = null;
            this.queue_repaint();
            return null;
        }

        clearSelection() {
            if (this._selectedStroke) {
                this._selectedStroke = null;
                this.queue_repaint();
            }
        }

        moveSelectedStroke(dx, dy) {
            if (!this._selectedStroke)
                return;
            for (const p of this._selectedStroke.stagePoints) {
                p.x += dx;
                p.y += dy;
            }
            this.queue_repaint();
        }

        adoptStroke(stroke) {
            this._strokes.push(stroke);
            this._selectedStroke = stroke;
            this.queue_repaint();
        }

        evictStroke(stroke) {
            const idx = this._strokes.indexOf(stroke);
            if (idx !== -1)
                this._strokes.splice(idx, 1);
            if (this._selectedStroke === stroke)
                this._selectedStroke = null;
            this.queue_repaint();
        }

        _updateScale() {
            const alloc = this.allocation;
            const stageW = alloc.get_width();
            const stageH = alloc.get_height();

            this._scaleX = stageW > 0 ? Math.max(1, stageW / MAX_CANVAS_WIDTH) : 1;
            this._scaleY = stageH > 0 ? Math.max(1, stageH / MAX_CANVAS_HEIGHT) : 1;
        }

        _stageToLocal(stageX, stageY) {
            const [ok, localX, localY] = this.transform_stage_point(stageX, stageY);
            if (!ok) return null;
            return { x: localX, y: localY };
        }

        _startDrawing(stageX, stageY) {
            const tool = getToolDef(this._toolId);
            if (!tool?.isDrawing)
                return;

            const extra = tool.beginStroke?.() ?? {};
            this._currentStroke = {
                color: this._strokeColor,
                toolId: this._toolId,
                strokeWidth: this._strokeWidth,
                stagePoints: [{ x: stageX, y: stageY }],
                ...extra,
            };

            if (tool.isStamp) {
                this._currentStroke.counter = this._stampCounter;
                this._finishStamp();
                return;
            }

            this._drawing = true;
            this._dragGrab = global.stage.grab(this);
        }

        _finishStamp() {
            if (this._currentStroke)
                this._strokes.push(this._currentStroke);
            this._stampCounter++;
            this._currentStroke = null;
            this.queue_repaint();
        }

        _updateDrawing(stageX, stageY) {
            if (!this._drawing)
                return;

            const tool = getToolDef(this._toolId);

            if (tool?.id === 'freehand') {
                this._currentStroke.stagePoints.push({ x: stageX, y: stageY });
            } else {
                if (this._currentStroke.stagePoints.length === 1)
                    this._currentStroke.stagePoints.push({ x: stageX, y: stageY });
                else
                    this._currentStroke.stagePoints[this._currentStroke.stagePoints.length - 1] = { x: stageX, y: stageY };
            }

            this.queue_repaint();
        }

        _endDrawing() {
            if (this._currentStroke && this._currentStroke.stagePoints.length > 1)
                this._strokes.push(this._currentStroke);

            this._currentStroke = null;
            this._drawing = false;
            this._dragButton = 0;

            if (this._dragGrab) {
                this._dragGrab.dismiss();
                this._dragGrab = null;
            }

            this.queue_repaint();
        }

        commitTextStroke(stroke) {
            if (stroke)
                this._strokes.push(stroke);
            this.queue_repaint();
        }

        vfunc_button_press_event(event) {
            if (this._dragButton)
                return Clutter.EVENT_PROPAGATE;

            const button = event.get_button();
            if (button !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;

            this._dragButton = button;
            const [stageX, stageY] = event.get_coords();
            this._startDrawing(stageX, stageY);
            return Clutter.EVENT_STOP;
        }

        vfunc_button_release_event(event) {
            if (event.get_button() !== this._dragButton)
                return Clutter.EVENT_PROPAGATE;

            this._endDrawing();
            return Clutter.EVENT_STOP;
        }

        vfunc_motion_event(event) {
            if (!this._drawing)
                return Clutter.EVENT_PROPAGATE;

            const [stageX, stageY] = event.get_coords();
            this._updateDrawing(stageX, stageY);
            return Clutter.EVENT_STOP;
        }

        vfunc_touch_event(event) {
            const eventType = event.type();

            if (eventType === Clutter.EventType.TOUCH_BEGIN) {
                if (this._dragButton)
                    return Clutter.EVENT_PROPAGATE;

                this._dragButton = 1;
                const [stageX, stageY] = event.get_coords();
                this._startDrawing(stageX, stageY);
                return Clutter.EVENT_STOP;
            } else if (eventType === Clutter.EventType.TOUCH_UPDATE) {
                if (!this._drawing)
                    return Clutter.EVENT_PROPAGATE;
                const [stageX, stageY] = event.get_coords();
                this._updateDrawing(stageX, stageY);
                return Clutter.EVENT_STOP;
            } else if (eventType === Clutter.EventType.TOUCH_END ||
                eventType === Clutter.EventType.TOUCH_CANCEL) {
                if (!this._drawing)
                    return Clutter.EVENT_PROPAGATE;
                this._endDrawing();
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        vfunc_repaint() {
            const cr = this.get_context();

            const allStrokes = [...this._strokes];
            if (this._currentStroke)
                allStrokes.push(this._currentStroke);

            let stampCounter = 1;

            for (const stroke of allStrokes) {
                const tool = getToolDef(stroke.toolId);
                if (!tool?.render)
                    continue;

                const localPoints = stroke.stagePoints
                    .map(sp => this._stageToLocal(sp.x, sp.y))
                    .filter(p => p !== null);

                tool.render(cr, {
                    color: stroke.color,
                    points: localPoints,
                    counter: stroke.toolId === 'stamp' ? stampCounter++ : stroke.counter,
                    text: stroke.text,
                }, stroke.strokeWidth);
            }

            if (this._selectedStroke) {
                const tool = getToolDef(this._selectedStroke.toolId);
                const bounds = tool?.bounds?.(this._selectedStroke);
                if (bounds) {
                    const tl = this._stageToLocal(bounds.minX, bounds.minY);
                    const br = this._stageToLocal(bounds.maxX, bounds.maxY);
                    if (tl && br) {
                        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.9);
                        cr.setLineWidth(1.5);
                        cr.setDash([5, 4], 0);
                        cr.rectangle(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
                        cr.stroke();
                    }
                }
            }
            cr.$dispose();
        }
    });

const DrawingInputOverlay = GObject.registerClass(
    class DrawingInputOverlay extends St.Widget {
        _init(canvas, params) {
            super._init({
                reactive: false,
                x_expand: true,
                y_expand: true,
                ...params,
            });
            this._canvas = canvas;
        }

        vfunc_button_press_event(event) {
            return this._canvas.vfunc_button_press_event(event);
        }

        vfunc_button_release_event(event) {
            return this._canvas.vfunc_button_release_event(event);
        }

        vfunc_motion_event(event) {
            return this._canvas.vfunc_motion_event(event);
        }

        vfunc_touch_event(event) {
            return this._canvas.vfunc_touch_event(event);
        }
    });

export default class GradiaCompanion extends Extension {
    enable() {
        this._originalOpen = Main.screenshotUI.open.bind(Main.screenshotUI);
        this._originalSaveScreenshot = Main.screenshotUI._saveScreenshot.bind(Main.screenshotUI);
        this._gradiaSettings = new GradiaSettings(this);
        this._toolbar = null;
        this._canvases = [];
        this._overlays = [];
        this._bins = [];
        this._textEntry = null;
        this._pendingTextStroke = null;
        this._textEntryResizeIdle = 0;

        this._ocrBlockData = null;
        this._ocrOverlay = null;
        this._ocrCacheBlocks = null;
        this._ocrHighlightWidgets = [];
        this._ocrSelectedSet = new Set();
        this._ocrSelIdx0 = -1;
        this._ocrCursorFrozen = false;
        this._ocrRectMode = false;
        this._ocrSelBorder = null;
        this._ocrCopyBtn = null;
        this._ocrRectWidget = null;
        this._ocrRectStart = null;
        this._ocrRectEnd = null;
        this._ocrToast = null;
        this._captureGeometry = null;
        this._captureScale = 1;
        this._systemFont = null;

        this._dragToolActive = false;
        this._dragToolStartX = 0;
        this._dragToolStartY = 0;
        this._dragToolCanvas = null;
        this._dragToolGrab = null;
        this._trashButton = null;

        const self = this;
        this._settings = this.getSettings();

        this._selectionClearer = new SelectionClearer();

        Main.screenshotUI.open = async function (mode = 0, ...rest) {
            self._portalMode = (mode === 2);
            const result = await self._originalOpen(mode, ...rest);
            self._ensureUI();
            return result;
        };

        Main.screenshotUI._saveScreenshot = async function () {
            await self._captureScreenshot({ copyOnly: false });
        };

        this._closedId = Main.screenshotUI.connect('closed', () => {
            self._portalMode = false;
            self._removeUI();
        });
    }

    disable() {
        if (this._originalOpen) {
            Main.screenshotUI.open = this._originalOpen;
            this._originalOpen = null;
        }

        if (this._originalSaveScreenshot) {
            Main.screenshotUI._saveScreenshot = this._originalSaveScreenshot;
            this._originalSaveScreenshot = null;
        }

        if (this._closedId) {
            Main.screenshotUI.disconnect(this._closedId);
            this._closedId = null;
        }

        this._gradiaSettings.destroy();
        this._gradiaSettings = null;
        this._settings = null;
        destroyActiveToast();

        this._removeUI();
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

    async _captureScreenshot({ copyOnly = false, ocr = false, externalSave = false } = {}) {
        const ui = Main.screenshotUI;
        this._commitTextEntry();
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
        const format = (this._portalMode || ocr) ? 'png' : this._settings.get_string('screenshot-format');
        const playSound = this._settings.get_boolean('play-sound');

        const _capture = (texture, geometry, scale, cursor, compositeFn, windowComposite = null) => {
            this._captureGeometry = geometry;
            this._captureScale = scale;
            const capturePromise = captureAndStoreScreenshot(
                texture, geometry, scale, cursor, compositeFn, windowComposite,
                { copy: shouldCopy, save: shouldSave, externalSave, format, playSound }
            );
            // We have to await in portal mode to prevent a race condition where
            // the overlay gets closed before 'screenshot-taken' gets emitted, so the portal doesn't fail.
            // GNOME Shell does the same, but we only await conditionally.
            if (this._portalMode || ocr)
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

        const hasStrokes = this._canvases.some(c => c.hasStrokes());
        const strokeData = hasStrokes ? this._buildStrokeData() : null;

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

    _binContainsStagePoint(bin, stageX, stageY) {
        const [ok, lx, ly] = bin.transform_stage_point(stageX, stageY);
        if (!ok) return false;
        const alloc = bin.allocation;
        return lx >= 0 && lx < alloc.get_width() && ly >= 0 && ly < alloc.get_height();
    }

    _canvasForStagePoint(stageX, stageY) {
        for (let i = 0; i < this._bins.length; i++) {
            if (this._binContainsStagePoint(this._bins[i], stageX, stageY))
                return this._canvases[i];
        }
        return this._canvases[0] ?? null;
    }

    _getSelectedCanvasAndStroke() {
        for (const canvas of this._canvases) {
            if (canvas.selectedStroke)
                return { canvas, stroke: canvas.selectedStroke };
        }
        return null;
    }

    _clearAllSelections(exceptCanvas = null) {
        for (const canvas of this._canvases) {
            if (canvas !== exceptCanvas)
                canvas.clearSelection();
        }
    }

    _updateTrashButton() {
        const sel = this._getSelectedCanvasAndStroke();
        if (!sel) {
            this._hideTrashButton();
            return;
        }

        const tool = getToolDef(sel.stroke.toolId);
        const bounds = tool?.bounds?.(sel.stroke);
        if (!bounds) {
            this._hideTrashButton();
            return;
        }

        const primaryBin = Main.screenshotUI._primaryMonitorBin;
        if (!primaryBin)
            return;

        const [okTR, localTRX, localTRY] = primaryBin.transform_stage_point(bounds.maxX, bounds.minY);
        if (!okTR) {
            this._hideTrashButton();
            return;
        }

        if (!this._trashButton) {
            this._trashButton = new St.Button({
                style_class: 'gradia-selection-trash gradia-circle-button',
                child: new St.Icon({
                    icon_name: 'user-trash-symbolic',
                    style: 'icon-size: 16px;',
                }),
                reactive: true,
            });
            this._trashButton.connect('clicked', () => {
                const s = this._getSelectedCanvasAndStroke();
                if (s) {
                    s.canvas.deleteSelectedStroke();
                    this._hideTrashButton();
                }
            });
            primaryBin.insert_child_below(this._trashButton, Main.screenshotUI._panel);
        }

        const btnX = Math.round(localTRX - TRASH_BUTTON_RADIUS);
        const btnY = Math.round(localTRY - TRASH_BUTTON_RADIUS);
        this._trashButton.set_position(btnX, btnY);
        this._trashButton.show();
    }

    _hideTrashButton() {
        this._trashButton?.hide();
    }

    _destroyTrashButton() {
        if (this._trashButton) {
            this._trashButton.destroy();
            this._trashButton = null;
        }
    }

    _onDragToolPress(stageX, stageY) {
        for (let i = this._canvases.length - 1; i >= 0; i--) {
            const stroke = this._canvases[i].selectStrokeAt(stageX, stageY);
            if (stroke) {
                this._clearAllSelections(this._canvases[i]);
                this._updateTrashButton();
                this._toolbar._syncToStroke(stroke);
                this._toolbar._updateDrawingControlsSensitivity();

                this._dragToolActive = true;
                this._dragToolStartX = stageX;
                this._dragToolStartY = stageY;
                this._dragToolCanvas = this._canvases[i];
                this._dragToolGrab = global.stage.grab(this._overlays[i] ?? this._overlays[0]);
                return;
            }
        }

        this._clearAllSelections();
        this._hideTrashButton();
        this._dragToolActive = false;
    }

    _onDragToolMotion(stageX, stageY) {
        if (!this._dragToolActive || !this._dragToolCanvas)
            return;

        const dx = stageX - this._dragToolStartX;
        const dy = stageY - this._dragToolStartY;

        const stroke = this._dragToolCanvas.selectedStroke;
        const targetCanvas = this._canvasForStagePoint(stageX, stageY);

        if (targetCanvas && targetCanvas !== this._dragToolCanvas && stroke) {
            this._dragToolCanvas.evictStroke(stroke);
            targetCanvas.adoptStroke(stroke);
            this._dragToolCanvas = targetCanvas;
        }

        this._dragToolCanvas.moveSelectedStroke(dx, dy);
        this._dragToolStartX = stageX;
        this._dragToolStartY = stageY;
        this._updateTrashButton();
    }

    _onDragToolRelease() {
        this._dragToolActive = false;
        this._dragToolCanvas = null;

        if (this._dragToolGrab) {
            this._dragToolGrab.dismiss();
            this._dragToolGrab = null;
        }

        this._updateTrashButton();
        this._toolbar._updateDrawingControlsSensitivity();
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

    _updateTextEntryStyle() {
        if (!this._textEntry)
            return;
        const fs = Math.max(8, Math.round(this._toolbar.lineWidth * 3));
        const col = this._toolbar.selectedColor;
        this._textEntry.style = `
            color: ${col};
            caret-color: ${col};
            font-size: ${fs}px;
            font-family: "Sans";
        `;
        if (this._textEntryResizeIdle) {
            GLib.source_remove(this._textEntryResizeIdle);
            this._textEntryResizeIdle = 0;
        }
        this._textEntryResizeIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._textEntryResizeIdle = 0;
            const clutterText = this._textEntry.get_clutter_text();
            const node = this._textEntry.get_theme_node();
            const vExtra =
                node.get_padding(St.Side.TOP) +
                node.get_padding(St.Side.BOTTOM) +
                node.get_border_width(St.Side.TOP) +
                node.get_border_width(St.Side.BOTTOM);
            const [, naturalHeight] = clutterText.get_preferred_height(-1);
            this._textEntry.set_height(naturalHeight + vExtra);
            return GLib.SOURCE_REMOVE;
        });
    }

    _spawnTextEntry(stageX, stageY) {
        if (this._textEntry) {
            this._commitTextEntry();
            return;
        }

        const ui = Main.screenshotUI;
        const primaryBin = ui._primaryMonitorBin;
        if (!primaryBin)
            return;

        const [ok, localX, localY] = primaryBin.transform_stage_point(stageX, stageY);
        if (!ok)
            return;

        this._textTargetCanvas = this._canvasForStagePoint(stageX, stageY);

        this._pendingTextStroke = {
            color: this._toolbar.selectedColor,
            toolId: 'text',
            strokeWidth: this._toolbar.lineWidth,
            stagePoints: [{ x: stageX, y: stageY }],
            text: '',
        };

        const entry = new St.Entry({
            style_class: 'gradia-text-entry',
            reactive: true,
            can_focus: true,
        });

        entry.set_x_expand(false);
        primaryBin.add_child(entry);
        this._textEntry = entry;
        this._updateTextEntryStyle();

        const allocId = entry.connect('notify::allocation', () => {
            entry.disconnect(allocId);

            const node = entry.get_theme_node();
            const paddingTop = node.get_padding(St.Side.TOP);
            const paddingLeft = node.get_padding(St.Side.LEFT);
            const borderTop = node.get_border_width(St.Side.TOP);
            const borderLeft = node.get_border_width(St.Side.LEFT);

            entry.set_position(
                localX - borderLeft - paddingLeft,
                localY - borderTop - paddingTop
            );
        });

        const clutterText = entry.get_clutter_text();
        clutterText.single_line_mode = false;

        clutterText.connect('text-changed', () => {
            if (this._textEntryResizeIdle) {
                GLib.source_remove(this._textEntryResizeIdle);
                this._textEntryResizeIdle = 0;
            }
            this._textEntryResizeIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._textEntryResizeIdle = 0;
                const fs = Math.max(8, Math.round(this._toolbar.lineWidth * 3));
                const [, naturalWidth] = clutterText.get_preferred_width(-1);
                entry.set_width(Math.max(fs * 4, naturalWidth + fs));

                const node = entry.get_theme_node();
                const vExtra =
                    node.get_padding(St.Side.TOP) +
                    node.get_padding(St.Side.BOTTOM) +
                    node.get_border_width(St.Side.TOP) +
                    node.get_border_width(St.Side.BOTTOM);
                const [, naturalHeight] = clutterText.get_preferred_height(-1);
                entry.set_height(naturalHeight + vExtra);
                return GLib.SOURCE_REMOVE;
            });
        });

        clutterText.connect('key-press-event', (_actor, event) => {
            const sym = event.get_key_symbol();
            if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
                if (event.get_state() & Clutter.ModifierType.SHIFT_MASK)
                    return Clutter.EVENT_PROPAGATE; // insert newline
                return this._commitTextEntry(), Clutter.EVENT_STOP;
            }
            if (sym === Clutter.KEY_Escape)
                return this._cancelTextEntry(), Clutter.EVENT_STOP;
            return Clutter.EVENT_PROPAGATE;
        });

        this._committingText = false;
        clutterText.connect('notify::has-key-focus', () => {
            if (!clutterText.has_key_focus() && !this._committingText)
                this._commitTextEntry();
        });

        entry.grab_key_focus();
    }

    _teardownTextEntry() {
        this._committingText = true;
        if (this._textEntryResizeIdle) {
            GLib.source_remove(this._textEntryResizeIdle);
            this._textEntryResizeIdle = 0;
        }
        this._textEntry.destroy();
        this._textEntry = null;
        this._pendingTextStroke = null;
        this._textTargetCanvas = null;

        if (this._idleSourceId)
            GLib.source_remove(this._idleSourceId);

        this._idleSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleSourceId = 0;
            this._committingText = false;
            Main.screenshotUI.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _commitTextEntry() {
        if (!this._textEntry)
            return;

        const text = this._textEntry.get_text()?.trim() ?? '';
        if (text.length > 0 && this._pendingTextStroke) {
            this._pendingTextStroke.text = text;
            this._textTargetCanvas?.commitTextStroke(this._pendingTextStroke);
        }

        this._teardownTextEntry();
    }

    _cancelTextEntry() {
        if (!this._textEntry)
            return;

        this._teardownTextEntry();
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

        const strokes = this._canvases.flatMap(c =>
            c.strokes.map(s => ({
                color: s.color,
                toolId: s.toolId,
                counter: s.counter,
                strokeWidth: s.strokeWidth,
                text: s.text,
                stagePoints: s.stagePoints.map(p => ({ x: p.x, y: p.y })),
            }))
        );

        return {
            selX, selY, selW, selH,
            strokes,
            stageScale: global.stage.scale_factor || 1,
        };
    }

    _isDrawingTool(id) {
        return getToolDef(id)?.isDrawing ?? false;
    }

    _setTool(id) {
        if (this._ocrBlockData)
            this._clearOcrSelection();

        if (id !== 'text')
            this._commitTextEntry();

        if (id !== 'drag') {
            this._clearAllSelections();
            this._hideTrashButton();
        }

        const drawing = this._isDrawingTool(id);
        const dragging = id === 'drag';

        for (const canvas of this._canvases)
            canvas.setTool(id);

        for (const overlay of this._overlays)
            overlay.reactive = drawing || dragging;

        this._updateAreaSelectorState(id);
    }

    _updateAreaSelectorState(id) {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        if (!Main.screenshotUI._selectionButton.checked)
            return;

        const drawing = this._isDrawingTool(id);
        const dragging = id === 'drag';

        if (drawing || dragging) {
            selector.reactive = false;
            setAreaSelectorHandlesVisible(selector, false);
        } else {
            selector.reactive = true;
            selector._areaIndicator?.show();
            setAreaSelectorHandlesVisible(selector, true);
        }
    }

    _isWindowMode() {
        return Main.screenshotUI._windowButton.checked;
    }

    _isRecordingMode() {
        return Main.screenshotUI._castButton?.checked ?? false;
    }

    _updateVisibilityForMode() {
        const windowMode = this._isWindowMode();
        const selectionMode = Main.screenshotUI._selectionButton?.checked ?? false;
        const recordingMode = this._isRecordingMode();
        const screenMode = Main.screenshotUI._screenButton?.checked ?? false;
        const show = !windowMode && !recordingMode;

        if (this._toolbar)
            this._toolbar.setSelectionToolVisible(!screenMode);

        for (const canvas of this._canvases)
            canvas.opacity = show ? 255 : 0;

        for (const overlay of this._overlays) {
            overlay.opacity = show ? 255 : 0;
            if (!show)
                overlay.reactive = false;
        }

        if (!show) {
            this._hideTrashButton();
        } else {
            this._updateAreaSelectorState(this._toolbar?.selectedTool ?? 'select');
            this._setTool(this._toolbar?.selectedTool ?? 'select');
        }

        // OCR button visibility is managed through toolbar state

        this._selectionHintLabel?.set({ visible: selectionMode && !recordingMode });

        this._repositionToolbar();
    }

    _connectDragBehavior() {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        this._dragStartedId = selector.connect('drag-started', () => {
            if (this._toolbar)
                this._toolbar.visible = false;
            this._resolutionOverlay?.onDragStarted();
        });

        this._dragEndedId = selector.connect('drag-ended', () => {
            this._repositionToolbar();
            this._resolutionOverlay?.onDragEnded();
        });
    }

    _disconnectDragBehavior() {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        for (const id of ['_dragStartedId', '_dragEndedId']) {
            if (this[id]) {
                selector.disconnect(this[id]);
                this[id] = null;
            }
        }
    }

    _repositionToolbar() {
        if (!this._toolbar || !this._primaryBin)
            return;

        this._ocrCacheBlocks = null;

        const ui = Main.screenshotUI;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        const selectionMode = ui._selectionButton?.checked ?? false;
        const windowMode = this._isWindowMode();
        const recordingMode = this._isRecordingMode();

        // Hidden modes
        if (windowMode || recordingMode) {
            this._toolbar.visible = false;
            return;
        }

        let selectionRect = null;
        if (selectionMode && ui._areaSelector) {
            const [x, y, w, h] = ui._areaSelector.getGeometry();
            if (w > 2 && h > 2) {
                selectionRect = { x, y, width: w, height: h };
            }
        }

        // Selection mode without a valid selection → hide
        if (selectionMode && !selectionRect) {
            this._toolbar.visible = false;
            return;
        }

        this._toolbar.visible = true;

        this._toolbar.reposition({
            selectionRect,
            monitorRect: {
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
            },
            primaryBin: this._primaryBin,
        });
    }

    _ensureUI() {
        this._ocrCacheBlocks = null;

        // Cache system font for OCR token measurement
        if (!this._systemFont) {
            try {
                const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                this._systemFont = iface.get_string('font-name');
            } catch (e) {
                this._systemFont = 'Sans';
            }
        }

        if (this._toolbar)
            return;

        const ui = Main.screenshotUI;

        this._canvases = [];
        this._overlays = [];
        this._bins = [];

        const monitorBins = ui._monitorBins ?? [];
        const binsToUse = monitorBins.length > 0
            ? monitorBins
            : (ui._primaryMonitorBin ? [ui._primaryMonitorBin] : []);

        for (const bin of binsToUse) {
            this._bins.push(bin);

            const canvas = new DrawingCanvas({
                style: 'background-color: transparent;',
            });
            canvas.add_constraint(new Clutter.BindConstraint({
                source: bin,
                coordinate: Clutter.BindCoordinate.ALL,
            }));
            ui.insert_child_below(canvas, ui._areaSelector);
            this._canvases.push(canvas);

            const overlay = new DrawingInputOverlay(canvas, {
                style: 'background-color: transparent;',
            });

            overlay.connect('button-press-event', (_actor, event) => {
                const tool = this._toolbar?.selectedTool;

                if (tool === 'text') {
                    const [stageX, stageY] = event.get_coords();
                    this._spawnTextEntry(stageX, stageY);
                    return Clutter.EVENT_STOP;
                }

                if (tool === 'drag') {
                    const [stageX, stageY] = event.get_coords();
                    this._onDragToolPress(stageX, stageY);
                    return Clutter.EVENT_STOP;
                }

                return Clutter.EVENT_PROPAGATE;
            });

            overlay.connect('motion-event', (_actor, event) => {
                if (this._toolbar?.selectedTool === 'drag') {
                    const [stageX, stageY] = event.get_coords();
                    this._onDragToolMotion(stageX, stageY);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            overlay.connect('button-release-event', () => {
                if (this._toolbar?.selectedTool === 'drag') {
                    this._onDragToolRelease();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            bin.add_child(overlay);
            this._overlays.push(overlay);
        }

        const primaryBin = ui._primaryMonitorBin;
        if (!primaryBin)
            return;

        this._toolbar = new Toolbar({ extensionPath: this.path, gradiaSettings: this._gradiaSettings, primaryBin });

        this._toolbar.connect('tool-changed', (_toolbar, id) => {
            this._setTool(id);
        });

        this._toolbar.connect('color-changed', (_toolbar, hex) => {
            for (const canvas of this._canvases)
                canvas.setColor(hex);

            const sel = this._getSelectedCanvasAndStroke();
            if (sel) {
                sel.stroke.color = hex;
                sel.canvas.queue_repaint();
            }

            if (this._pendingTextStroke) {
                this._pendingTextStroke.color = hex;
                this._updateTextEntryStyle();
            }
        });

        this._toolbar.connect('line-width-changed', (_toolbar, width) => {
            for (const canvas of this._canvases) {
                canvas.setStrokeWidth(width);

                if (this._pendingTextStroke && this._toolbar.selectedTool === 'text')
                    continue;

                const strokes = canvas.strokes;
                if (strokes.length === 0) continue;
                const last = strokes[strokes.length - 1];
                if (last.toolId !== this._toolbar.selectedTool) continue;
                if (canvas.selectedStroke === last) continue;
                last.strokeWidth = width;
                canvas.queue_repaint();
            }

            const sel = this._getSelectedCanvasAndStroke();
            if (sel) {
                sel.stroke.strokeWidth = width;
                sel.canvas.queue_repaint();
                this._updateTrashButton();
            }

            if (this._pendingTextStroke) {
                this._pendingTextStroke.strokeWidth = width;
                this._updateTextEntryStyle();
            }
        });

        this._toolbar._hasSelection = () => !!this._getSelectedCanvasAndStroke();

        this._toolbar.connect('undo', () => {
            if (this._textEntry) {
                this._cancelTextEntry();
                return;
            }
            if (this._toolbar.selectedTool === 'drag') {
                const sel = this._getSelectedCanvasAndStroke();
                if (sel) {
                    sel.canvas.deleteSelectedStroke();
                    this._hideTrashButton();
                    return;
                }
            }
            for (let i = this._canvases.length - 1; i >= 0; i--) {
                if (this._canvases[i].hasStrokes()) {
                    this._canvases[i].undo();
                    break;
                }
            }
        });

        this._toolbar.connect('clear', () => {
            this._cancelTextEntry();
            this._clearAllSelections();
            this._hideTrashButton();
            for (const canvas of this._canvases)
                canvas.clear();
        });

        if (isRapidOcrAvailable()) {
            this._toolbar.connect('ocr-trigger', () => this._performOcr());
            this._toolbar.connect('ocr-clear', () => this._clearOcrSelection());
        } else {
            this._toolbar._ocrButton.reactive = false;
            this._toolbar._ocrButton.opacity = 80;
        }

        this._settingsButton = createSettingsButton(() => {
            Main.screenshotUI.close();
            this.openPreferences();
        });
        ui._showPointerButtonContainer.insert_child_below(this._settingsButton, ui._showPointerButton);

        for (const canvas of this._canvases) {
            canvas.setColor(this._toolbar.selectedColor);
            canvas.setTool(this._toolbar.selectedTool);
            canvas.setStrokeWidth(this._toolbar.lineWidth);
        }

        this._primaryBin = primaryBin;
        primaryBin.add_child(this._toolbar);
        this._repositionToolbar();

        this._resolutionOverlay = new ResolutionOverlay(primaryBin);

        this._keyPressId = Main.screenshotUI.connect('key-press-event', (_actor, event) => {
            const sym = event.get_key_symbol();
            const mods = event.get_state();
            const ctrl = mods & Clutter.ModifierType.CONTROL_MASK;

            if (ctrl && sym === Clutter.KEY_z) {
                this._toolbar.emit('undo');
                return Clutter.EVENT_STOP;
            }

            if (this._ocrBlockData && ctrl && sym === Clutter.KEY_c) {
                this._copySelectedOcrText();
                return Clutter.EVENT_STOP;
            }

            if (ctrl && sym === Clutter.KEY_c) {
                if (!this._isRecordingMode() && !this._portalMode) {
                    this._captureScreenshot({ copyOnly: true }).then(result => {
                        if (result !== undefined)
                            Main.screenshotUI.close();
                    });
                    return Clutter.EVENT_STOP;
                }
            }

            if (ctrl && sym === Clutter.KEY_s) {
                if (!this._isRecordingMode()) {
                    this._captureScreenshot({ externalSave: true }).then(result => {
                        if (result !== undefined)
                            Main.screenshotUI.close();
                    });
                    return Clutter.EVENT_STOP;
                }
            }

            if (this._ocrBlockData && ctrl && sym === Clutter.KEY_a) {
                this._selectAllOcrBlocks();
                return Clutter.EVENT_STOP;
            }

            if (ctrl && sym === Clutter.KEY_e) {
                this._toolbar?.emit('ocr-trigger');
                return Clutter.EVENT_STOP;
            }

            if (this._toolbar?.selectedTool === 'drag' &&
                (sym === Clutter.KEY_Delete || sym === Clutter.KEY_BackSpace)) {
                const sel = this._getSelectedCanvasAndStroke();
                if (sel) {
                    sel.canvas.deleteSelectedStroke();
                    this._hideTrashButton();
                    return Clutter.EVENT_STOP;
                }
            }

            if (!ctrl && sym in TOOL_SHORTCUTS) {
                this._toolbar._onToolClicked(TOOL_SHORTCUTS[sym]);
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });

        for (const [prop, id] of MODE_BUTTONS) {
            this[id] = ui[prop].connect('notify::checked', () => this._updateVisibilityForMode());
        }

        if (this._settings.get_boolean('clear-selection')) {
            this._selectionClearer.patch(ui._areaSelector);

            this._selectionHintLabel = new St.Label({
                text: 'Drag to Make a Selection',
                style_class: 'screenshot-ui-panel gradia-hint-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            primaryBin.add_child(this._selectionHintLabel);

          const hideLabelId = ui._areaSelector.connect('drag-started', () => {
              this._selectionHintLabel?.ease({
                  opacity: 0, duration: 200,
                  mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                  onComplete: () => this._selectionHintLabel?.hide(),
              });
              ui._areaSelector.disconnect(hideLabelId);
          });
        }

        this._connectDragBehavior();

        this._scrollId = Main.screenshotUI.connect('scroll-event', (_actor, event) => {
            this._toolbar.scrollLineWidth(event.get_scroll_direction());
            return Clutter.EVENT_PROPAGATE;
        });

        this._setTool('select');
        this._updateVisibilityForMode();
    }

    async _performOcr() {
        if (this._ocrBlockData) {
            this._clearOcrSelection();
            return;
        }
        try {
            this._toolbar.setOcrProcessing();
            this._toolbar._clearToolSelection();
            this._clearAllSelections();
            this._hideTrashButton();

            const ui = Main.screenshotUI;
            let originX = 0, originY = 0;
            let captureMonitor = null;

            if (ui._selectionButton?.checked && ui._areaSelector) {
                const geom = ui._areaSelector.getGeometry();
                if (geom) {
                    originX = geom[0];
                    originY = geom[1];
                }
            } else if (ui._screenButton?.checked) {
                const idx = ui._screenSelectors?.findIndex(s => s.checked);
                if (idx >= 0) {
                    const mon = Main.layoutManager.monitors[idx];
                    originX = mon.x;
                    originY = mon.y;
                    captureMonitor = mon;
                }
            } else if (ui._windowButton?.checked) {
                const win = ui._windowSelectors?.flatMap(sel => sel.windows()).find(w => w.checked);
                if (win) {
                    originX = win.boundingBox.x;
                    originY = win.boundingBox.y;
                }
            }
            if (!captureMonitor)
                captureMonitor = global.display.get_monitor_geometry(global.display.get_primary_monitor());

            let blocks;
            let scale;

            if (this._ocrCacheBlocks) {
                blocks = this._ocrCacheBlocks;
                scale = this._captureScale || 1;
            } else {
                const file = await this._captureScreenshot({ ocr: true });
                if (!file)
                    throw new Error('Screenshot capture failed');
                scale = this._captureScale || 1;
                blocks = await runRapidOcr(file, this.path);
                this._ocrCacheBlocks = blocks;
            }
            this._storeOcrBlocks(blocks, originX, originY, scale, captureMonitor);
            this._toolbar.setOcrDone();
        } catch (e) {
            console.error(`OCR failed: ${e.message}`);
            this._toolbar.setOcrIdle();
        }
    }

    _splitOcrBlocks(blocks) {
        const result = [];
        let parentIdx = 0;
        for (const block of blocks) {
            const xs = block.box.map(p => p[0]);
            const ys = block.box.map(p => p[1]);
            const bMinX = Math.min(...xs);
            const bMaxX = Math.max(...xs);
            const bMinY = Math.min(...ys);
            const bMaxY = Math.max(...ys);
            const bW = bMaxX - bMinX;
            const bH = bMaxY - bMinY;

            const tokens = [];
            const text = block.text;
            let i = 0;
            let spaced = false;
            while (i < text.length) {
                const ch = text[i];
                const cjk = (ch >= '\u4e00' && ch <= '\u9fff') ||
                            (ch >= '\u3400' && ch <= '\u4dbf') ||
                            (ch >= '\uf900' && ch <= '\ufaff');
                if (ch === ' ') {
                    spaced = true;
                    i++;
                    continue;
                }
                if (cjk) {
                    tokens.push({ text: ch, startIdx: i, endIdx: i + 1, hasSpaceBefore: spaced });
                    spaced = false;
                    i++;
                } else {
                    let j = i + 1;
                    while (j < text.length && text[j] !== ' ' &&
                           !((text[j] >= '\u4e00' && text[j] <= '\u9fff') ||
                             (text[j] >= '\u3400' && text[j] <= '\u4dbf') ||
                             (text[j] >= '\uf900' && text[j] <= '\ufaff')))
                        j++;
                    tokens.push({ text: text.substring(i, j), startIdx: i, endIdx: j, hasSpaceBefore: spaced });
                    spaced = false;
                    i = j;
                }
            }

            if (tokens.length === 0) continue;

            // Measure actual token widths with Pango (original text preserves spacing)
            const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1, 1);
            const cr = new Cairo.Context(surface);
            const layout = PangoCairo.create_layout(cr);
            const fontSize = Math.max(8, Math.round(bH * 0.8));
            const fontFamily = (this._systemFont || 'Sans').replace(/\s+\d+(\.\d+)?$/, '');
            const desc = Pango.font_description_from_string(`${fontFamily} ${fontSize}px`);
            layout.set_font_description(desc);
            layout.set_text(text, -1);

            // Pass 1: raw Pango widths
            const rawWidths = [];
            let totalRaw = 0;
            for (const token of tokens) {
                const sb = this._toByteIdx(text, token.startIdx);
                const eb = this._toByteIdx(text, token.endIdx);
                const w = (layout.index_to_pos(eb).x - layout.index_to_pos(sb).x) / Pango.SCALE;
                rawWidths.push(w);
                totalRaw += w;
            }
            cr.$dispose();
            surface.finish();

            // Pass 2: scale to OCR block width (sum-to-bW guarantee)
            const scale = totalRaw > 0 ? bW / totalRaw : (bW / text.length);
            let cursorX = 0;
            for (let i = 0; i < tokens.length; i++) {
                const tokW = rawWidths[i] * scale;
                const tokMinX = bMinX + cursorX;
                const tokMaxX = tokMinX + tokW;
                cursorX += tokW;

                result.push({
                    text: tokens[i].text,
                    score: block.score,
                    hasSpaceBefore: tokens[i].hasSpaceBefore,
                    parentIdx,
                    box: [[tokMinX, bMinY], [tokMaxX, bMinY],
                          [tokMaxX, bMaxY], [tokMinX, bMaxY]],
                });
            }
            parentIdx++;
        }
        return result;
    }

    _storeOcrBlocks(blocks, originX, originY, captureScale, captureMonitor) {
        this._clearOcrSelection();

        const splitBlocks = this._splitOcrBlocks(blocks);

        this._ocrBlockData = splitBlocks.map(block => {
            const xs = block.box.map(p => p[0]);
            const ys = block.box.map(p => p[1]);
            const minX = Math.min(...xs) / captureScale + originX;
            const minY = Math.min(...ys) / captureScale + originY;
            const maxX = Math.max(...xs) / captureScale + originX;
            const maxY = Math.max(...ys) / captureScale + originY;
            return { text: block.text, score: block.score, minX, minY, maxX, maxY, parentIdx: block.parentIdx, hasSpaceBefore: block.hasSpaceBefore };
        });

        // Sort by reading order: top-to-bottom, left-to-right within same row
        this._ocrBlockData.sort((a, b) => {
            const dy = Math.abs(a.minY - b.minY);
            if (dy < (a.maxY - a.minY) * 0.6)
                return a.minX - b.minX;
            return a.minY - b.minY;
        });

        this._ocrSelectedSet = new Set();
        this._ocrSelIdx0 = -1;
        this._ocrHighlightWidgets = [];

        // Selection overlay — inserted below toolbar, above canvases
        const primaryBin = Main.screenshotUI._primaryMonitorBin;
        const overlay = new St.Widget({
            reactive: true,
        });
        overlay.set_cursor_type(Clutter.CursorType.CROSSHAIR);
        overlay.set_position(captureMonitor.x, captureMonitor.y);
        overlay.set_size(captureMonitor.width, captureMonitor.height);
        if (primaryBin) {
            primaryBin.add_child(overlay);
            primaryBin.set_child_at_index(overlay, 0);
        }
        this._ocrOverlay = overlay;

        overlay.connect('button-press-event', (_a, event) => {
            this._ocrCursorFrozen = true;
            const [sx, sy] = event.get_coords();
            const idx = this._findOcrBlockAt(sx, sy);
            if (idx >= 0) {
                this._ocrSelIdx0 = idx;
                this._updateOcrSelection(idx, idx);
            } else if (this._ocrBlockData) {
                this._ocrRectMode = true;
                this._ocrRectStart = { x: sx, y: sy };
                this._ocrRectEnd = { x: sx, y: sy };
                this._clearOcrHighlight();
                this._showOcrRect();
            }
            return Clutter.EVENT_STOP;
        });

        overlay.connect('motion-event', (_a, event) => {
            const [sx, sy] = event.get_coords();
            if (!this._ocrCursorFrozen) {
                overlay.set_cursor_type(
                    this._findOcrBlockAt(sx, sy) >= 0
                        ? Clutter.CursorType.TEXT
                        : Clutter.CursorType.CROSSHAIR);
            }
            if (this._ocrSelIdx0 >= 0) {
                const idx = this._findOcrBlockAt(sx, sy);
                if (idx >= 0)
                    this._updateOcrSelection(this._ocrSelIdx0, idx);
            } else if (this._ocrRectMode) {
                this._ocrRectEnd = { x: sx, y: sy };
                this._showOcrRect();
            }
            return Clutter.EVENT_STOP;
        });

        overlay.connect('button-release-event', () => {
            if (this._ocrRectMode) {
                this._ocrRectMode = false;
                if (this._ocrRectStart && this._ocrRectEnd) {
                    const sx = Math.min(this._ocrRectStart.x, this._ocrRectEnd.x);
                    const sy = Math.min(this._ocrRectStart.y, this._ocrRectEnd.y);
                    const ex = Math.max(this._ocrRectStart.x, this._ocrRectEnd.x);
                    const ey = Math.max(this._ocrRectStart.y, this._ocrRectEnd.y);
                    if (ex - sx > 3 || ey - sy > 3) {
                        this._selectBlocksInRect(sx, sy, ex, ey);
                    }
                }
                this._hideOcrRect();
                this._ocrRectStart = null;
                this._ocrRectEnd = null;
            }
            this._ocrSelIdx0 = -1;
            this._ocrCursorFrozen = false;
            return Clutter.EVENT_STOP;
        });
    }

    _findOcrBlockAt(stageX, stageY) {
        for (let i = 0; i < this._ocrBlockData.length; i++) {
            const b = this._ocrBlockData[i];
            const MARGIN = 10;
            if (stageX >= b.minX - MARGIN && stageX <= b.maxX + MARGIN &&
                stageY >= b.minY - MARGIN && stageY <= b.maxY + MARGIN)
                return i;
        }
        return -1;
    }

    _updateOcrSelection(idxA, idxB) {
        this._clearOcrHighlight();
        const lo = Math.min(idxA, idxB);
        const hi = Math.max(idxA, idxB);
        for (let i = lo; i <= hi; i++)
            this._ocrSelectedSet.add(i);
        this._renderHighlights();
    }

    _renderHighlights() {
        for (const w of this._ocrHighlightWidgets)
            w.destroy();
        this._ocrHighlightWidgets = [];
        this._hideOcrSelBorder();
        this._hideOcrCopyBtn();

        if (this._ocrSelectedSet.size === 0) return;

        let uMinX = Infinity, uMinY = Infinity, uMaxX = -Infinity, uMaxY = -Infinity;

        for (const i of this._ocrSelectedSet) {
            const b = this._ocrBlockData[i];
            const hl = new St.Widget({ style_class: 'gradia-ocr-highlight' });
            hl.set_position(b.minX, b.minY);
            hl.set_size(b.maxX - b.minX, b.maxY - b.minY);
            Main.screenshotUI.add_child(hl);
            Main.screenshotUI.remove_child(hl);
            Main.screenshotUI.add_child(hl);
            this._ocrHighlightWidgets.push(hl);

            if (b.minX < uMinX) uMinX = b.minX;
            if (b.minY < uMinY) uMinY = b.minY;
            if (b.maxX > uMaxX) uMaxX = b.maxX;
            if (b.maxY > uMaxY) uMaxY = b.maxY;
        }

        const PAD = 8;
        const primaryBin = Main.screenshotUI._primaryMonitorBin;
        if (!primaryBin) return;

        const bx = uMinX - PAD;
        const by = uMinY - PAD;
        const bw = uMaxX - uMinX + PAD * 2;
        const bh = uMaxY - uMinY + PAD * 2;

        // Dashed border via St.DrawingArea in Main.screenshotUI (stage coords)
        const border = new St.DrawingArea({ style: 'background-color: transparent;' });
        border.set_position(bx, by);
        border.set_size(Math.max(bw, 2), Math.max(bh, 2));
        border.connect('repaint', (area) => {
            const cr = area.get_context();
            cr.setSourceRGBA(1.0, 1.0, 1.0, 0.9);
            cr.setLineWidth(1.5);
            cr.setDash([5, 4], 0);
            cr.rectangle(1, 1, bw - 2, bh - 2);
            cr.stroke();
            cr.$dispose();
        });
        Main.screenshotUI.add_child(border);
        border.queue_repaint();
        this._ocrSelBorder = border;

        // Copy button at top-right of border
        this._showOcrCopyBtn(uMaxX + PAD, uMinY - PAD, primaryBin);
    }

    _showOcrCopyBtn(stageRX, stageTY, primaryBin) {
        if (!primaryBin) return;
        if (!this._ocrCopyBtn) {
            this._ocrCopyBtn = new St.Button({
                style_class: 'gradia-ocr-copy-btn',
                child: new St.Icon({ icon_name: 'edit-copy-symbolic', style: 'icon-size: 14px;' }),
            });
            attachTooltip(this._ocrCopyBtn, 'Copy selected text', St.Side.RIGHT);
            this._ocrCopyBtn.connect('clicked', () => this._copySelectedOcrText());
            if (Main.screenshotUI._panel)
                primaryBin.insert_child_below(this._ocrCopyBtn, Main.screenshotUI._panel);
            else
                primaryBin.add_child(this._ocrCopyBtn);
        }
        const [ok, lx, ly] = primaryBin.transform_stage_point(stageRX - 16, stageTY - 24);
        if (ok) {
            this._ocrCopyBtn.set_position(Math.round(lx), Math.round(ly));
            this._ocrCopyBtn.show();
        }
    }

    _toByteIdx(text, charIdx) {
        let byteCount = 0;
        for (let i = 0; i < charIdx; i++) {
            const c = text.charCodeAt(i);
            byteCount += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
        }
        return byteCount;
    }

    _hideOcrCopyBtn() {
        this._ocrCopyBtn?.hide();
    }

    _hideOcrSelBorder() {
        if (this._ocrSelBorder) {
            this._ocrSelBorder.destroy();
            this._ocrSelBorder = null;
        }
    }

    _clearOcrHighlight() {
        for (const w of this._ocrHighlightWidgets)
            w.destroy();
        this._ocrHighlightWidgets = [];
        this._ocrSelectedSet.clear();
        this._hideOcrSelBorder();
        this._hideOcrCopyBtn();
    }

    _showOcrRect() {
        if (!this._ocrRectStart || !this._ocrRectEnd) return;
        const x = Math.min(this._ocrRectStart.x, this._ocrRectEnd.x);
        const y = Math.min(this._ocrRectStart.y, this._ocrRectEnd.y);
        const w = Math.abs(this._ocrRectEnd.x - this._ocrRectStart.x);
        const h = Math.abs(this._ocrRectEnd.y - this._ocrRectStart.y);
        if (w < 3 && h < 3) {
            this._hideOcrRect();
            return;
        }
        if (!this._ocrRectWidget) {
            this._ocrRectWidget = new St.Widget({
                style_class: 'gradia-ocr-sel-rect',
            });
            Main.screenshotUI.add_child(this._ocrRectWidget);
            Main.screenshotUI.remove_child(this._ocrRectWidget);
            Main.screenshotUI.add_child(this._ocrRectWidget);
        }
        this._ocrRectWidget.set_position(x, y);
        this._ocrRectWidget.set_size(w, h);
    }

    _hideOcrRect() {
        if (this._ocrRectWidget) {
            this._ocrRectWidget.destroy();
            this._ocrRectWidget = null;
        }
    }

    _selectBlocksInRect(sx, sy, ex, ey) {
        this._clearOcrHighlight();
        for (let i = 0; i < this._ocrBlockData.length; i++) {
            const b = this._ocrBlockData[i];
            if (b.minX < ex && b.maxX > sx && b.minY < ey && b.maxY > sy) {
                this._ocrSelectedSet.add(i);
            }
        }
        this._renderHighlights();
    }

    _copySelectedOcrText() {
        if (!this._ocrSelectedSet || this._ocrSelectedSet.size === 0) {
            this._showOcrToast('No text selected');
            return;
        }
        const indices = [...this._ocrSelectedSet].sort((a, b) => a - b);
        const blocks = indices.map(i => this._ocrBlockData[i]);

        // Group into lines by Y proximity
        const lines = [];
        let cur = [blocks[0]];
        for (let i = 1; i < blocks.length; i++) {
            const prevH = cur[cur.length - 1].maxY - cur[cur.length - 1].minY;
            const dy = Math.abs(blocks[i].minY - cur[cur.length - 1].minY);
            if (dy < prevH * 0.6)
                cur.push(blocks[i]);
            else {
                lines.push(cur);
                cur = [blocks[i]];
            }
        }
        lines.push(cur);

        const text = lines.map(line => {
            let s = '';
            for (let i = 0; i < line.length; i++) {
                if (i > 0) {
                    if (line[i].parentIdx !== line[i - 1].parentIdx)
                        s += ' ';
                    else if (line[i].hasSpaceBefore)
                        s += ' ';
                }
                s += line[i].text;
            }
            return s;
        }).join('\n');
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        this._showOcrToast(`Copied ${indices.length} block${indices.length > 1 ? 's' : ''}`);
    }

    _selectAllOcrBlocks() {
        if (!this._ocrBlockData || this._ocrBlockData.length === 0) {
            this._showOcrToast('No OCR text available');
            return;
        }
        this._ocrSelectedSet.clear();
        for (let i = 0; i < this._ocrBlockData.length; i++)
            this._ocrSelectedSet.add(i);
        this._renderHighlights();
    }

    _clearOcrSelection() {
        this._clearOcrHighlight();
        this._hideOcrRect();
        if (this._ocrOverlay) {
            this._ocrOverlay.destroy();
            this._ocrOverlay = null;
        }
        if (this._ocrCopyBtn) {
            this._ocrCopyBtn.destroy();
            this._ocrCopyBtn = null;
        }
        this._ocrBlockData = null;
        if (this._toolbar)
            this._toolbar.setOcrIdle();
    }

    _showOcrToast(text) {
        const monitor = global.display.get_monitor_geometry(
            global.display.get_primary_monitor());
        if (!this._ocrToast) {
            this._ocrToast = new St.Label({
                text,
                style: 'background: rgba(0,0,0,0.7); color: white; border-radius: 6px; padding: 6px 12px; font-size: 13px;',
                x_expand: false,
                y_expand: false,
            });
            Main.screenshotUI._primaryMonitorBin.add_child(this._ocrToast);
        } else {
            this._ocrToast.text = text;
        }
        this._ocrToast.set_position(
            Math.round((monitor.width - this._ocrToast.width) / 2),
            Math.round((monitor.height - this._ocrToast.height) / 2) + 80
        );
        this._ocrToast.opacity = 255;
        this._ocrToast.ease({
            opacity: 0,
            duration: 3000,
            delay: 1500,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _removeUI() {
        this._cancelTextEntry();
        this._destroyTrashButton();

        if (this._idleSourceId) {
            GLib.source_remove(this._idleSourceId);
            this._idleSourceId = 0;
        }

        this._clearOcrSelection();
        if (this._ocrToast) {
            this._ocrToast.destroy();
            this._ocrToast = null;
        }

        if (this._settingsButton) {
            this._settingsButton.destroy();
            this._settingsButton = null;
        }

        if (this._dragToolGrab) {
            this._dragToolGrab.dismiss();
            this._dragToolGrab = null;
        }

        const ui = Main.screenshotUI;

        if (this._keyPressId) {
            Main.screenshotUI.disconnect(this._keyPressId);
            this._keyPressId = null;
        }

        for (const [prop, id] of MODE_BUTTONS) {
            if (this[id]) {
                ui[prop].disconnect(this[id]);
                this[id] = null;
            }
        }

        this._disconnectDragBehavior();
        this._selectionClearer.restore();

        const selector = ui._areaSelector;
        if (selector) {
            selector.reactive = true;
            setAreaSelectorHandlesVisible(selector, true);
        }

        for (const overlay of this._overlays)
            overlay.destroy();
        this._overlays = [];

        for (const canvas of this._canvases)
            canvas.destroy();
        this._canvases = [];
        this._bins = [];

        if (this._selectionHintLabel) {
            this._selectionHintLabel.destroy();
            this._selectionHintLabel = null;
        }

        if (this._toolbar) {
            this._toolbar.destroy();
            this._toolbar = null;
        }

        if (this._scrollId) {
            Main.screenshotUI.disconnect(this._scrollId);
            this._scrollId = null;
        }

        if (this._resolutionOverlay) {
            this._resolutionOverlay.destroy();
            this._resolutionOverlay = null;
        }
    }
}
