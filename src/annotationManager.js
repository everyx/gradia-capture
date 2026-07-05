export class AnnotationManager {
    constructor(monitors) {
        this._monitors = monitors;
    }

    get strokeData() {
        const strokes = [];
        this._monitors.forEachCanvas(c => {
            for (const s of c.strokes) {
                strokes.push({
                    color: s.color,
                    toolId: s.toolId,
                    counter: s.counter,
                    strokeWidth: s.strokeWidth,
                    text: s.text,
                    stagePoints: s.stagePoints.map(p => ({ x: p.x, y: p.y })),
                });
            }
        });
        return strokes;
    }

    get selected() {
        return this._monitors.getSelectedCanvasAndStroke();
    }

    get hasStrokes() {
        for (let i = 0; i < this._monitors.length; i++) {
            if (this._monitors.getCanvas(i).hasStrokes())
                return true;
        }
        return false;
    }

    selectAt(stageX, stageY) {
        for (let i = this._monitors.length - 1; i >= 0; i--) {
            const canvas = this._monitors.getCanvas(i);
            const stroke = canvas.selectStrokeAt(stageX, stageY);
            if (stroke) {
                this._monitors.clearSelections(canvas);
                return { canvas, stroke };
            }
        }
        this._monitors.clearSelections();
        return null;
    }

    undo() {
        for (let i = this._monitors.length - 1; i >= 0; i--) {
            if (this._monitors.getCanvas(i).hasStrokes()) {
                this._monitors.getCanvas(i).undo();
                return;
            }
        }
    }

    clear() {
        this._monitors.clearSelections();
        this._monitors.forEachCanvas(c => c.clear());
    }

    deleteSelected() {
        const sel = this.selected;
        if (sel) {
            sel.canvas.deleteSelectedStroke();
            return true;
        }
        return false;
    }
}
