import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class TextEntryManager {
    constructor(toolbar, canvases) {
        this._toolbar = toolbar;
        this._canvases = canvases;

        this._entry = null;
        this._pendingStroke = null;
        this._targetCanvas = null;
        this._resizeIdle = 0;
        this._deactivateId = 0;
        this._idleSourceId = 0;
        this._committing = false;
    }

    get isActive() {
        return !!this._entry;
    }

    get hasPending() {
        return !!this._pendingStroke;
    }

    activate(stageX, stageY) {
        if (this._entry) {
            this.commit();
            return;
        }

        const ui = Main.screenshotUI;
        const primaryBin = ui._primaryMonitorBin;
        if (!primaryBin)
            return;

        const [ok, localX, localY] = primaryBin.transform_stage_point(stageX, stageY);
        if (!ok)
            return;

        this._targetCanvas = this._canvases.canvasForStagePoint(stageX, stageY);

        this._pendingStroke = {
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
        this._entry = entry;
        this._updateStyle();

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
            if (this._resizeIdle) {
                GLib.source_remove(this._resizeIdle);
                this._resizeIdle = 0;
            }
            this._resizeIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._resizeIdle = 0;
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
                    return Clutter.EVENT_PROPAGATE;
                this.commit();
                return Clutter.EVENT_STOP;
            }
            if (sym === Clutter.KEY_Escape) {
                this.cancel();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._committing = false;
        clutterText.connect('notify::has-key-focus', () => {
            if (!clutterText.has_key_focus() && !this._committing)
                this.commit();
        });

        const textBtn = this._toolbar.getToolButton('text');
        if (textBtn) {
            this._deactivateId = textBtn.connect('notify::checked', () => {
                if (!textBtn.checked) this.commit();
            });
        }

        entry.grab_key_focus();
    }

    commit() {
        if (!this._entry)
            return;

        const text = this._entry.get_text()?.trim() ?? '';
        if (text.length > 0 && this._pendingStroke) {
            this._pendingStroke.text = text;
            this._targetCanvas?.commitTextStroke(this._pendingStroke);
        }

        this._teardown();
    }

    cancel() {
        if (!this._entry)
            return;

        this._teardown();
    }

    updateColor(hex) {
        if (this._pendingStroke) {
            this._pendingStroke.color = hex;
            this._updateStyle();
        }
    }

    updateLineWidth(width) {
        if (this._pendingStroke) {
            this._pendingStroke.strokeWidth = width;
            this._updateStyle();
        }
    }

    destroy() {
        this._cleanup();
    }

    _cleanup() {
        this._committing = true;
        if (this._deactivateId) {
            const btn = this._toolbar.getToolButton('text');
            if (btn)
                btn.disconnect(this._deactivateId);
            this._deactivateId = 0;
        }
        if (this._resizeIdle) {
            GLib.source_remove(this._resizeIdle);
            this._resizeIdle = 0;
        }
        this._entry?.destroy();
        this._entry = null;
        this._pendingStroke = null;
        this._targetCanvas = null;

        if (this._idleSourceId)
            GLib.source_remove(this._idleSourceId);
        this._idleSourceId = 0;
    }

    _teardown() {
        this._cleanup();
        this._idleSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleSourceId = 0;
            this._committing = false;
            Main.screenshotUI.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateStyle() {
        if (!this._entry)
            return;
        const fs = Math.max(8, Math.round(this._toolbar.lineWidth * 3));
        const col = this._toolbar.selectedColor;
        this._entry.style = `
            color: ${col};
            caret-color: ${col};
            font-size: ${fs}px;
            font-family: "Sans";
        `;
        if (this._resizeIdle) {
            GLib.source_remove(this._resizeIdle);
            this._resizeIdle = 0;
        }
        this._resizeIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._resizeIdle = 0;
            if (!this._entry)
                return GLib.SOURCE_REMOVE;
            const clutterText = this._entry.get_clutter_text();
            const node = this._entry.get_theme_node();
            const vExtra =
                node.get_padding(St.Side.TOP) +
                node.get_padding(St.Side.BOTTOM) +
                node.get_border_width(St.Side.TOP) +
                node.get_border_width(St.Side.BOTTOM);
            const [, naturalHeight] = clutterText.get_preferred_height(-1);
            this._entry.set_height(naturalHeight + vExtra);
            return GLib.SOURCE_REMOVE;
        });
    }
}
