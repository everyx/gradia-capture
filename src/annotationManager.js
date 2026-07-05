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
        let found = false;
        this._monitors.forEachCanvas(c => {
            if (c.hasStrokes()) found = true;
        });
        return found;
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
        this._monitors.forEachCanvasReverse(c => {
            if (c.hasStrokes()) {
                c.undo();
                return true;
            }
            return false;
        });
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
