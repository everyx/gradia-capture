import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import { TOOLS } from './tools.js';
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

export const ColorMenu = GObject.registerClass({
    Signals: {
        'color-picked': { param_types: [GObject.TYPE_STRING] },
    },
}, class ColorMenu extends St.BoxLayout {
    _init(params = {}) {
        const { extensionPath = '', ...rest } = params;
        this._extensionPath = extensionPath;
        this._selectedHex = null;

        super._init({
            style_class: 'screenshot-ui-panel gradia-color-menu',
            x_expand: false,
            y_expand: false,
            reactive: true,
            visible: false,
            ...rest,
        });
    }

    setSelectedHex(hex) {
        this._selectedHex = hex;
        for (const btn of this.get_children()) {
            if (btn._colorHex !== undefined)
                btn.style = `border-color: ${btn._colorHex === hex ? hex : 'transparent'};`;
        }
    }

    show() {
        this.destroy_all_children();
        for (const color of COLORS)
            this._addSwatch(color.hex, color.name);
        super.show();
        this.setSelectedHex(this._selectedHex);
    }

    _addSwatch(hex, name) {
        const ring = new St.Button({
            style_class: 'gradia-ring-button',
            style: `border-color: transparent;`,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        const swatch = new St.Widget({
            style_class: 'gradia-swatch',
            style: `background-color: ${hex};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        ring._colorHex = hex;
        ring.add_child(swatch);
        ring.connect('clicked', () => this.emit('color-picked', hex));
        this.add_child(ring);
        attachTooltip(ring, name);
    }

    reposition(ctx) {
        if (!this.visible)
            return;
        const { colorButton, toolbar, selectionRect, monitorRect, primaryBin } = ctx;
        if (!primaryBin || !colorButton || !toolbar)
            return;

        const [cbSX, cbSY] = colorButton.get_transformed_position();
        const [tbSX, tbSY] = toolbar.get_transformed_position();
        const [, tbH] = toolbar.get_size();
        if (cbSX == null || tbSX == null)
            return;

        const [, menuW] = this.get_preferred_width(-1);
        const [, menuH] = this.get_preferred_height(menuW);
        if (menuW <= 0 || menuH <= 0)
            return;

        const [okC, localCbX, localTbTop] = primaryBin.transform_stage_point(cbSX, tbSY);
        if (!okC) return;
        const localTbBottom = localTbTop + tbH;

        const [okL, localMonLeft, localMonTop] = primaryBin.transform_stage_point(
            monitorRect.x, monitorRect.y);
        const [okB, _bx, localMonBottom] = primaryBin.transform_stage_point(
            monitorRect.x, monitorRect.y + monitorRect.height);
        const [okR, localMonRight] = primaryBin.transform_stage_point(
            monitorRect.x + monitorRect.width, monitorRect.y);
        if (!okL || !okB || !okR)
            return;

        let menuX = localCbX;
        if (menuX + menuW > localMonRight)
            menuX = localMonRight - menuW;
        if (menuX < localMonLeft)
            menuX = localMonLeft;
        menuX = Math.round(menuX);

        const toolbarTop = localTbTop;
        const toolbarBottom = localTbBottom;

        let preferAbove = true;
        if (selectionRect) {
            const [okS, _sx, localSelTop] = primaryBin.transform_stage_point(
                selectionRect.x, selectionRect.y);
            const [okS2, _sx2, localSelBottom] = primaryBin.transform_stage_point(
                selectionRect.x, selectionRect.y + selectionRect.height);
            if (okS && okS2) {
                if (toolbarBottom <= localSelTop)
                    preferAbove = true;
                else if (toolbarTop >= localSelBottom)
                    preferAbove = false;
                else {
                    const spaceAbove = toolbarTop - localMonTop;
                    const spaceBelow = localMonBottom - toolbarBottom;
                    preferAbove = spaceAbove >= spaceBelow;
                }
            }
        }

        const yAbove = toolbarTop - menuH;
        const yBelow = toolbarBottom;
        const candidates = preferAbove ? [yAbove, yBelow] : [yBelow, yAbove];

        let menuY = null;
        for (const y of candidates) {
            if (y >= localMonTop && y + menuH <= localMonBottom) {
                menuY = y;
                break;
            }
        }
        if (menuY === null)
            menuY = Math.max(localMonTop, Math.min(preferAbove ? yAbove : yBelow, localMonBottom - menuH));
        menuY = Math.round(menuY);

        this.set_position(menuX, menuY);
    }
});

export const Toolbar = GObject.registerClass({
    Signals: {
        'tool-changed': { param_types: [GObject.TYPE_STRING] },
        'color-changed': { param_types: [GObject.TYPE_STRING] },
        'line-width-changed': { param_types: [GObject.TYPE_DOUBLE] },
        'undo': {},
        'clear': {},
        'ocr-trigger': {},
        'ocr-clear': {},
    },
}, class Toolbar extends St.BoxLayout {
    _init(params = {}) {
        const { extensionPath = '', gradiaSettings = null, primaryBin = null, ...rest } = params;
        this._extensionPath = extensionPath;
        this._settings = gradiaSettings;
        this._primaryBin = primaryBin;
        this._lastReposition = null;

        super._init({
            style_class: 'screenshot-ui-panel gradia-toolbar',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            x_expand: false,
            y_expand: false,
            reactive: true,
            ...rest,
        });

        this._selectedColor = COLORS[1].hex;
        this._selectedTool = TOOLS[0].id;
        this._lineWidth = 4;
        this._toolButtons = [];
        this._stagePressId = 0;

        this._buildToolButtons();
        this._addSeparator();
        this._buildColorButton();
        this._addSeparator();
        this._buildLineWidthSlider();
        this._addSeparator();
        this._buildActionButtons();
        this._addSeparator();
        this._buildOcrButton();

        this._buildColorMenu();

        this._restoreToolEntry(this._selectedTool);
        this._updateDrawingControlsSensitivity();

        this.connect('notify::visible', () => {
            if (!this.visible)
                this._hideColorMenu();
        });
        this.connect('destroy', () => this._onDestroy());
    }

    _onDestroy() {
        this._disconnectStagePress();
        if (this._colorPickerId && this._colorMenu) {
            this._colorMenu.disconnect(this._colorPickerId);
            this._colorPickerId = 0;
            this._colorMenu.destroy();
        }
        this._colorMenu = null;
    }

    _currentToolIsDrawing() {
        return TOOLS.find(t => t.id === this._selectedTool)?.isDrawing ?? false;
    }

    _updateDrawingControlsSensitivity() {
        const drawing = this._currentToolIsDrawing();
        const hasSelection = this._hasSelection?.() ?? false;
        const enabled = drawing || hasSelection;

        this._colorButton.reactive = enabled;
        this._colorButton.opacity = enabled ? 255 : 80;
        this._slider.reactive = enabled;
        this._slider.opacity = enabled ? 255 : 80;

        if (!enabled)
            this._hideColorMenu();
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
        if (this._colorSwatch)
            this._colorSwatch.style = `background-color: ${hex};`;
        if (this._colorMenu)
            this._colorMenu.setSelectedHex(hex);
        this.emit('color-changed', hex);
    }

    _applyLineWidth(width) {
        this._lineWidth = width;
        this._slider.value = (width - LINE_WIDTH_MIN) / (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
        this.emit('line-width-changed', width);
    }

    _syncToStroke(stroke) {
        this._applyColor(stroke.color);
        this._applyLineWidth(stroke.strokeWidth);
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

            btn._tooltip = attachTooltip(btn, tool.name);

            if (i === 1)
                this._addSeparator();
        }
    }

    _buildColorButton() {
        const button = new St.Button({
            style_class: 'screenshot-ui-type-button gradia-square-button gradia-color-trigger-button',
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        const content = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 4px;',
        });

        const swatch = new St.Widget({
            style_class: 'gradia-swatch gradia-color-trigger-swatch',
            style: `background-color: ${this._selectedColor};`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const caret = new St.Icon({
            icon_name: 'pan-down-symbolic',
            style_class: 'gradia-color-trigger-caret',
        });

        content.add_child(swatch);
        content.add_child(caret);
        button.add_child(content);

        button.connect('clicked', () => this._toggleColorMenu());

        this.add_child(button);
        this._colorButton = button;
        this._colorSwatch = swatch;
        attachTooltip(button, 'Color');
    }

    _buildColorMenu() {
        this._colorMenu = new ColorMenu({
            extensionPath: this._extensionPath,
        });
        this._colorPickerId = this._colorMenu.connect('color-picked', (_m, hex) => {
            this._applyColor(hex);
            this._saveCurrentToolEntry();
            this._hideColorMenu();
        });
        if (this._primaryBin)
            this._primaryBin.add_child(this._colorMenu);
    }

    _repositionColorMenu() {
        if (!this._colorMenu?.visible || !this._lastReposition)
            return;
        this._colorMenu.reposition({
            colorButton: this._colorButton,
            toolbar: this,
            selectionRect: this._lastReposition.selectionRect,
            monitorRect: this._lastReposition.monitorRect,
            primaryBin: this._lastReposition.primaryBin,
        });
    }

    _toggleColorMenu() {
        if (this._colorMenu.visible)
            this._hideColorMenu();
        else
            this._showColorMenu();
    }

    _showColorMenu() {
        this._colorMenu.show();
        this._repositionColorMenu();
        if (this._stagePressId === 0) {
            this._stagePressId = global.stage.connect('button-press-event', (stage, event) => {
                const target = event.get_source();
                if (target && (this._colorMenu.contains(target) || this._colorButton.contains(target)))
                    return Clutter.EVENT_PROPAGATE;
                this._hideColorMenu();
                return Clutter.EVENT_STOP;
            });
        }
    }

    _disconnectStagePress() {
        if (this._stagePressId !== 0) {
            global.stage.disconnect(this._stagePressId);
            this._stagePressId = 0;
        }
    }

    _hideColorMenu() {
        this._disconnectStagePress();
        if (this._colorMenu)
            this._colorMenu.hide();
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

    setOcrProcessing() {
        this._ocrDone = false;
        this._ocrButton.reactive = false;
        if (this._ocrIcon)
            this._ocrButton.set_child(this._ocrIcon);
        this._ocrButton.remove_all_transitions();
        this._ocrButton.ease_property('opacity', 128, {
            duration: 500,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            repeat_count: -1,
            auto_reverse: true,
        });
    }

    setOcrDone() {
        this._ocrDone = true;
        this._ocrButton.remove_all_transitions();
        this._ocrButton.opacity = 255;
        this._ocrButton.reactive = true;
        this._ocrButton.add_style_pseudo_class('checked');
        if (this._ocrIcon)
            this._ocrButton.set_child(this._ocrIcon);
    }

    setOcrIdle() {
        this._ocrDone = false;
        this._ocrButton.remove_all_transitions();
        this._ocrButton.opacity = 255;
        this._ocrButton.reactive = true;
        this._ocrButton.remove_style_pseudo_class('checked');
        if (this._ocrIcon)
            this._ocrButton.set_child(this._ocrIcon);
    }

    _updateUndoClearSensitivity() {
        const visible = this._hasVisibleCanvas?.() ?? true;
        this._undoBtn.reactive = visible;
        this._undoBtn.opacity = visible ? 255 : 80;
        this._clearBtn.reactive = visible;
        this._clearBtn.opacity = visible ? 255 : 80;
    }

    _buildOcrButton() {
        const btn = new St.Button({
            child: makeIcon('scanner-symbolic', this._extensionPath),
            style_class: 'screenshot-ui-type-button gradia-square-button',
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.connect('clicked', () => this.emit('ocr-trigger'));
        this.add_child(btn);
        this._ocrButton = btn;
        this._ocrIcon = btn.get_child();
        attachTooltip(btn, 'Text Recognition');
        this._ocrDone = false;
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
        const btn = this._toolButtons.find(b => b._toolId === id);
        if (btn && !btn.reactive)
            return;

        this._hideColorMenu();
        this._saveCurrentToolEntry();
        this._selectedTool = id;
        for (const btn of this._toolButtons)
            btn.checked = (btn._toolId === id);
        this.emit('tool-changed', id);
        this._restoreToolEntry(id);
        this._updateDrawingControlsSensitivity();
    }

    _clearToolSelection() {
        for (const btn of this._toolButtons)
            btn.checked = false;
        this._updateDrawingControlsSensitivity();
    }

    setSelectionToolVisible(enabled) {
        const btn = this._toolButtons.find(b => b._toolId === 'select');
        const iconName = enabled ? 'icons/selection-opaque-3-symbolic.svg' : 'icons/display-symbolic.svg';
        btn.get_child().gicon = Gio.Icon.new_for_string(`${this._extensionPath}/${iconName}`);
        btn._tooltip.text = enabled ? 'Crop' : 'Pick Display';
    }

    scrollLineWidth(direction) {
        if (!this._slider.reactive)
            return;
        const step = 1 / (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
        if (direction === Clutter.ScrollDirection.UP)
            this._slider.value = Math.min(1, this._slider.value + step);
        else if (direction === Clutter.ScrollDirection.DOWN)
            this._slider.value = Math.max(0, this._slider.value - step);
    }

    hideColorMenu() {
        this._hideColorMenu();
    }

    reposition({ selectionRect, monitorRect, primaryBin }) {
        this._primaryBin = primaryBin ?? this._primaryBin;
        if (this._colorMenu && this._primaryBin && !this._colorMenu.get_parent())
            this._primaryBin.add_child(this._colorMenu);

        const [, natW] = this.get_preferred_width(-1);
        const natH = this.get_preferred_height(-1)[1];
        if (natW <= 0 || natH <= 0)
            return;

        const [ok, localMonCX] = primaryBin.transform_stage_point(
            monitorRect.x + monitorRect.width / 2, monitorRect.y);
        if (!ok) return;

        let targetX;
        let targetY;

        if (selectionRect) {
            const selTop = selectionRect.y;
            const selHeight = selectionRect.height;
            const selRight = selectionRect.x + selectionRect.width;
            const [ok2, _sx1, localSelTop] = primaryBin.transform_stage_point(
                selectionRect.x, selTop);
            if (!ok2) return;

            const [ok3, _sx2, localSelBottom] = primaryBin.transform_stage_point(
                selectionRect.x, selTop + selHeight);
            if (!ok3) return;

            const [ok5, localSelRightX] = primaryBin.transform_stage_point(
                selRight, selTop);
            if (!ok5) return;

            const monBottomY = monitorRect.y + monitorRect.height;
            const [ok4, _sx3, localMonBottom] = primaryBin.transform_stage_point(
                monitorRect.x, monBottomY);
            if (!ok4) return;

            const [okMonRight, localMonRight] = primaryBin.transform_stage_point(
                monitorRect.x + monitorRect.width, monitorRect.y);
            if (!okMonRight) return;

            const yAbove = Math.round(localSelTop - natH);
            const yBelow = Math.round(localSelBottom);
            const spaceAbove = Math.round(localSelTop);
            const spaceBelow = Math.round(localMonBottom - localSelBottom);

            if (spaceAbove >= natH) {
                targetY = yAbove;
            } else if (spaceBelow >= natH) {
                targetY = yBelow;
            } else {
                targetY = 0;
            }

            targetX = Math.round(localSelRightX - natW);
            targetX = Math.max(0, Math.min(targetX, Math.round(localMonRight - natW)));
        } else {
            targetX = Math.round(localMonCX - natW / 2);
            targetY = 0;
        }

        this.set_position(targetX, targetY);

        this._lastReposition = {
            selectionRect,
            monitorRect,
            primaryBin,
        };
        if (this._colorMenu?.visible)
            this._repositionColorMenu();
    }

    get selectedTool() { return this._selectedTool; }
    get selectedColor() { return this._selectedColor; }
    get lineWidth() { return this._lineWidth; }
});
