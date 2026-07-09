import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { addEmitter } from '../../platform/emitter.js';

const TRASH_RADIUS = 16;

export class DragTool {
    constructor({ toolbar, canvases, parentBin, bus }) {
        this._toolbar = toolbar;
        this._canvases = canvases;
        this._parentBin = parentBin;

        this.active = false;
        this._startX = 0;
        this._startY = 0;
        this._canvas = null;
        this._grab = null;
        this._trashBtn = null;

        addEmitter(this);
        if (bus) {
            bus.connect('tool-changed', (id) => {
                if (id !== 'drag') this.onDeactivate();
            });
        }
    }

    refresh() {
        this._updateTrash();
    }

    onDeactivate() {
        this._canvases.clearSelections();
        this.refresh();
    }

    press(stageX, stageY) {
        const result = this._canvases.selectAt(stageX, stageY);

        if (result) {
            this._toolbar.syncToStroke(result.stroke);

            this.active = true;
            this._startX = stageX;
            this._startY = stageY;
            this._canvas = result.canvas;

            const idx = this._canvases.indexOfCanvas(result.canvas);
            this._grab = global.stage.grab(this._canvases.getOverlay(idx));
        } else {
            this.active = false;
        }
        this._updateTrash();
    }

    motion(stageX, stageY) {
        if (!this.active || !this._canvas) return;

        const dx = stageX - this._startX;
        const dy = stageY - this._startY;

        const stroke = this._canvas.selectedStroke;
        const targetCanvas = this._canvases.canvasForStagePoint(stageX, stageY);

        if (targetCanvas && targetCanvas !== this._canvas && stroke) {
            this._canvas.evictStroke(stroke);
            targetCanvas.adoptStroke(stroke);
            this._canvas = targetCanvas;
        }

        this._canvas.moveSelectedStroke(dx, dy);
        this._startX = stageX;
        this._startY = stageY;
        this._updateTrash();
    }

    release() {
        this.active = false;
        this._canvas = null;

        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }
        this._updateTrash();
    }

    deleteSelected() {
        return this._canvases.deleteSelected();
    }

    handleKey(event) {
        if (!this.active) return null;
        if (!this._canvas?.selectedStroke) return null;

        const sym = event.get_key_symbol();
        if (sym === Clutter.KEY_Delete || sym === Clutter.KEY_BackSpace) {
            this._canvases.deleteSelected();
            this._updateTrash();
            return true;
        }
        return null;
    }

    destroy() {
        this.release();
        this._destroyTrash();
    }

    _updateTrash() {
        const sel = this._canvases.selected;
        if (!sel) {
            this._hideTrash();
            return;
        }

        const bounds = sel.stroke.hitBounds?.();
        if (!bounds) {
            this._hideTrash();
            return;
        }

        if (!this._trashBtn) this._buildTrash();

        const [ok, lx, ly] = this._parentBin.transform_stage_point(bounds.maxX, bounds.minY);
        if (!ok) {
            this._hideTrash();
            return;
        }

        this._trashBtn.set_position(Math.round(lx - TRASH_RADIUS), Math.round(ly - TRASH_RADIUS));
        this._trashBtn.show();
    }

    _hideTrash() {
        this._trashBtn?.hide();
    }

    _destroyTrash() {
        if (this._trashBtn) {
            this._trashBtn.destroy();
            this._trashBtn = null;
        }
    }

    _buildTrash() {
        this._trashBtn = new St.Button({
            style_class: 'gradia-selection-trash gradia-circle-button',
            child: new St.Icon({
                icon_name: 'user-trash-symbolic',
                style: 'icon-size: 16px;',
            }),
            reactive: true,
        });
        this._trashBtn.connect('clicked', () => {
            if (this._canvases.deleteSelected()) this._updateTrash();
        });
        this._parentBin.insert_child_below(this._trashBtn, Main.screenshotUI._panel);
    }
}
