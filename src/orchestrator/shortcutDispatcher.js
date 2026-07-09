import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { TOOL_SHORTCUTS } from '../annotation/tools/index.js';

const CTRL = Clutter.ModifierType.CONTROL_MASK;

const KEY_MAP = [
    { mod: CTRL, sym: Clutter.KEY_z, intent: 'undo' },
    { mod: CTRL, sym: Clutter.KEY_c, intent: 'copy' },
    { mod: CTRL, sym: Clutter.KEY_s, intent: 'save-as' },
    { mod: CTRL, sym: Clutter.KEY_e, intent: 'ocr-trigger' },
];

export class ShortcutDispatcher {
    constructor({ toolbar, execute, ocrSelector, textEntryManager, dragTool }) {
        this._toolbar = toolbar;
        this._execute = execute;
        this._ocrSelector = ocrSelector;
        this._textEntryManager = textEntryManager;
        this._dragTool = dragTool;

        this._keyPressId = 0;
        this._scrollId = 0;
    }

    _matchIntent(event) {
        const sym = event.get_key_symbol();
        const ctrl = event.get_state() & CTRL;

        for (const entry of KEY_MAP) {
            if (entry.sym !== sym) continue;
            if (entry.mod === CTRL && !ctrl) continue;
            if (entry.mod === 0 && ctrl) continue;
            return entry.intent;
        }
        return null;
    }

    _matchToolShortcut(event) {
        if (event.get_state() & CTRL) return null;
        return TOOL_SHORTCUTS[event.get_key_symbol()] ?? null;
    }

    _dispatchKey(event) {
        const consumed =
            this._textEntryManager?.handleKey(event) ??
            this._ocrSelector?.handleKey(event) ??
            this._dragTool?.handleKey(event);

        if (consumed?.passthrough) {
            return Clutter.EVENT_PROPAGATE;
        }
        if (consumed) {
            return Clutter.EVENT_STOP;
        }

        const intent = this._matchIntent(event);
        if (intent) {
            this._execute(intent);
            return Clutter.EVENT_STOP;
        }

        const toolId = this._matchToolShortcut(event);
        if (toolId) {
            this._toolbar.selectTool(toolId);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    connect() {
        const ui = Main.screenshotUI;

        this._keyPressId = ui.connect('key-press-event', (_actor, event) => this._dispatchKey(event));

        this._scrollId = ui.connect('scroll-event', (_actor, event) => {
            this._toolbar.scrollSize(event.get_scroll_direction(), event);
            return Clutter.EVENT_PROPAGATE;
        });
    }

    disconnect() {
        const ui = Main.screenshotUI;

        if (this._keyPressId) {
            ui.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }

        if (this._scrollId) {
            ui.disconnect(this._scrollId);
            this._scrollId = 0;
        }
    }
}
