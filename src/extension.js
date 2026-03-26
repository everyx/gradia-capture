import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Toolbar } from './topBar.js';

const STROKE_WIDTH = 3;

const MAX_CANVAS_WIDTH = 1920;
const MAX_CANVAS_HEIGHT = 1080;

export const Tool = {
    SELECT: 0,
    FREEHAND: 1,
    RECTANGLE: 2,
    ARROW: 3,
};

function hexToRgb(hex) {
    return {
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255,
    };
}

function drawArrowhead(cr, fromX, fromY, toX, toY, size) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const spread = Math.PI / 7;

    const x1 = toX - size * Math.cos(angle - spread);
    const y1 = toY - size * Math.sin(angle - spread);
    const x2 = toX - size * Math.cos(angle + spread);
    const y2 = toY - size * Math.sin(angle + spread);

    cr.moveTo(toX, toY);
    cr.lineTo(x1, y1);
    cr.moveTo(toX, toY);
    cr.lineTo(x2, y2);
    cr.stroke();
}

function renderStroke(cr, stroke, lineWidth) {
    if (stroke.points.length < 2)
        return;

    const { r, g, b } = hexToRgb(stroke.color);
    cr.setSourceRGBA(r, g, b, 1.0);
    cr.setLineWidth(lineWidth);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineJoin(Cairo.LineJoin.ROUND);

    const pts = stroke.points;

    if (stroke.tool === Tool.RECTANGLE) {
        const p0 = pts[0];
        const p1 = pts[pts.length - 1];
        const x = Math.min(p0.x, p1.x);
        const y = Math.min(p0.y, p1.y);
        const w = Math.abs(p1.x - p0.x);
        const h = Math.abs(p1.y - p0.y);
        cr.rectangle(x, y, w, h);
        cr.stroke();
    } else if (stroke.tool === Tool.ARROW) {
        const p0 = pts[0];
        const p1 = pts[pts.length - 1];
        cr.moveTo(p0.x, p0.y);
        cr.lineTo(p1.x, p1.y);
        cr.stroke();
        drawArrowhead(cr, p0.x, p0.y, p1.x, p1.y, lineWidth * 5);
    } else {
        cr.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++)
            cr.lineTo(pts[i].x, pts[i].y);
        cr.stroke();
    }
}

function getAreaSelectorHandles(selector) {
    if (!selector)
        return [];
    return [
        selector._topLeftHandle,
        selector._topRightHandle,
        selector._bottomLeftHandle,
        selector._bottomRightHandle,
    ].filter(h => h != null);
}

export function setAreaSelectorHandlesVisible(selector, visible) {
    for (const handle of getAreaSelectorHandles(selector)) {
        if (visible)
            handle.show();
        else
            handle.hide();
    }
}

const DrawingCanvas = GObject.registerClass(
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
            this._tool = Tool.FREEHAND;
            this._drawing = false;
            this._dragButton = 0;
            this._dragGrab = null;

            this._scaleX = 1;
            this._scaleY = 1;

            this.connect('notify::allocation', () => this._updateScale());
        }

        get strokes() { return this._strokes; }

        setColor(hex) { this._strokeColor = hex; }
        setTool(tool) { this._tool = tool; }

        clear() {
            this._strokes = [];
            this._currentStroke = null;
            this.queue_repaint();
        }

        undo() {
            if (this._strokes.length > 0) {
                this._strokes.pop();
                this.queue_repaint();
            }
        }

        hasStrokes() { return this._strokes.length > 0; }

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
            this._currentStroke = {
                color: this._strokeColor,
                tool: this._tool,
                stagePoints: [{ x: stageX, y: stageY }],
            };
            this._drawing = true;
            this._dragGrab = global.stage.grab(this);
        }

        _updateDrawing(stageX, stageY) {
            if (!this._drawing)
                return;

            if (this._tool === Tool.FREEHAND) {
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

            for (const stroke of allStrokes) {
                const localPoints = [];
                for (const sp of stroke.stagePoints) {
                    const lp = this._stageToLocal(sp.x, sp.y);
                    if (lp) localPoints.push(lp);
                }

                renderStroke(cr, {
                    color: stroke.color,
                    tool: stroke.tool,
                    points: localPoints,
                }, STROKE_WIDTH);
            }

            cr.$dispose();
        }
    });

export default class GradiaCompanion extends Extension {
    enable() {
        this._originalOpen = Main.screenshotUI.open.bind(Main.screenshotUI);
        this._toolbar = null;
        this._canvases = [];

        const self = this;

        Main.screenshotUI.open = async function (...args) {
            const result = await self._originalOpen(...args);
            self._ensureUI();
            return result;
        };

        this._closedId = Main.screenshotUI.connect('closed', () => {
            self._removeUI();
        });

        this._screenshotTakenId = Main.screenshotUI.connect('screenshot-taken', (_ui, file) => {
            const hasAny = self._canvases.some(c => c.hasStrokes());
            if (hasAny) {
                const strokeData = self._buildStrokeData();
                self._compositeStrokesAsync(file, strokeData);
            }
        });
    }

    disable() {
        if (this._originalOpen) {
            Main.screenshotUI.open = this._originalOpen;
            this._originalOpen = null;
        }

        if (this._closedId) {
            Main.screenshotUI.disconnect(this._closedId);
            this._closedId = null;
        }

        if (this._screenshotTakenId) {
            Main.screenshotUI.disconnect(this._screenshotTakenId);
            this._screenshotTakenId = null;
        }

        this._removeUI();
    }

    _buildStrokeData() {
        const ui = Main.screenshotUI;

        let selX = 0, selY = 0, selW = 0, selH = 0;

        if (ui._selectionButton.checked) {
            [selX, selY, selW, selH] = ui._areaSelector.getGeometry();
        } else if (ui._screenButton.checked) {
            const index = ui._screenSelectors.findIndex(s => s.checked);
            const monitor = Main.layoutManager.monitors[index];
            selX = monitor.x;
            selY = monitor.y;
            selW = monitor.width;
            selH = monitor.height;
        } else if (ui._windowButton.checked) {
            const window = ui._windowSelectors
                .flatMap(sel => sel.windows())
                .find(win => win.checked);

            if (window) {
                const box = window.boundingBox;
                selX = box.x;
                selY = box.y;
                selW = box.width;
                selH = box.height;
            }
        }

        const strokes = this._canvases.flatMap(c =>
            c.strokes.map(s => ({
                color: s.color,
                tool: s.tool,
                stagePoints: s.stagePoints.map(p => ({ x: p.x, y: p.y })),
            }))
        );

        return {
            selX, selY, selW, selH,
            strokes,
            stageScale: global.stage.scale_factor || 1,
        };
    }

    _compositeStrokesAsync(file, data) {
        const path = file.get_path();
        if (!path || data.selW <= 0 || data.selH <= 0)
            return;

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._doComposite(path, data);
            return GLib.SOURCE_REMOVE;
        });
    }

    _doComposite(path, data) {
        const { selX, selY, selW, selH, strokes, stageScale } = data;
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
        const imgWidth = pixbuf.get_width();
        const imgHeight = pixbuf.get_height();
        const scaleX = imgWidth / selW;
        const scaleY = imgHeight / selH;

        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, imgWidth, imgHeight);
        const cr = new Cairo.Context(surface);

        imports.gi.Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
        cr.paint();

        const lw = STROKE_WIDTH * ((scaleX + scaleY) / 2);

        for (const stroke of strokes) {
            const converted = stroke.stagePoints.map(p => ({
                x: (p.x / stageScale - selX) * scaleX,
                y: (p.y / stageScale - selY) * scaleY,
            }));
            renderStroke(cr, {
                color: stroke.color,
                tool: stroke.tool,
                points: converted,
            }, lw);
        }

        surface.writeToPNG(path);
    }

    _isDrawingTool(tool) {
        return tool !== Tool.SELECT;
    }

    _setTool(tool) {
        const drawing = this._isDrawingTool(tool);

        for (const canvas of this._canvases) {
            canvas.reactive = drawing;
            canvas.setTool(tool);
        }

        this._updateAreaSelectorState(tool);
    }

    _updateAreaSelectorState(tool) {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        if (!Main.screenshotUI._selectionButton.checked)
            return;

        const drawing = this._isDrawingTool(tool);

        if (drawing) {
            selector.reactive = false;
            setAreaSelectorHandlesVisible(selector, false);
        } else {
            selector.reactive = true;
            selector._areaIndicator?.show();
            setAreaSelectorHandlesVisible(selector, true);
        }
    }

    _isWindowMode() {
        return Main.screenshotUI._windowButton.checked;
    }

    _isRecordingMode() {
        return Main.screenshotUI._castButton?.checked ?? false;
    }

    _updateVisibilityForMode() {
        const windowMode = this._isWindowMode();
        const recordingMode = this._isRecordingMode();
        const show = !windowMode && !recordingMode;

        if (this._toolbar)
            this._toolbar.visible = show;

        for (const canvas of this._canvases)
            canvas.visible = show;

        if (show)
            this._updateAreaSelectorState(this._toolbar?.selectedTool ?? Tool.SELECT);
    }

    _connectDragOpacity() {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        this._dragStartedId = selector.connect('drag-started', () => {
            this._toolbar?.ease({
                opacity: 100,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });

        this._dragEndedId = selector.connect('drag-ended', () => {
            this._toolbar?.ease({
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
    }

    _disconnectDragOpacity() {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        if (this._dragStartedId) {
            selector.disconnect(this._dragStartedId);
            this._dragStartedId = null;
        }
        if (this._dragEndedId) {
            selector.disconnect(this._dragEndedId);
            this._dragEndedId = null;
        }
    }

    _ensureUI() {
        if (this._toolbar)
            return;

        const ui = Main.screenshotUI;

        this._canvases = [];

        const monitorBins = ui._monitorBins ?? [];
        const binsToUse = monitorBins.length > 0
            ? monitorBins
            : (ui._primaryMonitorBin ? [ui._primaryMonitorBin] : []);

        for (const bin of binsToUse) {
            const canvas = new DrawingCanvas({
                style: 'background-color: transparent;',
            });
            canvas.reactive = false;
            bin.insert_child_below(canvas, null);
            this._canvases.push(canvas);
        }

        const primaryBin = ui._primaryMonitorBin;
        if (!primaryBin)
            return;

        this._toolbar = new Toolbar();

        this._toolbar.connect('tool-changed', (_toolbar, tool) => {
            this._setTool(tool);
        });

        this._toolbar.connect('color-changed', (_toolbar, hex) => {
            for (const canvas of this._canvases)
                canvas.setColor(hex);
        });

        this._toolbar.connect('undo', () => {
            for (let i = this._canvases.length - 1; i >= 0; i--) {
                if (this._canvases[i].hasStrokes()) {
                    this._canvases[i].undo();
                    break;
                }
            }
        });

        this._toolbar.connect('clear', () => {
            for (const canvas of this._canvases)
                canvas.clear();
        });

        for (const canvas of this._canvases) {
            canvas.setColor(this._toolbar.selectedColor);
            canvas.setTool(this._toolbar.selectedTool);
        }

        primaryBin.add_child(this._toolbar);

        this._windowButtonId = ui._windowButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });
        this._selectionButtonId = ui._selectionButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });
        this._screenButtonId = ui._screenButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });
        this._castButtonId = ui._castButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });

        this._connectDragOpacity();

        this._setTool(Tool.SELECT);
        this._updateVisibilityForMode();
    }

    _removeUI() {
        const ui = Main.screenshotUI;

        if (this._windowButtonId) {
            ui._windowButton.disconnect(this._windowButtonId);
            this._windowButtonId = null;
        }
        if (this._selectionButtonId) {
            ui._selectionButton.disconnect(this._selectionButtonId);
            this._selectionButtonId = null;
        }
        if (this._screenButtonId) {
            ui._screenButton.disconnect(this._screenButtonId);
            this._screenButtonId = null;
        }
        if (this._castButtonId) {
            ui._castButton.disconnect(this._castButtonId);
            this._castButtonId = null;
        }

        this._disconnectDragOpacity();

        const selector = ui._areaSelector;
        if (selector) {
            selector.reactive = true;
            setAreaSelectorHandlesVisible(selector, true);
        }

        for (const canvas of this._canvases)
            canvas.destroy();
        this._canvases = [];

        if (this._toolbar) {
            this._toolbar.destroy();
            this._toolbar = null;
        }
    }
}
