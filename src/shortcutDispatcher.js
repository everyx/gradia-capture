import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { TOOL_SHORTCUTS } from './tools/index.js';

const MODE_BUTTONS = [
    ['_windowButton', '_windowButtonId'],
    ['_selectionButton', '_selectionButtonId'],
    ['_screenButton', '_screenButtonId'],
    ['_castButton', '_castButtonId'],
];

export class ShortcutDispatcher {
    constructor({
        toolbar,
        ocrSelector,
        screenshotCapture,
        dragTool,
        isRecordingMode,
        updateVisibilityForMode,
        repositionToolbar,
        hideTrashButton,
        resolutionOverlay,
    }) {
        this._toolbar = toolbar;
        this._ocrSelector = ocrSelector;
        this._screenshotCapture = screenshotCapture;
        this._dragTool = dragTool;
        this._isRecordingMode = isRecordingMode ?? (() => false);
        this._updateVisibilityForMode = updateVisibilityForMode;
        this._repositionToolbar = repositionToolbar;
        this._hideTrashButton = hideTrashButton;
        this._resolutionOverlay = resolutionOverlay;

        this._keyPressId = 0;
        this._scrollId = 0;
        this._dragStartedId = 0;
        this._dragEndedId = 0;
        this._modeButtonSignals = {};
        this.portalMode = false;
    }

    connect() {
        const ui = Main.screenshotUI;

        for (const [prop, id] of MODE_BUTTONS) {
            this._modeButtonSignals[id] = ui[prop].connect('notify::checked', () => this._updateVisibilityForMode());
        }

        this._keyPressId = ui.connect('key-press-event', (_actor, event) => {
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
                if (!this._isRecordingMode() && !this.portalMode) {
                    this._screenshotCapture.capture({ copyOnly: true, portalMode: this.portalMode }).then((result) => {
                        if (result !== undefined) ui.close();
                    });
                    return Clutter.EVENT_STOP;
                }
            }

            if (ctrl && sym === Clutter.KEY_s) {
                if (!this._isRecordingMode()) {
                    this._screenshotCapture
                        .capture({ externalSave: true, portalMode: this.portalMode })
                        .then((result) => {
                            if (result !== undefined) ui.close();
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

            if (
                this._toolbar?.selectedTool === 'drag' &&
                (sym === Clutter.KEY_Delete || sym === Clutter.KEY_BackSpace)
            ) {
                if (this._dragTool.deleteSelected()) {
                    this._hideTrashButton();
                    return Clutter.EVENT_STOP;
                }
            }

            if (!ctrl && sym in TOOL_SHORTCUTS) {
                this._toolbar.selectTool(TOOL_SHORTCUTS[sym]);
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });

        this._scrollId = ui.connect('scroll-event', (_actor, event) => {
            this._toolbar.scrollSize(event.get_scroll_direction(), event);
            return Clutter.EVENT_PROPAGATE;
        });

        this._connectDragBehavior(ui);
    }

    disconnect() {
        const ui = Main.screenshotUI;

        for (const [prop, id] of MODE_BUTTONS) {
            if (this._modeButtonSignals[id]) {
                ui[prop].disconnect(this._modeButtonSignals[id]);
                this._modeButtonSignals[id] = 0;
            }
        }

        if (this._keyPressId) {
            ui.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }

        if (this._scrollId) {
            ui.disconnect(this._scrollId);
            this._scrollId = 0;
        }

        this._disconnectDragBehavior(ui);
    }

    _connectDragBehavior(ui) {
        const selector = ui._areaSelector;
        if (!selector) return;

        this._dragStartedId = selector.connect('drag-started', () => {
            if (this._toolbar) this._toolbar.visible = false;
            this._resolutionOverlay?.onDragStarted();
        });

        this._dragEndedId = selector.connect('drag-ended', () => {
            this._repositionToolbar();
            this._resolutionOverlay?.onDragEnded();
        });
    }

    _disconnectDragBehavior(ui) {
        const selector = ui?._areaSelector;
        if (!selector) return;

        if (this._dragStartedId) {
            selector.disconnect(this._dragStartedId);
            this._dragStartedId = 0;
        }

        if (this._dragEndedId) {
            selector.disconnect(this._dragEndedId);
            this._dragEndedId = 0;
        }
    }
}
