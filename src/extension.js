import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { initI18n } from './platform/i18n.js';
import { Toolbar } from './ui/toolbar.js';
import { getToolDef } from './annotation/tools/index.js';
import { DrawingCanvas, DrawingInputOverlay } from './canvas/drawingCanvas.js';
import { GradiaSettings } from './platform/settings.js';
import { ResolutionOverlay } from './ui/resolutionOverlay.js';
import { ScreenshotCapture } from './capture/screenshotCapture.js';
import { DragTool } from './ui/dragTool.js';
import { ShortcutDispatcher } from './shortcutDispatcher.js';
import { isRapidOcrAvailable } from './utilities/ocr/backend.js';
import { createSettingsButton } from './platform/gradiaApp.js';
import { OcrSelector } from './utilities/ocr/ocrSelector.js';
import { TextEntryManager } from './ui/textEntryManager.js';
import { CanvasCollection } from './canvas/canvasCollection.js';
import { destroyActiveToast } from './platform/screenshotToast.js';
import { BlurSelector } from './annotation/blur/engine.js';
import { SelectionClearer } from './ui/selectionClearPatch.js';

export default class GradiaCompanion extends Extension {
    enable() {
        initI18n(this.dir);
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

        const self = this;
        this._settings = this.getSettings();

        this._selectionClearer = new SelectionClearer();

        Main.screenshotUI.open = async function (mode = 0, ...rest) {
            self._portalMode = mode === 2;
            if (self._screenshotCapture) self._screenshotCapture.portalMode = self._portalMode;
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

    _isDrawingTool(id) {
        return getToolDef(id)?.isDrawing ?? false;
    }

    _disconnectToolDeactivate(toolId, prop) {
        if (!this[prop]) return;
        this._toolbar?.getToolButton(toolId)?.disconnect(this[prop]);
        this[prop] = 0;
    }

    _setTool(id) {
        if (this._ocrSelector?.isActive && id !== this._lastSetToolId) {
            this._ocrSelector.deactivate(true);
            this._toolbar.setGroupEnabled('annotate', true);
            this._toolbar.setOcrIdle();
        }

        if (id !== this._lastSetToolId) this._dragTool?.onDeactivate();
        this._lastSetToolId = id;
        this._activeInput = this._inputRegistry[id] ?? null;

        const drawing = this._isDrawingTool(id);
        const dragging = id === 'drag';

        this._canvases.forEachCanvas((c) => c.setTool(id));
        this._canvases.forEachOverlay((o) => {
            o.reactive = drawing || dragging;
        });

        this._contextActivate[id]?.(id, this._toolbar?.size);
        this._updateAreaSelectorState(id);
        this._toolbar.updateUndoClearSensitivity();
    }

    _updateAreaSelectorState(id) {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector) return;

        if (!Main.screenshotUI._selectionButton.checked) return;

        const drawing = this._isDrawingTool(id);
        const dragging = id === 'drag';

        const visible = !drawing && !dragging;
        if (drawing || dragging) selector.reactive = false;
        else selector.reactive = true;

        if (visible) selector._areaIndicator?.show();

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

        if (this._toolbar) this._toolbar.setSelectionToolVisible(!screenMode);

        this._canvases.forEachCanvas((c) => {
            c.opacity = show ? 255 : 0;
        });
        this._canvases.forEachOverlay((o) => {
            o.opacity = show ? 255 : 0;
            if (!show) o.reactive = false;
        });

        if (!show) {
            this._dragTool?.refresh();
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
        if (!this._toolbar || !this._primaryBin) return;

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
                if (cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height) {
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

        if (this._toolbar) return;

        const ui = Main.screenshotUI;

        this._canvases = new CanvasCollection();
        const monitorBins = ui._monitorBins ?? [];
        const binsToUse = monitorBins.length > 0 ? monitorBins : ui._primaryMonitorBin ? [ui._primaryMonitorBin] : [];

        this._canvases.createForBins(
            binsToUse,
            (bin) => {
                const canvas = new DrawingCanvas({
                    style: 'background-color: transparent;',
                });
                canvas.add_constraint(
                    new Clutter.BindConstraint({
                        source: bin,
                        coordinate: Clutter.BindCoordinate.ALL,
                    }),
                );
                ui.insert_child_below(canvas, ui._areaSelector);
                return canvas;
            },
            (bin, canvas) => {
                const overlay = new DrawingInputOverlay(canvas, {
                    style: 'background-color: transparent;',
                });

                overlay.connect('button-press-event', (_actor, event) => {
                    const [stageX, stageY] = event.get_coords();
                    return this._activeInput?.onPress?.(stageX, stageY) ?? Clutter.EVENT_PROPAGATE;
                });

                overlay.connect('motion-event', (_actor, event) => {
                    const [stageX, stageY] = event.get_coords();
                    this._blurSelector.handleHoverMotion(this._toolbar?.selectedTool, stageX, stageY);
                    return this._activeInput?.onMotion?.(stageX, stageY) ?? Clutter.EVENT_PROPAGATE;
                });

                overlay.connect('button-release-event', () => {
                    return this._activeInput?.onRelease?.() ?? Clutter.EVENT_PROPAGATE;
                });

                bin.add_child(overlay);
                return overlay;
            },
        );

        const primaryBin = ui._primaryMonitorBin;
        if (!primaryBin) return;

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
            parentBin: primaryBin,
        });

        this._blurSelector = new BlurSelector({
            captureRegion: (r) => this._screenshotCapture.captureRegion(r),
            getRegionSync: (r) => this._screenshotCapture.getRegionSync(r),
            stageScale: Main.screenshotUI._scale || 1,
            forEachCanvas: (fn) => this._canvases.forEachCanvas(fn),
            ensureCache: () => this._screenshotCapture.ensureCache(),
            onBlockSizeChanged: (size) => this._toolbar?._onBlurBlockSizeChanged(size),
            onModeChanged: (mode) => this._blurSelector.refreshCursor(this._toolbar?.selectedTool, this._toolbar?.size),
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
        this._contextActivate = {
            blur: (id, size) => {
                this._blurSelector.onActivate();
                this._blurSelector.refreshCursor(id, size);
            },
        };
        this._contextUndelegate = {
            drag: () => this._canvases.deleteSelected() && (this._dragTool?.refresh(), true),
        };
        this._inputRegistry = {
            drag: {
                onPress: (x, y) => {
                    this._dragTool.press(x, y);
                    return Clutter.EVENT_STOP;
                },
                onMotion: (x, y) => {
                    this._dragTool.motion(x, y);
                    return Clutter.EVENT_STOP;
                },
                onRelease: () => {
                    this._dragTool.release();
                    return Clutter.EVENT_STOP;
                },
            },
            text: {
                onPress: (x, y) => {
                    this._textEntryManager?.activate(x, y);
                    return Clutter.EVENT_STOP;
                },
            },
        };

        this._wireSignals();

        if (!isRapidOcrAvailable()) this._toolbar.setOcrAvailable(false);

        this._settingsButton = createSettingsButton(() => {
            Main.screenshotUI.close();
            this.openPreferences();
        });
        ui._showPointerButtonContainer.insert_child_below(this._settingsButton, ui._showPointerButton);

        this._canvases.forEachCanvas((c) => {
            c.applyProps({ color: this._toolbar.selectedColor, size: this._toolbar.size });
            c.setTool(this._toolbar.selectedTool);
            this._blurSelector.registerCanvas(c);
        });

        this._primaryBin = primaryBin;
        ui.add_child(this._toolbar);
        if (this._toolbar.toolPropsMenu) ui.add_child(this._toolbar.toolPropsMenu);
        this._repositionToolbar();

        this._resolutionOverlay = new ResolutionOverlay(primaryBin);

        this._dispatcher = new ShortcutDispatcher({
            toolbar: this._toolbar,
            ocrSelector: this._ocrSelector,
            textEntryManager: this._textEntryManager,
            dragTool: this._dragTool,
            execute: (intent) => this.execute(intent),
        });
        this._wireModeAndDragSignals();
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
                    opacity: 0,
                    duration: 200,
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

        const dragBtn = this._toolbar.getToolButton('drag');
        if (dragBtn) {
            this._dragDeactivateId = dragBtn.connect('notify::checked', () => {
                if (!dragBtn.checked) {
                    this._canvases.clearSelections();
                    this._dragTool?.refresh();
                }
            });
        }

        this._toolbar.connect('tool-property-changed', (_toolbar, payload) => {
            const props = JSON.parse(payload);
            const STROKE_KEY_MAP = { size: 'strokeWidth' };

            this._canvases.forEachCanvas((c) => c.applyProps(props));

            for (const [key, value] of Object.entries(props)) {
                if (value === undefined || key === 'mode') continue;
                const skip = key === 'size' && this._textEntryManager?.shouldSkipLastStroke();
                if (!skip)
                    this._canvases.applyToLastStroke(
                        this._toolbar.activePropsToolId ?? this._toolbar.selectedTool,
                        STROKE_KEY_MAP[key] || key,
                        value,
                    );
            }

            const sel = this._canvases.selected;
            if (sel) {
                for (const [key, value] of Object.entries(props)) {
                    if (value === undefined || key === 'mode') continue;
                    sel.stroke[STROKE_KEY_MAP[key] || key] = value;
                }
                sel.canvas.queue_repaint();
                this._dragTool?.refresh();
            }

            this._textEntryManager?.onPropertyChanged(props);
            this._blurSelector.onPropertyChanged(props, this._toolbar?.selectedTool, this._toolbar?.size);
        });

        this._toolbar.connect('undo', () => {
            if (!this._canvases?.allCanvasesVisible()) return;
            if (this._textEntryManager?.isActive) {
                this._textEntryManager.cancel();
                return;
            }
            if (this._contextUndelegate[this._toolbar.selectedTool]?.()) return;
            this._canvases.undo();
        });

        this._toolbar.connect('clear', () => {
            if (!this._canvases?.allCanvasesVisible()) return;
            this._textEntryManager?.cancel();
            this._canvases.clear();
            this._dragTool?.refresh();
        });

        if (isRapidOcrAvailable()) {
            this._toolbar.connect('ocr-trigger', () => {
                if (this._ocrSelector?.isActive) {
                    this._ocrSelector.deactivate(true);
                    this._toolbar.setGroupEnabled('annotate', true);
                    this._toolbar.setOcrIdle();
                } else {
                    this._canvases.clearSelections();
                    this._dragTool?.refresh();
                    this._toolbar.clearToolSelection();
                    this._toolbar.setGroupEnabled('annotate', false);
                    this._ocrSelector?.activate();
                }
                this._toolbar.updateUndoClearSensitivity();
            });
        }
    }

    execute(intent) {
        switch (intent) {
            case 'undo':
                if (!this._canvases?.allCanvasesVisible()) return;
                if (this._textEntryManager?.isActive) {
                    this._textEntryManager.cancel();
                    return;
                }
                if (this._contextUndelegate[this._toolbar.selectedTool]?.()) return;
                this._canvases.undo();
                break;
            case 'copy':
                if (!this._isRecordingMode() && !this._portalMode) {
                    this._screenshotCapture.capture({ copyOnly: true, portalMode: this._portalMode }).then((result) => {
                        if (result !== undefined) Main.screenshotUI.close();
                    });
                }
                break;
            case 'save-as':
                if (!this._isRecordingMode()) {
                    this._screenshotCapture
                        .capture({ externalSave: true, portalMode: this._portalMode })
                        .then((result) => {
                            if (result !== undefined) Main.screenshotUI.close();
                        });
                }
                break;
            case 'ocr-trigger':
                this._toolbar.emit('ocr-trigger');
                break;
        }
    }

    _wireModeAndDragSignals() {
        const ui = Main.screenshotUI;
        const MODE_BUTTONS = [
            ['_windowButton', '_windowButtonId'],
            ['_selectionButton', '_selectionButtonId'],
            ['_screenButton', '_screenButtonId'],
            ['_castButton', '_castButtonId'],
        ];

        this._modeButtonSignals = {};
        for (const [prop, id] of MODE_BUTTONS) {
            this._modeButtonSignals[id] = ui[prop].connect('notify::checked', () => this._updateVisibilityForMode());
        }

        const selector = ui._areaSelector;
        if (selector) {
            this._dragStartedId = selector.connect('drag-started', () => {
                if (this._toolbar) this._toolbar.visible = false;
                this._resolutionOverlay?.onDragStarted();
            });
            this._dragEndedId = selector.connect('drag-ended', () => {
                this._repositionToolbar();
                this._resolutionOverlay?.onDragEnded();
            });
        }
    }

    _disconnectModeAndDragSignals() {
        const ui = Main.screenshotUI;

        if (this._modeButtonSignals) {
            for (const [prop, id] of Object.entries(this._modeButtonSignals)) {
                if (id) ui[prop]?.disconnect(id);
            }
            this._modeButtonSignals = null;
        }

        const selector = ui?._areaSelector;
        if (this._dragStartedId) {
            selector?.disconnect(this._dragStartedId);
            this._dragStartedId = 0;
        }
        if (this._dragEndedId) {
            selector?.disconnect(this._dragEndedId);
            this._dragEndedId = 0;
        }
    }

    _removeUI() {
        this._textEntryManager?.destroy();

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
        this._disconnectModeAndDragSignals();
        this._selectionClearer.restore();

        const selector = Main.screenshotUI?._areaSelector;
        if (selector) {
            selector.reactive = true;
            if (this._selectionClearer.isPatched) this._selectionClearer.setHandlesVisible(true);
            else
                ['_topLeftHandle', '_topRightHandle', '_bottomLeftHandle', '_bottomRightHandle'].forEach((name) =>
                    selector[name]?.show(),
                );
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
            const propsMenu = this._toolbar.toolPropsMenu;
            if (propsMenu?.get_stage()) {
                this._toolbar._hidePopup(propsMenu);
                propsMenu.destroy();
            }
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
