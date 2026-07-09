import { getToolDef } from '../annotation/tools/index.js';

export class CanvasCollection {
    constructor() {
        this._canvasList = [];
        this._overlays = [];
        this._bins = [];
    }

    get canvases() {
        return this._canvasList;
    }
    get overlays() {
        return this._overlays;
    }

    get length() {
        return this._canvasList.length;
    }
    getCanvas(i) {
        return this._canvasList[i];
    }
    getOverlay(i) {
        return this._overlays[i];
    }
    indexOfCanvas(canvas) {
        return this._canvasList.indexOf(canvas);
    }

    forEachCanvas(fn) {
        this._canvasList.forEach(fn);
    }
    forEachOverlay(fn) {
        this._overlays.forEach(fn);
    }

    destroy() {
        for (const o of this._overlays) o.destroy();
        for (const c of this._canvasList) c.destroy();
        this._overlays = [];
        this._canvasList = [];
        this._bins = [];
    }

    createForBins(bins, canvasFactory, overlayFactory) {
        for (const bin of bins) {
            this._bins.push(bin);
            const canvas = canvasFactory(bin);
            this._canvasList.push(canvas);
            const overlay = overlayFactory(bin, canvas);
            this._overlays.push(overlay);
        }
    }

    binContainsStagePoint(bin, stageX, stageY) {
        const [ok, lx, ly] = bin.transform_stage_point(stageX, stageY);
        if (!ok) return false;
        const alloc = bin.allocation;
        return lx >= 0 && lx < alloc.get_width() && ly >= 0 && ly < alloc.get_height();
    }

    canvasForStagePoint(stageX, stageY) {
        for (let i = 0; i < this._bins.length; i++) {
            if (this.binContainsStagePoint(this._bins[i], stageX, stageY)) return this._canvasList[i];
        }
        return this._canvasList[0] ?? null;
    }

    getSelectedCanvasAndStroke() {
        for (const canvas of this._canvasList) {
            if (canvas.selectedStroke) return { canvas, stroke: canvas.selectedStroke };
        }
        return null;
    }

    allCanvasesVisible() {
        return this._canvasList.every((c) => c.visible && c.opacity > 0);
    }

    clearSelections(exceptCanvas = null) {
        for (const canvas of this._canvasList) {
            if (canvas !== exceptCanvas) canvas.clearSelection();
        }
    }

    get strokeData() {
        const strokes = [];
        this.forEachCanvas((c) => {
            for (const s of c.strokes) {
                const copy = {
                    color: s.color,
                    toolId: s.toolId,
                    counter: s.counter,
                    strokeWidth: s.strokeWidth,
                    text: s.text,
                    blurMode: s.blurMode,
                    blockSize: s.blockSize,
                    stagePoints: s.stagePoints.map((p) => ({ x: p.x, y: p.y })),
                };
                getToolDef(s.toolId)?.bindCapabilities?.(copy);
                strokes.push(copy);
            }
        });
        return strokes;
    }

    get selected() {
        return this.getSelectedCanvasAndStroke();
    }

    get hasStrokes() {
        for (let i = 0; i < this._canvasList.length; i++) {
            if (this._canvasList[i].hasStrokes()) return true;
        }
        return false;
    }

    selectAt(stageX, stageY) {
        for (let i = this._canvasList.length - 1; i >= 0; i--) {
            const canvas = this._canvasList[i];
            const stroke = canvas.selectStrokeAt(stageX, stageY);
            if (stroke) {
                this.clearSelections(canvas);
                return { canvas, stroke };
            }
        }
        this.clearSelections();
        return null;
    }

    undo() {
        for (let i = this._canvasList.length - 1; i >= 0; i--) {
            if (this._canvasList[i].hasStrokes()) {
                this._canvasList[i].undo();
                return;
            }
        }
    }

    clear() {
        this.clearSelections();
        this.forEachCanvas((c) => c.clear());
    }

    deleteSelected() {
        const sel = this.selected;
        if (sel) {
            sel.canvas.deleteSelectedStroke();
            return true;
        }
        return false;
    }

    applyToLastStroke(toolId, propName, value) {
        this.forEachCanvas((c) => {
            const strokes = c.strokes;
            if (strokes.length === 0) return;
            const last = strokes[strokes.length - 1];
            if (last.toolId !== toolId) return;
            if (c.selectedStroke === last) return;
            last[propName] = value;
            c.queue_repaint();
        });
    }
}
