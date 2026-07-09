import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { attachTooltip } from '../../platform/tooltip.js';

const BTN_SIZE = 32;

export class SelectionCornerButton {
    constructor({ parentBin, iconName, iconSize = 16, styleClass, onClick, tooltipText, btnSize = BTN_SIZE }) {
        this._parentBin = parentBin;
        this._btnSize = btnSize;

        this._btn = new St.Button({
            style_class: styleClass,
            child: new St.Icon({
                icon_name: iconName,
                style: `icon-size: ${iconSize}px;`,
            }),
            reactive: true,
        });

        if (onClick) this._btn.connect('clicked', onClick);
        if (tooltipText) attachTooltip(this._btn, tooltipText, St.Side.RIGHT);

        const panel = Main.screenshotUI._panel;
        if (panel) parentBin.insert_child_below(this._btn, panel);
        else parentBin.add_child(this._btn);
    }

    show(stageCenterX, stageCenterY) {
        if (!this._btn) return;

        const half = this._btnSize / 2;

        const [ok, cx, cy] = this._parentBin.transform_stage_point(stageCenterX, stageCenterY);
        if (!ok) return;

        let x = Math.round(cx - half);
        let y = Math.round(cy - half);

        const parentW = this._parentBin.width;
        const parentH = this._parentBin.height;

        if (x + this._btnSize > parentW) x = Math.max(0, parentW - this._btnSize);
        if (y < 0) y = 0;
        if (y + this._btnSize > parentH) y = parentH - this._btnSize;

        this._btn.set_position(x, y);
        this._btn.show();
    }

    hide() {
        this._btn?.hide();
    }

    destroy() {
        if (this._btn) {
            this._btn.destroy();
            this._btn = null;
        }
    }
}
