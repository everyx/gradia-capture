export class DragTool {
    constructor({ toolbar, canvases }) {
        this._toolbar = toolbar;
        this._canvases = canvases;

        this.active = false;
        this._startX = 0;
        this._startY = 0;
        this._canvas = null;
        this._grab = null;
    }

    press(stageX, stageY) {
        const result = this._canvases.selectAt(stageX, stageY);

        if (result) {
            this._toolbar.syncToStroke(result.stroke);
            this._toolbar.updateDrawingControlsSensitivity();

            this.active = true;
            this._startX = stageX;
            this._startY = stageY;
            this._canvas = result.canvas;

            const idx = this._canvases.indexOfCanvas(result.canvas);
            this._grab = global.stage.grab(this._canvases.getOverlay(idx));
            return;
        }

        this.active = false;
    }

    motion(stageX, stageY) {
        if (!this.active || !this._canvas)
            return;

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
    }

    release() {
        this.active = false;
        this._canvas = null;

        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }
    }

    deleteSelected() {
        return this._canvases.deleteSelected();
    }

    destroy() {
        this.release();
    }
}
