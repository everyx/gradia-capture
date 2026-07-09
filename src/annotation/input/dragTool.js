import Clutter from 'gi://Clutter';

import { addEmitter } from '../../platform/emitter.js';
import { SelectionCornerButton } from '../../ui/widgets/selectionCornerButton.js';

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
        this._cornerBtn = new SelectionCornerButton({
            parentBin,
            iconName: 'user-trash-symbolic',
            styleClass: 'gradia-selection-trash gradia-circle-button',
            onClick: () => {
                if (this._canvases.deleteSelected()) this._updateTrash();
            },
        });

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
            this._toolbar.hidePropsPopup?.();
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
        this._cornerBtn.destroy();
    }

    _updateTrash() {
        const sel = this._canvases.selected;
        if (!sel) {
            this._cornerBtn.hide();
            return;
        }

        const bounds = sel.stroke.hitBounds?.();
        if (!bounds) {
            this._cornerBtn.hide();
            return;
        }

        this._cornerBtn.show(bounds.maxX, bounds.minY);
    }

    _hideTrash() {
        this._cornerBtn.hide();
    }
}
