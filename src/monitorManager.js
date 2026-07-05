export class MonitorManager {
    constructor() {
        this._canvases = [];
        this._overlays = [];
        this._bins = [];
    }

    get canvases() { return this._canvases; }
    get overlays() { return this._overlays; }

    get length() { return this._canvases.length; }
    getCanvas(i) { return this._canvases[i]; }
    getOverlay(i) { return this._overlays[i]; }

    forEachCanvas(fn) { this._canvases.forEach(fn); }

    destroy() {
        for (const o of this._overlays)
            o.destroy();
        for (const c of this._canvases)
            c.destroy();
        this._overlays = [];
        this._canvases = [];
        this._bins = [];
    }

    forEachOverlay(fn) { this._overlays.forEach(fn); }

    forEachCanvasReverse(fn) {
        for (let i = this._canvases.length - 1; i >= 0; i--) {
            if (fn(this._canvases[i]))
                break;
        }
    }

    createForBins(bins, canvasFactory, overlayFactory) {
        for (const bin of bins) {
            this._bins.push(bin);
            const canvas = canvasFactory(bin);
            this._canvases.push(canvas);
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
            if (this.binContainsStagePoint(this._bins[i], stageX, stageY))
                return this._canvases[i];
        }
        return this._canvases[0] ?? null;
    }

    getSelectedCanvasAndStroke() {
        for (const canvas of this._canvases) {
            if (canvas.selectedStroke)
                return { canvas, stroke: canvas.selectedStroke };
        }
        return null;
    }

    clearSelections(exceptCanvas = null) {
        for (const canvas of this._canvases) {
            if (canvas !== exceptCanvas)
                canvas.clearSelection();
        }
    }

}
