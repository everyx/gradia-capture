import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { clampToMonitor, getSelectionRect } from '../geometry.js';

// A BoxPointer that anchors the panel to the leading edge of the source
// actor (left-aligned in LTR).  The arrow is disabled (-arrow-rise: 0) so
// the border is a plain rounded rect.  Positioning on the source-opposite
// side and automatic flip (outside-first) are handled by the parent class.
const PropsBoxPointer = GObject.registerClass(
    class PropsBoxPointer extends BoxPointer.BoxPointer {
        _reposition(allocationBox) {
            const [, , natWidth, natHeight] = this.get_preferred_size();
            const themeNode = this.get_theme_node();
            const gap = themeNode.get_length('-boxpointer-gap');

            if (!this._sourceActor) return;

            const monitorIndex = Main.layoutManager.findIndexForActor(this._sourceActor);
            this._sourceExtents = this._sourceActor.get_transformed_extents();
            const monitor = Main.layoutManager.monitors[monitorIndex] ?? Main.layoutManager.primaryMonitor;
            if (monitor) this._workArea = { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height };

            const sourceTopLeft = this._sourceExtents.get_top_left();
            const sourceBottomRight = this._sourceExtents.get_bottom_right();

            let resX;
            if (this.text_direction === Clutter.TextDirection.RTL) resX = sourceBottomRight.x - natWidth;
            else resX = sourceTopLeft.x;

            let resY;
            switch (this._arrowSide) {
                case St.Side.TOP:
                    resY = sourceBottomRight.y + gap;
                    break;
                case St.Side.BOTTOM:
                    resY = sourceTopLeft.y - natHeight - gap;
                    break;
                case St.Side.LEFT:
                    resY = sourceBottomRight.x + gap;
                    break;
                case St.Side.RIGHT:
                    resY = sourceTopLeft.x - natWidth - gap;
                    break;
                default:
                    resY = sourceBottomRight.y + gap;
            }

            if (this._workArea) {
                const c = clampToMonitor(resX, resY, natWidth, natHeight, this._workArea);
                resX = c.x;
                resY = c.y;
            }

            let parent = this.get_parent();
            let success, x, y;
            while (!success) {
                [success, x, y] = parent.transform_stage_point(resX, resY);
                parent = parent.get_parent();
            }

            allocationBox.set_origin(Math.floor(x), Math.floor(y));
        }
    },
);

// A popover wrapper around GNOME Shell's native BoxPointer.
// - Horizontal: left-aligned to the trigger button (clamped to monitor).
// - Vertical: prefers the "outside" side of the toolbar (away from the
//   selection).  BoxPointer's built-in _updateFlip automatically flips to
//   the "inside" side when there is not enough room outside.
//   Uses full monitor bounds (not workarea) since the screenshot overlay
//   covers the top panel.
export const PopupMenu = GObject.registerClass(
    class PopupMenu extends St.Widget {
        _init(styleClass = '', params = {}) {
            super._init({
                layout_manager: new Clutter.BinLayout(),
                ...params,
            });

            this._boxPointer = new PropsBoxPointer(St.Side.TOP);
            this._boxPointer.style_class = 'gradia-popover';
            this._boxPointer.hide();

            this._content = new St.BoxLayout({
                style_class: styleClass,
                x_expand: false,
                y_expand: false,
                reactive: true,
            });
            this._boxPointer.bin.set_child(this._content);

            super.add_child(this._boxPointer);

            this._toolbar = null;
        }

        _getSelectionRect() {
            return getSelectionRect();
        }

        add_child(child) {
            this._content.add_child(child);
        }

        set_child_at_index(child, index) {
            this._content.set_child_at_index(child, index);
        }

        get isOpen() {
            return this._boxPointer.visible;
        }

        contains(actor) {
            return this._boxPointer.contains(actor);
        }

        get_stage() {
            return this._boxPointer.get_stage();
        }

        open(triggerBtn, toolbar = null) {
            if (toolbar) this._toolbar = toolbar;
            if (triggerBtn) {
                this._boxPointer.updateArrowSide(this._pickArrowSide());
                this._boxPointer.setPosition(triggerBtn, 0);
            }
            this._boxPointer.open(BoxPointer.PopupAnimation.FULL);
        }

        close() {
            this._boxPointer.close(BoxPointer.PopupAnimation.FULL);
        }

        repositionTo(triggerBtn, toolbar = null) {
            if (toolbar) this._toolbar = toolbar;
            if (triggerBtn) {
                this._boxPointer.updateArrowSide(this._pickArrowSide());
                this._boxPointer.setPosition(triggerBtn, 0);
            }
        }

        _pickArrowSide() {
            const sel = this._getSelectionRect();
            if (!sel || !this._toolbar) return St.Side.TOP;

            const [, tbY] = this._toolbar.get_transformed_position();
            const [, tbH] = this._toolbar.get_size();
            const tbCenterY = tbY + tbH / 2;
            const selCenterY = sel.y + sel.height / 2;

            // Prefer the "outside" (away from the selection).
            // BoxPointer._updateFlip flips to the inside when needed.
            return tbCenterY < selCenterY ? St.Side.BOTTOM : St.Side.TOP;
        }
    },
);
