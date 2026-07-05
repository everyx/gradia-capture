import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { getToolDef } from './tools.js';

const MAX_CANVAS_WIDTH = 1920;
const MAX_CANVAS_HEIGHT = 1080;

export const DrawingCanvas = GObject.registerClass(
    class DrawingCanvas extends St.DrawingArea {
        _init(params) {
            super._init({
                reactive: false,
                x_expand: true,
                y_expand: true,
                ...params,
            });

            this._strokes = [];
            this._currentStroke = null;
            this._strokeColor = '#000000';
            this._toolId = 'freehand';
            this._strokeWidth = 3;
            this._drawing = false;
            this._dragButton = 0;
            this._dragGrab = null;
            this._stampCounter = 1;
            this._selectedStroke = null;

            this._scaleX = 1;
            this._scaleY = 1;

            this.connect('notify::allocation', () => this._updateScale());
        }

        get strokes() { return this._strokes; }
        get selectedStroke() { return this._selectedStroke; }

        setColor(hex) { this._strokeColor = hex; }
        setTool(id) {
            this._toolId = id;
            if (id !== 'drag')
                this._selectedStroke = null;
        }
        setStrokeWidth(w) { this._strokeWidth = w; }

        clear() {
            this._strokes = [];
            this._currentStroke = null;
            this._stampCounter = 1;
            this._selectedStroke = null;
            this.queue_repaint();
        }

        undo() {
            if (this._strokes.length > 0) {
                this._strokes.pop();
                this._selectedStroke = null;
                this.queue_repaint();
            }
        }

        hasStrokes() { return this._strokes.length > 0; }

        deleteSelectedStroke() {
            if (!this._selectedStroke)
                return false;
            const idx = this._strokes.indexOf(this._selectedStroke);
            if (idx !== -1)
                this._strokes.splice(idx, 1);
            this._selectedStroke = null;
            this.queue_repaint();
            return true;
        }

        selectStrokeAt(stageX, stageY) {
            for (let i = this._strokes.length - 1; i >= 0; i--) {
                const stroke = this._strokes[i];
                const tool = getToolDef(stroke.toolId);
                if (tool?.hitTest?.(stroke, stageX, stageY)) {
                    this._selectedStroke = stroke;
                    this.queue_repaint();
                    return stroke;
                }
            }
            this._selectedStroke = null;
            this.queue_repaint();
            return null;
        }

        clearSelection() {
            if (this._selectedStroke) {
                this._selectedStroke = null;
                this.queue_repaint();
            }
        }

        moveSelectedStroke(dx, dy) {
            if (!this._selectedStroke)
                return;
            for (const p of this._selectedStroke.stagePoints) {
                p.x += dx;
                p.y += dy;
            }
            this.queue_repaint();
        }

        adoptStroke(stroke) {
            this._strokes.push(stroke);
            this._selectedStroke = stroke;
            this.queue_repaint();
        }

        evictStroke(stroke) {
            const idx = this._strokes.indexOf(stroke);
            if (idx !== -1)
                this._strokes.splice(idx, 1);
            if (this._selectedStroke === stroke)
                this._selectedStroke = null;
            this.queue_repaint();
        }

        commitTextStroke(stroke) {
            if (stroke)
                this._strokes.push(stroke);
            this.queue_repaint();
        }

        _updateScale() {
            const alloc = this.allocation;
            const stageW = alloc.get_width();
            const stageH = alloc.get_height();

            this._scaleX = stageW > 0 ? Math.max(1, stageW / MAX_CANVAS_WIDTH) : 1;
            this._scaleY = stageH > 0 ? Math.max(1, stageH / MAX_CANVAS_HEIGHT) : 1;
        }

        _stageToLocal(stageX, stageY) {
            const [ok, localX, localY] = this.transform_stage_point(stageX, stageY);
            if (!ok) return null;
            return { x: localX, y: localY };
        }

        _startDrawing(stageX, stageY) {
            const tool = getToolDef(this._toolId);
            if (!tool?.isDrawing)
                return;

            const extra = tool.beginStroke?.() ?? {};
            this._currentStroke = {
                color: this._strokeColor,
                toolId: this._toolId,
                strokeWidth: this._strokeWidth,
                stagePoints: [{ x: stageX, y: stageY }],
                ...extra,
            };

            if (tool.isStamp) {
                this._currentStroke.counter = this._stampCounter;
                this._finishStamp();
                return;
            }

            this._drawing = true;
            this._dragGrab = global.stage.grab(this);
        }

        _finishStamp() {
            if (this._currentStroke)
                this._strokes.push(this._currentStroke);
            this._stampCounter++;
            this._currentStroke = null;
            this.queue_repaint();
        }

        _updateDrawing(stageX, stageY) {
            if (!this._drawing)
                return;

            const tool = getToolDef(this._toolId);

            if (tool?.id === 'freehand') {
                this._currentStroke.stagePoints.push({ x: stageX, y: stageY });
            } else {
                if (this._currentStroke.stagePoints.length === 1)
                    this._currentStroke.stagePoints.push({ x: stageX, y: stageY });
                else
                    this._currentStroke.stagePoints[this._currentStroke.stagePoints.length - 1] = { x: stageX, y: stageY };
            }

            this.queue_repaint();
        }

        _endDrawing() {
            if (this._currentStroke && this._currentStroke.stagePoints.length > 1)
                this._strokes.push(this._currentStroke);

            this._currentStroke = null;
            this._drawing = false;
            this._dragButton = 0;

            if (this._dragGrab) {
                this._dragGrab.dismiss();
                this._dragGrab = null;
            }

            this.queue_repaint();
        }

        vfunc_button_press_event(event) {
            if (this._dragButton)
                return Clutter.EVENT_PROPAGATE;

            const button = event.get_button();
            if (button !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;

            this._dragButton = button;
            const [stageX, stageY] = event.get_coords();
            this._startDrawing(stageX, stageY);
            return Clutter.EVENT_STOP;
        }

        vfunc_button_release_event(event) {
            if (event.get_button() !== this._dragButton)
                return Clutter.EVENT_PROPAGATE;

            this._endDrawing();
            return Clutter.EVENT_STOP;
        }

        vfunc_motion_event(event) {
            if (!this._drawing)
                return Clutter.EVENT_PROPAGATE;

            const [stageX, stageY] = event.get_coords();
            this._updateDrawing(stageX, stageY);
            return Clutter.EVENT_STOP;
        }

        vfunc_touch_event(event) {
            const eventType = event.type();

            if (eventType === Clutter.EventType.TOUCH_BEGIN) {
                if (this._dragButton)
                    return Clutter.EVENT_PROPAGATE;

                this._dragButton = 1;
                const [stageX, stageY] = event.get_coords();
                this._startDrawing(stageX, stageY);
                return Clutter.EVENT_STOP;
            } else if (eventType === Clutter.EventType.TOUCH_UPDATE) {
                if (!this._drawing)
                    return Clutter.EVENT_PROPAGATE;
                const [stageX, stageY] = event.get_coords();
                this._updateDrawing(stageX, stageY);
                return Clutter.EVENT_STOP;
            } else if (eventType === Clutter.EventType.TOUCH_END ||
                eventType === Clutter.EventType.TOUCH_CANCEL) {
                if (!this._drawing)
                    return Clutter.EVENT_PROPAGATE;
                this._endDrawing();
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        vfunc_repaint() {
            const cr = this.get_context();

            const allStrokes = [...this._strokes];
            if (this._currentStroke)
                allStrokes.push(this._currentStroke);

            let stampCounter = 1;

            for (const stroke of allStrokes) {
                const tool = getToolDef(stroke.toolId);
                if (!tool?.render)
                    continue;

                const localPoints = stroke.stagePoints
                    .map(sp => this._stageToLocal(sp.x, sp.y))
                    .filter(p => p !== null);

                tool.render(cr, {
                    color: stroke.color,
                    points: localPoints,
                    counter: stroke.toolId === 'stamp' ? stampCounter++ : stroke.counter,
                    text: stroke.text,
                }, stroke.strokeWidth);
            }

            if (this._selectedStroke) {
                const tool = getToolDef(this._selectedStroke.toolId);
                const bounds = tool?.bounds?.(this._selectedStroke);
                if (bounds) {
                    const tl = this._stageToLocal(bounds.minX, bounds.minY);
                    const br = this._stageToLocal(bounds.maxX, bounds.maxY);
                    if (tl && br) {
                        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.9);
                        cr.setLineWidth(1.5);
                        cr.setDash([5, 4], 0);
                        cr.rectangle(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
                        cr.stroke();
                    }
                }
            }
            cr.$dispose();
        }
    });

export const DrawingInputOverlay = GObject.registerClass(
    class DrawingInputOverlay extends St.Widget {
        _init(canvas, params) {
            super._init({
                reactive: false,
                x_expand: true,
                y_expand: true,
                ...params,
            });
            this._canvas = canvas;
        }

        vfunc_button_press_event(event) {
            return this._canvas.vfunc_button_press_event(event);
        }

        vfunc_button_release_event(event) {
            return this._canvas.vfunc_button_release_event(event);
        }

        vfunc_motion_event(event) {
            return this._canvas.vfunc_motion_event(event);
        }

        vfunc_touch_event(event) {
            return this._canvas.vfunc_touch_event(event);
        }
    });
