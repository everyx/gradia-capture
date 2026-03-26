import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Tool, setAreaSelectorHandlesVisible } from './extension.js';

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

export const Toolbar = GObject.registerClass({
    Signals: {
        'tool-changed': { param_types: [GObject.TYPE_INT] },
        'color-changed': { param_types: [GObject.TYPE_STRING] },
        'undo': {},
        'clear': {},
    },
}, class Toolbar extends St.BoxLayout {
    _init(params = {}) {
        super._init({
            style_class: 'screenshot-ui-panel gradia-toolbar',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            y_expand: true,
            reactive: true,
            ...params,
        });

        this._selectedColor = COLORS[1].hex;
        this._selectedTool = Tool.SELECT;
        this._colorButtons = [];
        this._toolButtons = [];

        this._buildToolButtons();
        this._addSeparator();
        this._buildColorButtons();
        this._addSeparator();
        this._buildActionButtons();
    }

    _buildToolButtons() {
        const toolDefs = [
            { tool: Tool.SELECT, icon: 'screenshot-ui-area-symbolic' },
            { tool: Tool.FREEHAND, icon: 'document-edit-symbolic' },
            { tool: Tool.RECTANGLE, icon: 'checkbox-symbolic' },
            { tool: Tool.ARROW, icon: 'go-up-symbolic' },
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
            btn.connect('clicked', () => this._onToolClicked(def.tool));
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

    _buildActionButtons() {
        this._undoBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'edit-undo-symbolic',
                style: 'icon-size: 16px;',
            }),
            style_class: 'screenshot-ui-type-button gradia-square-button',
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._undoBtn.connect('clicked', () => this.emit('undo'));
        this.add_child(this._undoBtn);

        this._clearBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'user-trash-symbolic',
                style: 'icon-size: 16px;',
            }),
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

    _onToolClicked(tool) {
        this._selectedTool = tool;
        for (const btn of this._toolButtons)
            btn.checked = (btn._tool === tool);
        this.emit('tool-changed', tool);
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
});
