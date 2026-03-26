import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

const COLORS = [
    { name: 'White', hex: '#ffffff' },
    { name: 'Black', hex: '#000000' },
    { name: 'Red', hex: '#ff4444' },
    { name: 'Orange', hex: '#ff8800' },
    { name: 'Yellow', hex: '#ffdd00' },
    { name: 'Green', hex: '#44cc44' },
    { name: 'Blue', hex: '#4488ff' },
    { name: 'Purple', hex: '#aa44ff' },
];

function hexToRgb(hex) {
    return {
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255,
    };
}

function makeIcon(spec, extensionPath = '') {
    if (spec.startsWith('/') || spec.startsWith('icons/')) {
        const fullPath = spec.startsWith('/') ? spec : `${extensionPath}/${spec}`;
        return new St.Icon({
            gicon: Gio.Icon.new_for_string(fullPath),
            style: 'icon-size: 16px;',
        });
    }
    return new St.Icon({
        icon_name: spec,
        style: 'icon-size: 16px;',
    });
}

export const TOOLS = [
    {
        id: 'select',
        name: 'Select',
        icon: 'icons/selection-opaque-3-symbolic.svg',
        isDrawing: false,
        render: null,
        beginStroke: null,
    },
    {
        id: 'freehand',
        name: 'Freehand',
        icon: 'document-edit-symbolic',
        isDrawing: true,
        beginStroke: () => ({ points: [] }),
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 2)
                return;
            const { r, g, b } = hexToRgb(stroke.color);
            cr.setSourceRGBA(r, g, b, 1.0);
            cr.setLineWidth(lineWidth);
            const pts = stroke.points;
            cr.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++)
                cr.lineTo(pts[i].x, pts[i].y);
            cr.stroke();
        },
    },
    {
        id: 'rectangle',
        name: 'Rectangle',
        icon: 'icons/square-outline-thick-symbolic.svg',
        isDrawing: true,
        beginStroke: () => ({ points: [] }),
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 2)
                return;
            const { r, g, b } = hexToRgb(stroke.color);
            cr.setSourceRGBA(r, g, b, 1.0);
            cr.setLineWidth(lineWidth);
            const pts = stroke.points;
            const p0 = pts[0];
            const p1 = pts[pts.length - 1];
            cr.rectangle(
                Math.min(p0.x, p1.x),
                Math.min(p0.y, p1.y),
                Math.abs(p1.x - p0.x),
                Math.abs(p1.y - p0.y)
            );
            cr.stroke();
        },
    },
    {
        id: 'solid-rectangle',
        name: 'Solid Rectangle',
        icon: 'icons/square-filled-symbolic.svg',
        isDrawing: true,
        beginStroke: () => ({ points: [] }),
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 2)
                return;
            const { r, g, b } = hexToRgb(stroke.color);
            cr.setSourceRGBA(r, g, b, 1.0);
            const pts = stroke.points;
            const p0 = pts[0];
            const p1 = pts[pts.length - 1];
            cr.rectangle(
                Math.min(p0.x, p1.x),
                Math.min(p0.y, p1.y),
                Math.abs(p1.x - p0.x),
                Math.abs(p1.y - p0.y)
            );
            cr.fill();
        },
    },
    {
        id: 'highlighter',
        name: 'Highlighter',
        icon: 'icons/marker-symbolic.svg',
        isDrawing: true,
        beginStroke: () => ({ points: [] }),
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 2)
                return;
            const { r, g, b } = hexToRgb(stroke.color);
            cr.setSourceRGBA(r, g, b, 0.4);
            cr.setLineWidth(lineWidth * 4);
            cr.setLineCap(Cairo.LineCap.SQUARE);
            const pts = stroke.points;
            cr.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++)
                cr.lineTo(pts[i].x, pts[i].y);
            cr.stroke();
        },
    },
    {
        id: 'arrow',
        name: 'Arrow',
        icon: 'icons/arrow1-top-right-symbolic.svg',
        isDrawing: true,
        beginStroke: () => ({ points: [] }),
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 2)
                return;
            const { r, g, b } = hexToRgb(stroke.color);
            cr.setSourceRGBA(r, g, b, 1.0);
            cr.setLineWidth(lineWidth);
            const pts = stroke.points;
            const p0 = pts[0];
            const p1 = pts[pts.length - 1];
            cr.moveTo(p0.x, p0.y);
            cr.lineTo(p1.x, p1.y);
            cr.stroke();

            const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
            const spread = Math.PI / 7;
            const size = lineWidth * 5;
            cr.moveTo(p1.x, p1.y);
            cr.lineTo(p1.x - size * Math.cos(angle - spread), p1.y - size * Math.sin(angle - spread));
            cr.moveTo(p1.x, p1.y);
            cr.lineTo(p1.x - size * Math.cos(angle + spread), p1.y - size * Math.sin(angle + spread));
            cr.stroke();
        },
    },
    {
        id: 'stamp',
        name: 'Number Stamp',
        icon: 'icons/one-circle-symbolic.svg',
        isDrawing: true,
        isStamp: true,
        beginStroke: () => ({ points: [], counter: 1 }),
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 1)
                return;

            const pt = stroke.points[0];
            const radius = lineWidth * 5;
            const rgb = hexToRgb(stroke.color);
            const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
            const textColor = lum > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 1, g: 1, b: 1 };

            cr.setSourceRGBA(rgb.r, rgb.g, rgb.b, 1.0);
            cr.arc(pt.x, pt.y, radius, 0, 2 * Math.PI);
            cr.fill();

            const label = String(stroke.counter ?? 1);
            const fontSize = Math.round(radius * 1.2);

            const layout = PangoCairo.create_layout(cr);
            const desc = Pango.font_description_from_string(`Sans Bold ${fontSize}px`);
            layout.set_font_description(desc);
            layout.set_text(label, -1);

            const [, extents] = layout.get_pixel_extents();
            const tx = pt.x - extents.width / 2 - extents.x;
            const ty = pt.y - extents.height / 2 - extents.y;

            cr.setSourceRGBA(textColor.r, textColor.g, textColor.b, 1.0);
            cr.moveTo(tx, ty);
            PangoCairo.show_layout(cr, layout);
        },
    },
];

const LINE_WIDTH_MIN = 1;
const LINE_WIDTH_MAX = 16;

export const Toolbar = GObject.registerClass({
    Signals: {
        'tool-changed': { param_types: [GObject.TYPE_STRING] },
        'color-changed': { param_types: [GObject.TYPE_STRING] },
        'line-width-changed': { param_types: [GObject.TYPE_DOUBLE] },
        'undo': {},
        'clear': {},
    },
}, class Toolbar extends St.BoxLayout {
    _init(params = {}) {
        const { extensionPath = '', ...rest } = params;
        this._extensionPath = extensionPath;

        super._init({
            style_class: 'screenshot-ui-panel gradia-toolbar',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            y_expand: true,
            reactive: true,
            ...rest,
        });

        this._selectedColor = COLORS[1].hex;
        this._selectedTool = TOOLS[0].id;
        this._lineWidth = 4;
        this._colorButtons = [];
        this._toolButtons = [];

        this._buildToolButtons();
        this._addSeparator();
        this._buildColorButtons();
        this._addSeparator();
        this._buildLineWidthSlider();
        this._addSeparator();
        this._buildActionButtons();
    }

    _buildToolButtons() {
        for (const tool of TOOLS) {
            const btn = new St.Button({
                child: makeIcon(tool.icon, this._extensionPath),
                style_class: 'screenshot-ui-type-button gradia-square-button',
                toggle_mode: true,
                checked: tool.id === this._selectedTool,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn._toolId = tool.id;
            btn.connect('clicked', () => this._onToolClicked(tool.id));
            this.add_child(btn);
            this._toolButtons.push(btn);
        }
    }

    _buildColorButtons() {
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

            btn.connect('clicked', () => this._onColorClicked(color.hex));
            this.add_child(btn);
            this._colorButtons.push(btn);
        }
    }

    _buildLineWidthSlider() {
        const sliderValue = (this._lineWidth - LINE_WIDTH_MIN) / (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
        this._slider = new Slider(sliderValue);
        this._slider.style = 'width: 80px;';
        this._slider.y_align = Clutter.ActorAlign.CENTER;
        this._slider.connect('notify::value', () => {
            this._lineWidth = LINE_WIDTH_MIN + this._slider.value * (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
            this.emit('line-width-changed', this._lineWidth);
        });
        this.add_child(this._slider);
    }

    _buildActionButtons() {
        this._undoBtn = new St.Button({
            child: makeIcon('edit-undo-symbolic', this._extensionPath),
            style_class: 'screenshot-ui-type-button gradia-square-button',
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._undoBtn.connect('clicked', () => this.emit('undo'));
        this.add_child(this._undoBtn);

        this._clearBtn = new St.Button({
            child: makeIcon('user-trash-symbolic', this._extensionPath),
            style_class: 'screenshot-ui-type-button gradia-square-button',
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clearBtn.connect('clicked', () => this.emit('clear'));
        this.add_child(this._clearBtn);
    }

    _addSeparator() {
        this.add_child(new St.Widget({
            style_class: 'gradia-separator',
            y_expand: true,
        }));
    }

    _onToolClicked(id) {
        this._selectedTool = id;
        for (const btn of this._toolButtons)
            btn.checked = (btn._toolId === id);
        this.emit('tool-changed', id);
    }

    _onColorClicked(hex) {
        this._selectedColor = hex;
        for (const btn of this._colorButtons) {
            const isSelected = btn._colorHex === hex;
            btn.checked = isSelected;
            btn.style = `background-color: ${btn._colorHex};`;
            if (btn._checkIcon)
                btn._checkIcon.visible = isSelected;
        }
        this.emit('color-changed', hex);
    }

    get selectedTool() { return this._selectedTool; }
    get selectedColor() { return this._selectedColor; }
    get lineWidth() { return this._lineWidth; }
});
