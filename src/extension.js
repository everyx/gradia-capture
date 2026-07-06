import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { Toolbar, TRASH_BUTTON_RADIUS } from './toolbar.js';
import { TOOL_SHORTCUTS, getToolDef } from './tools.js';
import { DrawingCanvas, DrawingInputOverlay } from './drawingCanvas.js';
import { GradiaSettings } from './settings.js';
import { ResolutionOverlay } from './resolutionOverlay.js';
import { ScreenshotCapture } from './screenshotCapture.js';
import { DragTool } from './dragTool.js';
import { ShortcutDispatcher } from './shortcutDispatcher.js';
import { isRapidOcrAvailable, createSettingsButton } from './gradiaIntegration.js';
import { OcrSelector } from './ocrSelector.js';
import { MonitorManager } from './monitorManager.js';
import { AnnotationManager } from './annotationManager.js';
import { TextEntryManager } from './textEntryManager.js';
import { destroyActiveToast } from './screenshotToast.js';
import { getAffectedPreviewSurface, getAffectedRectPreviewSurface, _forEachBlockInRect, averageBlock } from './pixelate.js';
import { SelectionClearer } from './selectionClearPatch.js';

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

export default class GradiaCompanion extends Extension {
    enable() {
        this._originalOpen = Main.screenshotUI.open.bind(Main.screenshotUI);
        this._originalSaveScreenshot = Main.screenshotUI._saveScreenshot.bind(Main.screenshotUI);
        this._gradiaSettings = new GradiaSettings(this);
        this._toolbar = null;
        this._monitors = null;
        this._annotations = null;
        this._textEntryManager = null;
        this._dragDeactivateId = 0;

        this._screenshotCapture = null;
        this._dragTool = null;
        this._dispatcher = null;
        this._ocrSelector = null;
        this._trashButton = null;

        const self = this;
        this._settings = this.getSettings();

        this._selectionClearer = new SelectionClearer();

        Main.screenshotUI.open = async function (mode = 0, ...rest) {
            self._portalMode = (mode === 2);
            if (self._screenshotCapture)
                self._screenshotCapture.portalMode = self._portalMode;
            if (self._dispatcher)
                self._dispatcher.portalMode = self._portalMode;
            const result = await self._originalOpen(mode, ...rest);
            self._ensureUI();
            return result;
        };

        Main.screenshotUI._saveScreenshot = async function () {
            await self._screenshotCapture?.capture({ copyOnly: false });
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

    _updateTrashButton() {
        const sel = this._annotations.selected;
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
                if (this._annotations.deleteSelected())
                    this._hideTrashButton();
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

    _isDrawingTool(id) {
        return getToolDef(id)?.isDrawing ?? false;
    }

    _disconnectToolDeactivate(toolId, prop) {
        if (!this[prop]) return;
        this._toolbar?._toolButtons.find(b => b._toolId === toolId)
            ?.disconnect(this[prop]);
        this[prop] = 0;
    }

    _computeBlurRegionBounds(stroke) {
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
        const xs = pts.map(p => p.x);
        const ys = pts.map(p => p.y);
        const rx = Math.round(Math.max(0, Math.min(...xs) - pad));
        const ry = Math.round(Math.max(0, Math.min(...ys) - pad));
        return {
            x: rx, y: ry,
            w: Math.max(1, Math.round(Math.max(...xs) + pad - rx)),
            h: Math.max(1, Math.round(Math.max(...ys) + pad - ry)),
        };
    }

    _onBlurStrokeCommitted(canvas, stroke) {
        if (stroke.toolId !== 'blur')
            return;

        if (stroke._previewDragSurface) {
            stroke.previewSurface = stroke._previewDragSurface;
            stroke.previewOrigin = stroke._previewDragOrigin;
            stroke.previewScale = 1;
            stroke._previewDragSurface = null;
            canvas.queue_repaint();
            return;
        }

        const mode = stroke.blurMode || 'brush';
        const blockSize = stroke.blockSize || 16;
        const lw = stroke.strokeWidth || 4;
        const region = this._computeBlurRegionBounds(stroke);
        const { x: regionX, y: regionY } = region;

        this._ensureCaptureAndCommit(canvas, stroke, region, regionX, regionY, mode, blockSize, lw);
    }

    async _ensureCaptureAndCommit(canvas, stroke, region, regionX, regionY, mode, blockSize, lw) {
        const stageRect = { x: region.x, y: region.y, w: region.w, h: region.h };
        const ds = Main.screenshotUI._scale || 1;

        const pixbuf = await this._screenshotCapture.captureRegion(stageRect).catch(() => null);
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
                const surface = getAffectedRectPreviewSurface(pixbuf, regionAbs, Math.round(blockSize * ds), originAbs.x, originAbs.y);
                if (surface) {
                    stroke.previewSurface = surface;
                    stroke.previewScale = ds;
                    stroke.previewOrigin = { x: regionX, y: regionY };
                }
            }
        } else {
            const pointsAbs = stroke.stagePoints.map(p => ({ x: p.x * ds, y: p.y * ds }));
            const surface = getAffectedPreviewSurface(pixbuf, regionAbs, pointsAbs, lw * ds, Math.round(blockSize * ds), originAbs.x, originAbs.y);
            if (surface) {
                stroke.previewSurface = surface;
                stroke.previewScale = ds;
                stroke.previewOrigin = { x: regionX, y: regionY };
            }
        }

        canvas.queue_repaint();
    }

    _onBlurStrokePreview(canvas, stroke) {
        const mode = stroke.blurMode || 'brush';
        const blockSize = stroke.blockSize || 16;
        const lw = stroke.strokeWidth || 4;
        const pts = stroke.stagePoints;
        if (pts.length < 2) return;

        const region = this._computeBlurRegionBounds(stroke);
        if (region.w <= 0 || region.h <= 0) return;

        const pixbuf = this._screenshotCapture.getRegionSync(region);
        if (!pixbuf) return;

        const ds = Main.screenshotUI._scale || 1;

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

        stroke._previewPixbuf = pixbuf;
        stroke._previewBS = Math.round(blockSize * ds);
        stroke._previewOX = originAbs.x;
        stroke._previewOY = originAbs.y;
        stroke._previewRX = region.x;
        stroke._previewRY = region.y;
        stroke._previewRAbsX = regionAbs.x;
        stroke._previewRAbsY = regionAbs.y;
        stroke._previewMode = mode;
        stroke._previewPoints = pts;
        stroke._previewLW = lw;
        stroke.previewScale = ds;

        this._updateBlurPreviewSurface(stroke, region, ds);
        canvas.queue_repaint();
    }

    _updateBlurPreviewSurface(stroke, region, ds) {
        if (stroke._previewDragSurface) {
            stroke._previewDragSurface.finish();
            stroke._previewDragSurface = null;
        }

        const pixbuf = stroke._previewPixbuf;
        const bs = stroke._previewBS;
        if (!pixbuf || !bs) return;

        const pixW = pixbuf.get_width();
        const pixH = pixbuf.get_height();
        if (pixW <= 0 || pixH <= 0) return;

        const sw = Math.ceil(pixW / ds);
        const sh = Math.ceil(pixH / ds);
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, sw, sh);
        const ctx = new Cairo.Context(surf);
        ctx.setAntialias(Cairo.Antialias.NONE);
        const source = pixbuf.get_pixels();
        const rs = pixbuf.get_rowstride();
        const nc = pixbuf.get_n_channels();
        const rAbsX = stroke._previewRAbsX;
        const rAbsY = stroke._previewRAbsY;
        const ox = stroke._previewOX;
        const oy = stroke._previewOY;
        const mode = stroke._previewMode;
        const pts = stroke._previewPoints;
        const lw = stroke._previewLW || 4;

        _forEachBlockInRect(
            { x: rAbsX, y: rAbsY, w: pixW, h: pixH },
            bs, ox, oy,
            (x0, y0, x1, y1) => {
                const px = x0 - rAbsX;
                const py = y0 - rAbsY;
                const pw = x1 - x0;
                const ph = y1 - y0;
                const sx = Math.max(0, Math.min(px, pixW - 1));
                const sy = Math.max(0, Math.min(py, pixH - 1));
                const ex = Math.max(sx, Math.min(px + pw, pixW));
                const ey = Math.max(sy, Math.min(py + ph, pixH));
                const color = averageBlock(source, rs, nc, sx, sy, ex, ey);
                ctx.setSourceRGBA(color[0] / 255, color[1] / 255, color[2] / 255, 1.0);
                ctx.rectangle(px / ds, py / ds, pw / ds, ph / ds);
                ctx.fill();
            }
        );

        if (mode === 'brush' && pts && pts.length >= 2) {
            ctx.setOperator(Cairo.Operator.DEST_IN);
            ctx.setSourceRGBA(1, 1, 1, 1);
            ctx.setLineJoin(Cairo.LineJoin.ROUND);
            ctx.setLineCap(Cairo.LineCap.ROUND);
            ctx.setLineWidth(lw);
            ctx.moveTo(pts[0].x - rAbsX / ds, pts[0].y - rAbsY / ds);
            for (let i = 1; i < pts.length; i++)
                ctx.lineTo(pts[i].x - rAbsX / ds, pts[i].y - rAbsY / ds);
            ctx.stroke();
        }

        ctx.$dispose();
        stroke._previewDragSurface = surf;
        stroke._previewDragOrigin = { x: region.x, y: region.y };
    }

    _refreshBlurPreview(canvas, newSize) {
        let stroke = canvas._currentStroke?.toolId === 'blur'
            ? canvas._currentStroke
            : null;
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
        stroke.blockSize = newSize;
        this._onBlurStrokePreview(canvas, stroke);
    }

    _handleBlurScroll(event) {
        const tool = this._toolbar?.selectedTool;
        if (tool !== 'blur')
            return Clutter.EVENT_PROPAGATE;

        const mods = event.get_state();
        if (!(mods & Clutter.ModifierType.CONTROL_MASK))
            return Clutter.EVENT_PROPAGATE;

        let delta = 0;
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP)
            delta = 2;
        else if (direction === Clutter.ScrollDirection.DOWN)
            delta = -2;
        else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [, dy] = event.get_scroll_delta();
            if (dy < 0) delta = 2;
            else if (dy > 0) delta = -2;
        }

        if (delta === 0)
            return Clutter.EVENT_STOP;

        const bs = this._toolbar._blurBlockSize ?? 16;
        const newSize = Math.max(4, Math.min(32, bs + delta));
        if (newSize === bs)
            return Clutter.EVENT_STOP;

        this._toolbar._blurBlockSize = newSize;
        this._toolbar._blurMenu?.setBlockSize(newSize);
        this._toolbar.emit('block-size-changed', newSize);
        return Clutter.EVENT_STOP;
    }

    _updateBrushCursor() {
        const tool = this._toolbar?.selectedTool;
        const mode = this._toolbar?._blurMode;
        const lw = this._toolbar?.lineWidth || 8;
        this._monitors.forEachCanvas(c => {
            if (tool === 'blur' && mode === 'brush')
                c.showCursor(lw / 2);
            else if (tool === 'blur' && mode === 'selection')
                c.hideCursor(Clutter.CursorType.CROSSHAIR);
            else
                c.hideCursor();
        });
    }

    _setTool(id) {
        if (this._ocrSelector?.isActive) {
            this._ocrSelector.deactivate(true);
        }

        const drawing = this._isDrawingTool(id);
        const dragging = id === 'drag';

        this._monitors.forEachCanvas(c => c.setTool(id));
        this._monitors.forEachOverlay(o => { o.reactive = drawing || dragging; });

        if (id === 'blur')
            this._screenshotCapture.ensureCache();

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

        this._monitors.forEachCanvas(c => { c.opacity = show ? 255 : 0; });
        this._monitors.forEachOverlay(o => {
            o.opacity = show ? 255 : 0;
            if (!show)
                o.reactive = false;
        });

        if (!show) {
            this._hideTrashButton();
        } else {
            this._updateAreaSelectorState(this._toolbar?.selectedTool ?? 'select');
            this._setTool(this._toolbar?.selectedTool ?? 'select');
        }

        // OCR button visibility is managed through toolbar state

        this._selectionHintLabel?.set({ visible: selectionMode && !recordingMode });

        this._repositionToolbar();
        this._toolbar?._updateUndoClearSensitivity();
    }

    _repositionToolbar() {
        if (!this._toolbar || !this._primaryBin)
            return;

        this._ocrSelector?.clearCache();

        const ui = Main.screenshotUI;
        const monitors = Main.layoutManager.monitors;
        if (!monitors || monitors.length === 0) return;

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

        // Determine target monitor based on selection position
        let targetMonitor = monitors[0];
        if (selectionRect) {
            const cx = selectionRect.x + selectionRect.width / 2;
            const cy = selectionRect.y + selectionRect.height / 2;
            for (let i = 0; i < monitors.length; i++) {
                const m = monitors[i];
                if (cx >= m.x && cx < m.x + m.width &&
                    cy >= m.y && cy < m.y + m.height) {
                    targetMonitor = m;
                    break;
                }
            }
        }

        this._toolbar.reposition({
            selectionRect,
            monitorRect: {
                x: targetMonitor.x,
                y: targetMonitor.y,
                width: targetMonitor.width,
                height: targetMonitor.height,
            },
        });
    }

    _ensureUI() {
        this._ocrSelector?.clearCache();

        if (this._toolbar)
            return;

        const ui = Main.screenshotUI;

        this._monitors = new MonitorManager();
        this._annotations = new AnnotationManager(this._monitors);
        const monitorBins = ui._monitorBins ?? [];
        const binsToUse = monitorBins.length > 0
            ? monitorBins
            : (ui._primaryMonitorBin ? [ui._primaryMonitorBin] : []);

        this._monitors.createForBins(binsToUse,
            (bin) => {
                const canvas = new DrawingCanvas({
                    style: 'background-color: transparent;',
                });
                canvas.add_constraint(new Clutter.BindConstraint({
                    source: bin,
                    coordinate: Clutter.BindCoordinate.ALL,
                }));
                ui.insert_child_below(canvas, ui._areaSelector);
                return canvas;
            },
            (bin, canvas) => {
                const overlay = new DrawingInputOverlay(canvas, {
                    style: 'background-color: transparent;',
                });

                overlay.connect('button-press-event', (_actor, event) => {
                    const tool = this._toolbar?.selectedTool;

                    if (tool === 'text') {
                        const [stageX, stageY] = event.get_coords();
                        this._textEntryManager?.activate(stageX, stageY);
                        return Clutter.EVENT_STOP;
                    }

                    if (tool === 'drag' && this._dragTool) {
                        const [stageX, stageY] = event.get_coords();
                        this._dragTool.press(stageX, stageY);
                        if (this._dragTool.active)
                            this._updateTrashButton();
                        else
                            this._hideTrashButton();
                        return Clutter.EVENT_STOP;
                    }

                    return Clutter.EVENT_PROPAGATE;
                });

                overlay.connect('motion-event', (_actor, event) => {
                    const [stageX, stageY] = event.get_coords();
                    const tool = this._toolbar?.selectedTool;
                    const mode = this._toolbar?._blurMode;

                    if (tool === 'blur' && mode === 'brush')
                        canvas.moveCursor(stageX, stageY);

                    if (tool === 'drag' && this._dragTool) {
                        this._dragTool.motion(stageX, stageY);
                        this._updateTrashButton();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });

                overlay.connect('button-release-event', () => {
                    if (this._toolbar?.selectedTool === 'drag' && this._dragTool) {
                        this._dragTool.release();
                        this._updateTrashButton();
                        this._toolbar._updateDrawingControlsSensitivity();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });

                bin.add_child(overlay);
                return overlay;
            }
        );

        const primaryBin = ui._primaryMonitorBin;
        if (!primaryBin)
            return;

        this._toolbar = new Toolbar({ extensionPath: this.path, gradiaSettings: this._gradiaSettings });
        this._textEntryManager = new TextEntryManager(this._toolbar, this._monitors);
        this._screenshotCapture = new ScreenshotCapture({
            annotations: this._annotations,
            textEntryManager: this._textEntryManager,
            toolbar: this._toolbar,
            settings: this._settings,
            isRecordingMode: () => this._isRecordingMode(),
        });
        this._screenshotCapture.portalMode = this._portalMode;
        this._screenshotCapture.ensureCache();
        this._dragTool = new DragTool({
            toolbar: this._toolbar,
            monitors: this._monitors,
            annotations: this._annotations,
        });

        this._ocrSelector = new OcrSelector({
            toolbar: this._toolbar,
            canvases: this._monitors.canvases,
            extensionPath: this.path,
            screenshotFn: async () => {
                const file = await this._screenshotCapture.capture({ ocr: true, portalMode: this._portalMode });
                return { file, scale: this._screenshotCapture.captureScale || 1 };
            },
        });

        this._wireSignals();

        if (!isRapidOcrAvailable()) {
            this._toolbar._ocrButton.reactive = false;
            this._toolbar._ocrButton.opacity = 80;
        }

        this._settingsButton = createSettingsButton(() => {
            Main.screenshotUI.close();
            this.openPreferences();
        });
        ui._showPointerButtonContainer.insert_child_below(this._settingsButton, ui._showPointerButton);

        this._monitors.forEachCanvas(c => {
            c.setColor(this._toolbar.selectedColor);
            c.setTool(this._toolbar.selectedTool);
            c.setStrokeWidth(this._toolbar.lineWidth);
            c._onStrokeCommitted = (stroke) => this._onBlurStrokeCommitted(c, stroke);
            c._onStrokePreview = (canvas, stroke) => this._onBlurStrokePreview(canvas, stroke);
            c._onScroll = (event) => this._handleBlurScroll(event);
        });

        this._primaryBin = primaryBin;
        ui.add_child(this._toolbar);
        if (this._toolbar._colorMenu)
            ui.add_child(this._toolbar._colorMenu);
        if (this._toolbar._blurMenu)
            ui.add_child(this._toolbar._blurMenu);
        this._repositionToolbar();

        this._resolutionOverlay = new ResolutionOverlay(primaryBin);

        this._dispatcher = new ShortcutDispatcher({
            toolbar: this._toolbar,
            ocrSelector: this._ocrSelector,
            screenshotCapture: this._screenshotCapture,
            dragTool: this._dragTool,
            isRecordingMode: () => this._isRecordingMode(),
            updateVisibilityForMode: () => this._updateVisibilityForMode(),
            repositionToolbar: () => this._repositionToolbar(),
            hideTrashButton: () => this._hideTrashButton(),
            resolutionOverlay: this._resolutionOverlay,
        });
        this._dispatcher.connect();

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

        this._setTool('select');
        this._updateVisibilityForMode();
    }

    _wireSignals() {
        this._toolbar.connect('tool-changed', (_toolbar, id) => {
            this._setTool(id);
            this._toolbar._updateUndoClearSensitivity();
            this._updateBrushCursor();
        });

        const dragBtn = this._toolbar._toolButtons.find(b => b._toolId === 'drag');
        if (dragBtn) {
            this._dragDeactivateId = dragBtn.connect('notify::checked', () => {
                if (!dragBtn.checked) {
                    this._monitors.clearSelections();
                    this._hideTrashButton();
                }
            });
        }

        this._toolbar.connect('color-changed', (_toolbar, hex) => {
            this._monitors.forEachCanvas(c => c.setColor(hex));

            const sel = this._annotations.selected;
            if (sel) {
                sel.stroke.color = hex;
                sel.canvas.queue_repaint();
            }

            this._textEntryManager?.updateColor(hex);
        });

        this._toolbar.connect('line-width-changed', (_toolbar, width) => {
            this._monitors.forEachCanvas(c => {
                c.setStrokeWidth(width);

                if (this._textEntryManager?.hasPending && this._toolbar.selectedTool === 'text')
                    return;

                const strokes = c.strokes;
                if (strokes.length === 0) return;
                const last = strokes[strokes.length - 1];
                if (last.toolId !== this._toolbar.selectedTool) return;
                if (c.selectedStroke === last) return;
                last.strokeWidth = width;
                c.queue_repaint();
            });

            const sel = this._annotations.selected;
            if (sel) {
                sel.stroke.strokeWidth = width;
                sel.canvas.queue_repaint();
                this._updateTrashButton();
            }

            this._textEntryManager?.updateLineWidth(width);
            this._updateBrushCursor();
        });

        this._toolbar._hasSelection = () => !!this._annotations.selected;
        this._toolbar._hasVisibleCanvas = () => this._monitors?.allCanvasesVisible() ?? true;

        this._toolbar.connect('undo', () => {
            if (!this._monitors?.allCanvasesVisible())
                return;
            if (this._textEntryManager?.isActive) {
                this._textEntryManager.cancel();
                return;
            }
            if (this._toolbar.selectedTool === 'drag') {
                if (this._annotations.deleteSelected()) {
                    this._hideTrashButton();
                    return;
                }
            }
            this._annotations.undo();
        });

        this._toolbar.connect('clear', () => {
            if (!this._monitors?.allCanvasesVisible())
                return;
            this._textEntryManager?.cancel();
            this._annotations.clear();
            this._hideTrashButton();
        });

        if (isRapidOcrAvailable()) {
            this._toolbar.connect('ocr-trigger', () => {
                this._monitors.clearSelections();
                this._hideTrashButton();
                this._toolbar._clearToolSelection();
                this._ocrSelector?.activate();
                this._toolbar._updateUndoClearSensitivity();
            });
            this._toolbar.connect('ocr-clear', () => {
                this._ocrSelector.deactivate(true);
                this._toolbar._updateUndoClearSensitivity();
            });
        }

        this._toolbar.connect('blur-mode-changed', (_tb, mode) => {
            this._monitors.forEachCanvas(c => c.setBlurMode(mode));
            this._toolbar._updateUndoClearSensitivity();
            this._updateBrushCursor();
        });
        this._toolbar.connect('block-size-changed', (_tb, size) => {
            this._monitors.forEachCanvas(c => {
                c.setBlockSize(size);
                this._refreshBlurPreview(c, size);
            });
        });
    }


    _removeUI() {
        this._textEntryManager?.destroy();
        this._destroyTrashButton();

        if (this._ocrSelector) {
            this._ocrSelector.destroy();
            this._ocrSelector = null;
        }

        if (this._settingsButton) {
            this._settingsButton.destroy();
            this._settingsButton = null;
        }

        this._dragTool?.destroy();
        this._dragTool = null;

        this._dispatcher?.disconnect();
        this._dispatcher = null;
        this._selectionClearer.restore();

        const selector = Main.screenshotUI?._areaSelector;
        if (selector) {
            selector.reactive = true;
            setAreaSelectorHandlesVisible(selector, true);
        }

        this._monitors?.destroy();
        this._monitors = null;
        this._annotations = null;
        this._screenshotCapture = null;

        if (this._selectionHintLabel) {
            this._selectionHintLabel.destroy();
            this._selectionHintLabel = null;
        }

        if (this._toolbar) {
            this._disconnectToolDeactivate('drag', '_dragDeactivateId');
            this._toolbar.destroy();
            this._toolbar = null;
        }

        if (this._resolutionOverlay) {
            this._resolutionOverlay.destroy();
            this._resolutionOverlay = null;
        }
    }
}
