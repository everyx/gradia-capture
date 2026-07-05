import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { Toolbar, TRASH_BUTTON_RADIUS } from './topBar.js';
import { TOOL_SHORTCUTS, getToolDef } from './tools.js';
import { DrawingCanvas, DrawingInputOverlay } from './canvas.js';
import { GradiaSettings } from './settings.js';
import { captureAndStoreScreenshot } from './screenshotStore.js';
import { ResolutionOverlay } from './resolutionOverlay.js';
import { isRapidOcrAvailable, createSettingsButton } from './gradiaIntegration.js';
import { OcrSelector } from './ocrSelector.js';
import { MonitorManager } from './monitorManager.js';
import { AnnotationManager } from './annotationManager.js';
import { TextEntryManager } from './textEntryManager.js';
import { destroyActiveToast } from './screenshotToast.js';
import { SelectionClearer } from './selectionClearer.js';

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

        this._captureGeometry = null;
        this._captureScale = 1;
        this._ocrSelector = null;

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

    _onDragToolPress(stageX, stageY) {
        const result = this._annotations.selectAt(stageX, stageY);

        if (result) {
            this._updateTrashButton();
            this._toolbar._syncToStroke(result.stroke);
            this._toolbar._updateDrawingControlsSensitivity();

            this._dragToolActive = true;
            this._dragToolStartX = stageX;
            this._dragToolStartY = stageY;
            this._dragToolCanvas = result.canvas;

            const idx = this._monitors.canvases.indexOf(result.canvas);
            this._dragToolGrab = global.stage.grab(this._monitors.getOverlay(idx));
            return;
        }

        this._hideTrashButton();
        this._dragToolActive = false;
    }

    _onDragToolMotion(stageX, stageY) {
        if (!this._dragToolActive || !this._dragToolCanvas)
            return;

        const dx = stageX - this._dragToolStartX;
        const dy = stageY - this._dragToolStartY;

        const stroke = this._dragToolCanvas.selectedStroke;
        const targetCanvas = this._monitors.canvasForStagePoint(stageX, stageY);

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

    _isDrawingTool(id) {
        return getToolDef(id)?.isDrawing ?? false;
    }

    _disconnectToolDeactivate(toolId, prop) {
        if (!this[prop]) return;
        this._toolbar?._toolButtons.find(b => b._toolId === toolId)
            ?.disconnect(this[prop]);
        this[prop] = 0;
    }

    _setTool(id) {
        if (this._ocrSelector?.isActive) {
            this._ocrSelector.deactivate(true);
        }

        const drawing = this._isDrawingTool(id);
        const dragging = id === 'drag';

        this._monitors.forEachCanvas(c => c.setTool(id));
        this._monitors.forEachOverlay(o => { o.reactive = drawing || dragging; });

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

        this._ocrSelector?.clearCache();

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
                return overlay;
            }
        );

        const primaryBin = ui._primaryMonitorBin;
        if (!primaryBin)
            return;

        this._toolbar = new Toolbar({ extensionPath: this.path, gradiaSettings: this._gradiaSettings, primaryBin });
        this._textEntryManager = new TextEntryManager(this._toolbar, this._monitors);

        this._ocrSelector = new OcrSelector({
            toolbar: this._toolbar,
            canvases: this._monitors.canvases,
            extensionPath: this.path,
            screenshotFn: async () => {
                const file = await this._captureScreenshot({ ocr: true });
                return { file, scale: this._captureScale || 1 };
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
        });

        this._primaryBin = primaryBin;
        primaryBin.add_child(this._toolbar);
        this._repositionToolbar();

        this._resolutionOverlay = new ResolutionOverlay(primaryBin);

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
        });

        this._toolbar._hasSelection = () => !!this._annotations.selected;

        this._toolbar.connect('undo', () => {
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
            this._textEntryManager?.cancel();
            this._annotations.clear();
            this._hideTrashButton();
        });

        if (isRapidOcrAvailable()) {
            this._toolbar.connect('ocr-trigger', () => {
                this._monitors.clearSelections();
                this._hideTrashButton();
                this._toolbar._clearToolSelection();
                this._ocrSelector.activate();
            });
            this._toolbar.connect('ocr-clear', () => this._ocrSelector.deactivate(true));
        }

        this._keyPressId = Main.screenshotUI.connect('key-press-event', (_actor, event) => {
            const sym = event.get_key_symbol();
            const mods = event.get_state();
            const ctrl = mods & Clutter.ModifierType.CONTROL_MASK;

            if (ctrl && sym === Clutter.KEY_z) {
                this._toolbar.emit('undo');
                return Clutter.EVENT_STOP;
            }

            if (this._ocrSelector?.isActive && ctrl && sym === Clutter.KEY_c) {
                this._ocrSelector.copySelected();
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

            if (this._ocrSelector?.isActive && ctrl && sym === Clutter.KEY_a) {
                this._ocrSelector.selectAll();
                return Clutter.EVENT_STOP;
            }

            if (ctrl && sym === Clutter.KEY_e) {
                this._toolbar?.emit('ocr-trigger');
                return Clutter.EVENT_STOP;
            }

            if (this._toolbar?.selectedTool === 'drag' &&
                (sym === Clutter.KEY_Delete || sym === Clutter.KEY_BackSpace)) {
                if (this._annotations.deleteSelected()) {
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

        const ui = Main.screenshotUI;
        for (const [prop, id] of MODE_BUTTONS) {
            this[id] = ui[prop].connect('notify::checked', () => this._updateVisibilityForMode());
        }

        this._connectDragBehavior();

        this._scrollId = Main.screenshotUI.connect('scroll-event', (_actor, event) => {
            this._toolbar.scrollLineWidth(event.get_scroll_direction());
            return Clutter.EVENT_PROPAGATE;
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

        this._monitors?.destroy();
        this._monitors = null;
        this._annotations = null;

        if (this._selectionHintLabel) {
            this._selectionHintLabel.destroy();
            this._selectionHintLabel = null;
        }

        if (this._toolbar) {
            this._disconnectToolDeactivate('drag', '_dragDeactivateId');
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
