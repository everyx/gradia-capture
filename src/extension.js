import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

const COLORS = [
    { name: 'White',  hex: '#ffffff' },
    { name: 'Red',    hex: '#ff4444' },
    { name: 'Orange', hex: '#ff8800' },
    { name: 'Yellow', hex: '#ffdd00' },
    { name: 'Green',  hex: '#44cc44' },
    { name: 'Blue',   hex: '#4488ff' },
    { name: 'Purple', hex: '#aa44ff' },
];

const STROKE_WIDTH = 3;

const Tool = {
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

function setAreaSelectorHandlesVisible(selector, visible) {
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
        this._strokeColor = '#ff4444';
        this._tool = Tool.FREEHAND;
        this._drawing = false;
        this._dragButton = 0;
        this._dragGrab = null;
    }

    get strokes() {
        return this._strokes;
    }

    setColor(hex) {
        this._strokeColor = hex;
    }

    setTool(tool) {
        this._tool = tool;
    }

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

    hasStrokes() {
        return this._strokes.length > 0;
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

        } else if (eventType === Clutter.EventType.TOUCH_END || eventType === Clutter.EventType.TOUCH_CANCEL) {
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
        this._canvas = null;
        this._colorButtons = [];
        this._toolButtons = [];
        this._selectedColor = COLORS[1].hex;
        this._selectedTool = Tool.SELECT;
        this._undoBtn = null;
        this._clearBtn = null;

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
            if (self._canvas && self._canvas.hasStrokes()) {
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

        const strokes = this._canvas.strokes.map(s => ({
            color: s.color,
            tool: s.tool,
            stagePoints: s.stagePoints.map(p => ({ x: p.x, y: p.y })),
        }));

        return {
            selX, selY, selW, selH,
            strokes,
            stageScale: global.stage.scale_factor || 1,
        };
    }

    _compositeStrokesAsync(file, data) {
        const path = file.get_path();

        if (!path || data.selW <= 0 || data.selH <= 0) {
            return;
        }
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

        const surface = new Cairo.ImageSurface(
            Cairo.Format.ARGB32, imgWidth, imgHeight
        );
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
        this._selectedTool = tool;

        const drawing = this._isDrawingTool(tool);

        if (this._canvas) {
            this._canvas.reactive = drawing;
            this._canvas.setTool(tool);
        }

        for (const btn of this._toolButtons)
            btn.checked = (btn._tool === tool);

        this._updateAreaSelectorVisibility();
    }

    _updateAreaSelectorVisibility() {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        if (!Main.screenshotUI._selectionButton.checked)
            return;

        const drawing = this._isDrawingTool(this._selectedTool);

        if (drawing) {
            setAreaSelectorHandlesVisible(selector, false);
        } else {
            selector._areaIndicator?.show();
            setAreaSelectorHandlesVisible(selector, true);
        }
    }

    _isWindowMode() {
        return Main.screenshotUI._windowButton.checked;
    }

    _updateVisibilityForMode() {
        const windowMode = this._isWindowMode();
        if (this._toolbar)
            this._toolbar.visible = !windowMode;
        if (this._canvas)
            this._canvas.visible = !windowMode;

        if (!windowMode)
            this._updateAreaSelectorVisibility();
    }

    _connectDragOpacity() {
        const ui = Main.screenshotUI;
        const selector = ui._areaSelector;
        if (!selector)
            return;

        this._dragStartedId = selector.connect('drag-started', () => {
            if (this._toolbar) {
                this._toolbar.ease({
                    opacity: 100,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        });

        this._dragEndedId = selector.connect('drag-ended', () => {
            if (this._toolbar) {
                this._toolbar.ease({
                    opacity: 255,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
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

        const primaryBin = Main.screenshotUI._primaryMonitorBin;
        if (!primaryBin)
            return;

        this._canvas = new DrawingCanvas({
            style: 'background-color: transparent;',
        });
        this._canvas.setColor(this._selectedColor);
        this._canvas.setTool(this._selectedTool);
        this._canvas.reactive = false;
        primaryBin.insert_child_below(this._canvas, null);

        this._toolbar = new St.BoxLayout({
            style_class: 'screenshot-ui-panel gradia-toolbar',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            y_expand: true,
            reactive: true,
        });

        this._toolButtons = [];

        const toolDefs = [
            { tool: Tool.SELECT,    icon: 'screenshot-ui-area-symbolic' },
            { tool: Tool.FREEHAND,  icon: 'document-edit-symbolic' },
            { tool: Tool.RECTANGLE, icon: 'checkbox-symbolic' },
            { tool: Tool.ARROW,     icon: 'go-up-symbolic' },
        ];

        for (const def of toolDefs) {
            const btn = new St.Button({
                child: new St.Icon({
                    icon_name: def.icon,
                    style: 'icon-size: 16px;',
                }),
                style_class: 'screenshot-ui-type-button gradia-square-button',
                toggle_mode: true,
                checked: def.tool === this._selectedTool,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn._tool = def.tool;
            btn.connect('clicked', () => this._setTool(def.tool));
            this._toolbar.add_child(btn);
            this._toolButtons.push(btn);
        }

        this._toolbar.add_child(new St.Widget({
            style_class: 'gradia-separator',
            y_expand: true,
        }));

        this._colorButtons = [];
        for (const color of COLORS) {
            const btn = new St.Button({
                style_class: 'gradia-color-button',
                style: `background-color: ${color.hex};`,
                reactive: true,
                toggle_mode: true,
                checked: color.hex === this._selectedColor,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const isWhite = color.hex.toLowerCase() === '#ffffff';
            const checkIcon = new St.Icon({
                icon_name: 'object-select-symbolic',
                style_class: isWhite ? 'gradia-check-icon-dark' : 'gradia-check-icon',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
                visible: color.hex === this._selectedColor,
            });
            btn.set_child(checkIcon);
            btn._checkIcon = checkIcon;

            btn._colorHex = color.hex;
            btn.connect('clicked', () => {
                this._selectedColor = color.hex;
                this._canvas.setColor(color.hex);
                this._updateColorSelection();
            });

            this._toolbar.add_child(btn);
            this._colorButtons.push(btn);
        }

        this._toolbar.add_child(new St.Widget({
            style_class: 'gradia-separator',
            y_expand: true,
        }));

        this._undoBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'edit-undo-symbolic',
                style: 'icon-size: 16px;',
            }),
            style_class: 'screenshot-ui-type-button gradia-square-button',
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._undoBtn.connect('clicked', () => this._canvas.undo());
        this._toolbar.add_child(this._undoBtn);

        this._clearBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'user-trash-symbolic',
                style: 'icon-size: 16px;',
            }),
            style_class: 'screenshot-ui-type-button gradia-square-button',
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clearBtn.connect('clicked', () => this._canvas.clear());
        this._toolbar.add_child(this._clearBtn);

        primaryBin.add_child(this._toolbar);

        const ui = Main.screenshotUI;
        this._windowButtonId = ui._windowButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });
        this._selectionButtonId = ui._selectionButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });
        this._screenButtonId = ui._screenButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });

        this._connectDragOpacity();

        this._setTool(Tool.SELECT);
        this._updateVisibilityForMode();
    }

    _updateColorSelection() {
        for (const btn of this._colorButtons) {
            const isSelected = btn._colorHex === this._selectedColor;
            btn.checked = isSelected;
            btn.style = `background-color: ${btn._colorHex};`;
            if (btn._checkIcon)
                btn._checkIcon.visible = isSelected;
        }
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

        this._disconnectDragOpacity();

        setAreaSelectorHandlesVisible(ui._areaSelector, true);

        if (this._canvas) {
            this._canvas.destroy();
            this._canvas = null;
        }

        if (this._toolbar) {
            this._toolbar.destroy();
            this._toolbar = null;
        }

        this._colorButtons = [];
        this._toolButtons = [];
        this._undoBtn = null;
        this._clearBtn = null;
        this._selectedTool = Tool.SELECT;
    }
}
