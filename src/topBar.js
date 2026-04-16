import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TOOLS, SELECTION_PADDING } from './tools.js';
import { attachTooltip } from './tooltip.js';

export const TRASH_BUTTON_RADIUS = 16;

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
        const { extensionPath = '', gradiaSettings = null, ...rest } = params;
        this._extensionPath = extensionPath;
        this._settings = gradiaSettings;

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

        this._restoreToolEntry(this._selectedTool);
        this._updateDrawingControlsSensitivity();
    }

    _currentToolIsDrawing() {
        return TOOLS.find(t => t.id === this._selectedTool)?.isDrawing ?? false;
    }

    _updateDrawingControlsSensitivity() {
        const drawing = this._currentToolIsDrawing();
        for (const btn of this._colorButtons) {
            btn.reactive = drawing;
            btn.opacity = drawing ? 255 : 80;
        }
        this._slider.reactive = drawing;
        this._slider.opacity = drawing ? 255 : 80;
    }

    _saveCurrentToolEntry() {
        this._settings?.saveToolEntry(this._selectedTool, this._selectedColor, this._lineWidth);
    }

    _restoreToolEntry(toolId) {
        if (!this._settings) return;
        const { color, lineWidth } = this._settings.getToolEntry(toolId, this._selectedColor, this._lineWidth);
        this._applyColor(color);
        this._applyLineWidth(lineWidth);
    }

    _applyColor(hex) {
        this._selectedColor = hex;
        for (const btn of this._colorButtons) {
            const isSelected = btn._colorHex === hex;
            btn.checked = isSelected;
            btn.style = `background-color: ${btn._colorHex};`;
            if (btn._checkIcon) btn._checkIcon.visible = isSelected;
        }
        this.emit('color-changed', hex);
    }

    _applyLineWidth(width) {
        this._lineWidth = width;
        this._slider.value = (width - LINE_WIDTH_MIN) / (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
        this.emit('line-width-changed', width);
    }

    _buildToolButtons() {
        for (let i = 0; i < TOOLS.length; i++) {
            const tool = TOOLS[i];
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

            attachTooltip(btn, tool.name);

            if (i === 1)
                this._addSeparator();
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

            attachTooltip(btn, color.name);
        }
    }

    _buildLineWidthSlider() {
        this._slider = new Slider((this._lineWidth - LINE_WIDTH_MIN) / (LINE_WIDTH_MAX - LINE_WIDTH_MIN));
        this._slider.style = 'width: 80px;';
        this._slider.y_align = Clutter.ActorAlign.CENTER;
        this._slider.connect('notify::value', () => {
            this._lineWidth = LINE_WIDTH_MIN + this._slider.value * (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
            this.emit('line-width-changed', this._lineWidth);
            this._saveCurrentToolEntry();
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

        attachTooltip(this._undoBtn, 'Undo');

        this._clearBtn = new St.Button({
            child: makeIcon('user-trash-symbolic', this._extensionPath),
            style_class: 'screenshot-ui-type-button gradia-square-button',
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clearBtn.connect('clicked', () => this.emit('clear'));
        this.add_child(this._clearBtn);

        attachTooltip(this._clearBtn, 'Clear all');
    }

    _addSeparator() {
        this.add_child(new St.Widget({ style_class: 'gradia-separator', y_expand: true }));
    }

    _onToolClicked(id) {
        this._saveCurrentToolEntry();
        this._selectedTool = id;
        for (const btn of this._toolButtons)
            btn.checked = (btn._toolId === id);
        this.emit('tool-changed', id);
        this._restoreToolEntry(id);
        this._updateDrawingControlsSensitivity();
    }

    _onColorClicked(hex) {
        this._applyColor(hex);
        this._saveCurrentToolEntry();
    }

    get selectedTool() { return this._selectedTool; }
    get selectedColor() { return this._selectedColor; }
    get lineWidth() { return this._lineWidth; }
});
