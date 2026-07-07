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
import { TextEntryManager } from './textEntryManager.js';
import { CanvasCollection } from './canvasCollection.js';
import { destroyActiveToast } from './screenshotToast.js';
import { BlurSelector } from './blurSelector.js';
import { SelectionClearer } from './selectionClearPatch.js';

export default class GradiaCompanion extends Extension {
    enable() {
        this._originalOpen = Main.screenshotUI.open.bind(Main.screenshotUI);
        this._originalSaveScreenshot = Main.screenshotUI._saveScreenshot.bind(Main.screenshotUI);
        this._gradiaSettings = new GradiaSettings(this);
        this._toolbar = null;
        this._canvases = null;
        this._canvases = null;
        this._textEntryManager = null;
        this._dragDeactivateId = 0;

        this._screenshotCapture = null;
        this._dragTool = null;
        this._dispatcher = null;
        this._ocrSelector = null;
        this._blurSelector = null;
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
        const sel = this._canvases.selected;
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
                if (this._canvases.deleteSelected())
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
        this._toolbar?.getToolButton(toolId)
            ?.disconnect(this[prop]);
        this[prop] = 0;
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

        const oldSize = this._blurSelector.blockSize;
        this._blurSelector.adjustBlockSize(delta);
        if (this._blurSelector.blockSize === oldSize)
            return Clutter.EVENT_STOP;

        this._canvases.forEachCanvas(c => this._blurSelector.refreshPreview(c));
        return Clutter.EVENT_STOP;
    }

    _updateBrushCursor() {
        const tool = this._toolbar?.selectedTool;
        const mode = this._blurSelector?.mode;
        const lw = this._toolbar?.lineWidth || 8;
        this._canvases.forEachCanvas(c => {
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

        this._canvases.forEachCanvas(c => c.setTool(id));
        this._canvases.forEachOverlay(o => { o.reactive = drawing || dragging; });

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

        const visible = !drawing && !dragging;
        if (drawing || dragging)
            selector.reactive = false;
        else
            selector.reactive = true;

        if (visible)
            selector._areaIndicator?.show();

        if (this._selectionClearer.isPatched) {
            this._selectionClearer.setHandlesVisible(visible);
        } else {
            for (const name of ['_topLeftHandle', '_topRightHandle', '_bottomLeftHandle', '_bottomRightHandle']) {
                const handle = selector[name];
                if (handle) {
                    if (visible) handle.show();
                    else handle.hide();
                }
            }
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

        this._canvases.forEachCanvas(c => { c.opacity = show ? 255 : 0; });
        this._canvases.forEachOverlay(o => {
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
        this._toolbar?.updateUndoClearSensitivity();
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

        if (selectionMode && !selectionRect) {
            this._toolbar.visible = false;
            return;
        }

        this._toolbar.visible = true;

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

        this._canvases = new CanvasCollection();
        const monitorBins = ui._monitorBins ?? [];
        const binsToUse = monitorBins.length > 0
            ? monitorBins
            : (ui._primaryMonitorBin ? [ui._primaryMonitorBin] : []);

        this._canvases.createForBins(binsToUse,
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
                    const mode = this._blurSelector?.mode;

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
                        this._toolbar.updateDrawingControlsSensitivity();
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

        this._toolbar = new Toolbar({
    extensionPath: this.path,
    gradiaSettings: this._gradiaSettings,
    hasSelection: () => !!this._canvases.selected,
    hasVisibleCanvas: () => this._canvases?.allCanvasesVisible() ?? true,
});
        this._textEntryManager = new TextEntryManager(this._toolbar, this._canvases);
        this._screenshotCapture = new ScreenshotCapture({
            canvases: this._canvases,
            textEntryManager: this._textEntryManager,
            toolbar: this._toolbar,
            settings: this._settings,
            isRecordingMode: () => this._isRecordingMode(),
        });
        this._screenshotCapture.portalMode = this._portalMode;
        this._screenshotCapture.ensureCache();
        this._dragTool = new DragTool({
            toolbar: this._toolbar,
            canvases: this._canvases,
        });

        this._blurSelector = new BlurSelector({
            captureRegion: (r) => this._screenshotCapture.captureRegion(r),
            getRegionSync: (r) => this._screenshotCapture.getRegionSync(r),
            stageScale: Main.screenshotUI._scale || 1,
            onBlockSizeChanged: (size) => this._toolbar.blurMenu?.setBlockSize(size),
            onModeChanged: (mode) => {
                this._toolbar.blurMenu?.setMode(mode);
                this._updateBrushCursor();
            },
        });
        this._toolbar.setBlurSelector(this._blurSelector);
        this._screenshotCapture.blurSelector = this._blurSelector;

        this._ocrSelector = new OcrSelector({
            toolbar: this._toolbar,
            canvases: this._canvases.canvases,
            extensionPath: this.path,
            screenshotFn: async () => {
                const file = await this._screenshotCapture.capture({ ocr: true, portalMode: this._portalMode });
                return { file, scale: this._screenshotCapture.captureScale || 1 };
            },
        });

        this._wireSignals();

        if (!isRapidOcrAvailable())
            this._toolbar.setOcrAvailable(false);

        this._settingsButton = createSettingsButton(() => {
            Main.screenshotUI.close();
            this.openPreferences();
        });
        ui._showPointerButtonContainer.insert_child_below(this._settingsButton, ui._showPointerButton);

        this._canvases.forEachCanvas(c => {
            c.applyProps({ color: this._toolbar.selectedColor, lineWidth: this._toolbar.lineWidth });
            c.setTool(this._toolbar.selectedTool);
            c._onStrokeCommitted = (stroke) => this._blurSelector.onStrokeCommitted(c, stroke);
            c._onStrokePreview = (canvas, stroke) => {
                stroke.blurMode = this._blurSelector.mode;
                stroke.blockSize = this._blurSelector.blockSize;
                this._blurSelector.onStrokePreview(canvas, stroke);
            };
            c._onScroll = (event) => this._handleBlurScroll(event);
            c._getBlurState = () => ({ mode: this._blurSelector.mode, blockSize: this._blurSelector.blockSize });
            c._onRenderBlurStroke = (cr, stroke, ss, canvas) => this._blurSelector.renderPreviewSurface(cr, stroke, ss, canvas);
        });

        this._primaryBin = primaryBin;
        ui.add_child(this._toolbar);
        if (this._toolbar.colorMenu)
            ui.add_child(this._toolbar.colorMenu);
        if (this._toolbar.blurMenu)
            ui.add_child(this._toolbar.blurMenu);
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
            this._toolbar.updateUndoClearSensitivity();
            this._updateBrushCursor();
        });

        const dragBtn = this._toolbar.getToolButton('drag');
        if (dragBtn) {
            this._dragDeactivateId = dragBtn.connect('notify::checked', () => {
                if (!dragBtn.checked) {
                    this._canvases.clearSelections();
                    this._hideTrashButton();
                }
            });
        }

        this._toolbar.connect('tool-property-changed', (_toolbar, which) => {
            if (which === 'color') {
                const color = this._toolbar.selectedColor;
                this._canvases.forEachCanvas(c => c.applyProps({ color }));

                const sel = this._canvases.selected;
                if (sel) {
                    sel.stroke.color = color;
                    sel.canvas.queue_repaint();
                }

                this._textEntryManager?.updateColor(color);
            }

            if (which === 'lineWidth') {
                const lineWidth = this._toolbar.lineWidth;
                this._canvases.forEachCanvas(c => {
                    c.applyProps({ lineWidth });

                    if (this._textEntryManager?.hasPending && this._toolbar.selectedTool === 'text')
                        return;

                    const strokes = c.strokes;
                    if (strokes.length === 0) return;
                    const last = strokes[strokes.length - 1];
                    if (last.toolId !== this._toolbar.selectedTool) return;
                    if (c.selectedStroke === last) return;
                    last.strokeWidth = lineWidth;
                    c.queue_repaint();
                });

                const sel = this._canvases.selected;
                if (sel) {
                    sel.stroke.strokeWidth = lineWidth;
                    sel.canvas.queue_repaint();
                    this._updateTrashButton();
                }

                this._textEntryManager?.updateLineWidth(lineWidth);
                this._updateBrushCursor();
            }
        });

        this._toolbar.connect('undo', () => {
            if (!this._canvases?.allCanvasesVisible())
                return;
            if (this._textEntryManager?.isActive) {
                this._textEntryManager.cancel();
                return;
            }
            if (this._toolbar.selectedTool === 'drag') {
                if (this._canvases.deleteSelected()) {
                    this._hideTrashButton();
                    return;
                }
            }
            this._canvases.undo();
        });

        this._toolbar.connect('clear', () => {
            if (!this._canvases?.allCanvasesVisible())
                return;
            this._textEntryManager?.cancel();
            this._canvases.clear();
            this._hideTrashButton();
        });

        if (isRapidOcrAvailable()) {
            this._toolbar.connect('ocr-trigger', () => {
                this._canvases.clearSelections();
                this._hideTrashButton();
                this._toolbar.clearToolSelection();
                this._ocrSelector?.activate();
                this._toolbar.updateUndoClearSensitivity();
            });
        }

    }

    _removeUI() {
        this._textEntryManager?.destroy();
        this._destroyTrashButton();

        if (this._ocrSelector) {
            this._ocrSelector.destroy();
            this._ocrSelector = null;
        }

        this._blurSelector?.clearCache();
        this._blurSelector = null;

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
            if (this._selectionClearer.isPatched)
                this._selectionClearer.setHandlesVisible(true);
            else
                ['_topLeftHandle', '_topRightHandle', '_bottomLeftHandle', '_bottomRightHandle']
                    .forEach(name => selector[name]?.show());
        }

        this._canvases?.destroy();
        this._canvases = null;
        this._canvases = null;
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
