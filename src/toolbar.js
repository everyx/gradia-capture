import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import { TOOLS } from './tools.js';
import { attachTooltip } from './tooltip.js';
import { PopupMenu } from './popupMenu.js';

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
const BLUR_LINE_WIDTH_MAX = 64;

export const ColorMenu = GObject.registerClass({
    Signals: {
        'color-picked': { param_types: [GObject.TYPE_STRING] },
    },
}, class ColorMenu extends PopupMenu {
    _init(params = {}) {
        const { extensionPath = '', ...rest } = params;
        this._extensionPath = extensionPath;
        this._selectedHex = null;

        super._init('gradia-color-menu', rest);
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
            style_class: 'screenshot-ui-type-button gradia-option-button',
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
});

const BLUR_MODES = ['brush', 'selection'];

export const BlurMenu = GObject.registerClass({
    Signals: {
        'mode-changed': { param_types: [GObject.TYPE_STRING] },
        'block-size-changed': { param_types: [GObject.TYPE_INT] },
    },
}, class BlurMenu extends PopupMenu {
    _init(params = {}) {
        const { extensionPath = '', ...rest } = params;
        this._extensionPath = extensionPath;
        this._selectedMode = 'brush';
        this._selectedSize = 16;

        super._init('gradia-blur-menu', rest);
    }

    setMode(mode) {
        this._selectedMode = mode;
        for (const btn of this._modeBtns || [])
            btn.checked = btn._mode === mode;
    }

    setBlockSize(size) {
        this._selectedSize = size;
        if (this._sizeSlider) {
            const min = 4, max = 32;
            this._sizeSlider.value = (size - min) / (max - min);
        }
    }

    show() {
        this.destroy_all_children();
        this._buildContent();
        super.show();
        this.setMode(this._selectedMode);
        this.setBlockSize(this._selectedSize);
    }

    _buildContent() {
        const min = 4, max = 32;

        this._modeBtns = [];
        const modeRow = new St.BoxLayout({ style: 'spacing: 2px;' });

        for (const mode of BLUR_MODES) {
            const child = mode === 'brush'
                ? new St.Widget({
                    style_class: 'gradia-swatch',
                    style: 'background-color: #ffffff;',
                })
                : new St.Icon({
                    gicon: Gio.Icon.new_for_string(`${this._extensionPath}/icons/selection-opaque-3-symbolic.svg`),
                    style: 'icon-size: 16px;',
                });

            const btn = new St.Button({
                style_class: 'screenshot-ui-type-button gradia-option-button',
                style: 'border-color: transparent;',
                y_align: Clutter.ActorAlign.CENTER,
                layout_manager: new Clutter.BinLayout(),
                toggle_mode: true,
                reactive: true,
                child,
            });
            btn._mode = mode;
            btn.connect('clicked', () => {
                this.setMode(mode);
                this.emit('mode-changed', mode);
            });
            this._modeBtns.push(btn);
            modeRow.add_child(btn);
            attachTooltip(btn, mode === 'brush' ? '画笔' : '选区');
        }
        this.add_child(modeRow);

        this._sizeSlider = new Slider((this._selectedSize - min) / (max - min));
        this._sizeSlider.style = 'width: 60px;';
        this._sizeSlider.y_align = Clutter.ActorAlign.CENTER;
        this._sizeSlider.connect('notify::value', () => {
            const size = min + Math.round(this._sizeSlider.value * (max - min) / 2) * 2;
            this.setBlockSize(size);
            this.emit('block-size-changed', size);
        });
        this.add_child(this._sizeSlider);
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
        'blur-mode-changed': { param_types: [GObject.TYPE_STRING] },
        'block-size-changed': { param_types: [GObject.TYPE_INT] },
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
        this._blurMode = 'brush';
        this._blurBlockSize = 16;
        this._toolButtons = [];
        this._blurToolBtn = null;
        this._toolEntries = new Map();
        this._popupStagePressIds = new Map();

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
        this._buildBlurMenu();

        this._restoreToolEntry(this._selectedTool);
        this._updateDrawingControlsSensitivity();

        this.connect('notify::visible', () => {
            if (!this.visible) {
                this._hidePopup(this._colorMenu);
                this._hidePopup(this._blurMenu);
            }
        });
        this.connect('destroy', () => this._onDestroy());
    }

    _onDestroy() {
        for (const [popup] of this._popupStagePressIds)
            this._hidePopup(popup);
        if (this._colorPickerId && this._colorMenu) {
            this._colorMenu.disconnect(this._colorPickerId);
            this._colorPickerId = 0;
            this._colorMenu.destroy();
        }
        this._colorMenu = null;
        if (this._blurMenu) {
            this._blurMenu.destroy();
            this._blurMenu = null;
        }
    }

    _buildBlurMenu() {
        this._blurMenu = new BlurMenu({ extensionPath: this._extensionPath });
        this._blurMenu.connect('mode-changed', (_m, mode) => {
            this._blurMode = mode;
            this.emit('blur-mode-changed', mode);
            this._saveCurrentToolEntry();
            this._updateDrawingControlsSensitivity();
        });
        this._blurMenu.connect('block-size-changed', (_m, size) => {
            this._blurBlockSize = size;
            this.emit('block-size-changed', size);
            this._saveCurrentToolEntry();
        });
        if (this._primaryBin)
            this._primaryBin.add_child(this._blurMenu);
    }

    _showPopup(popup, triggerBtn) {
        popup.opacity = 0;
        popup.show();
        popup.reposition({ triggerBtn, toolbar: this, ...this._lastReposition });
        popup.opacity = 255;
        const cb = popup.connect('notify::allocation', () => {
            popup.disconnect(cb);
            popup.reposition({ triggerBtn, toolbar: this, ...this._lastReposition });
        });
        this._popupStagePressIds.set(popup,
            global.stage.connect('button-press-event', (stage, event) => {
                const target = event.get_source();
                if (target && (popup.contains(target) || triggerBtn?.contains(target)))
                    return Clutter.EVENT_PROPAGATE;
                this._hidePopup(popup);
                return Clutter.EVENT_STOP;
            })
        );
    }

    _hidePopup(popup) {
        const id = this._popupStagePressIds.get(popup);
        if (id !== undefined) {
            global.stage.disconnect(id);
            this._popupStagePressIds.delete(popup);
        }
        popup.hide();
    }

    _togglePopup(popup, triggerBtn) {
        if (popup.visible)
            this._hidePopup(popup);
        else
            this._showPopup(popup, triggerBtn);
    }

    _repositionPopup(popup, triggerBtn) {
        if (!popup?.visible || !this._lastReposition)
            return;
        popup.reposition({ triggerBtn, toolbar: this, ...this._lastReposition });
    }

    _currentToolIsDrawing() {
        return TOOLS.find(t => t.id === this._selectedTool)?.isDrawing ?? false;
    }

    _updateDrawingControlsSensitivity() {
        const drawing = this._currentToolIsDrawing();
        const hasSelection = this._hasSelection?.() ?? false;
        const enabled = drawing || hasSelection;
        const isBlur = this._selectedTool === 'blur';
        const isBlurSelection = isBlur && this._blurMode === 'selection';

        this._colorButton.reactive = enabled && !isBlur;
        this._colorButton.opacity = enabled && !isBlur ? 255 : 80;
        this._slider.reactive = enabled && !isBlurSelection;
        this._slider.opacity = enabled && !isBlurSelection ? 255 : 80;

        if (!enabled)
            this._hidePopup(this._colorMenu);
    }

    _saveCurrentToolEntry() {
        this._settings?.saveToolEntry(this._selectedTool, this._selectedColor, this._lineWidth);
        this._toolEntries?.set(this._selectedTool, {
            blurMode: this._blurMode,
            blockSize: this._blurBlockSize,
        });
    }

    _restoreToolEntry(toolId) {
        if (!this._settings) return;
        const { color, lineWidth } = this._settings.getToolEntry(toolId, this._selectedColor, this._lineWidth);
        this._applyColor(color);
        this._applyLineWidth(lineWidth);

        if (toolId === 'blur') {
            const blurState = this._toolEntries?.get(toolId);
            if (blurState) {
                this._blurMode = blurState.blurMode ?? 'brush';
                this._blurBlockSize = blurState.blockSize ?? 16;
            }
            if (this._blurMenu) {
                this._blurMenu.setMode(this._blurMode);
                this._blurMenu.setBlockSize(this._blurBlockSize);
            }
        }
    }

    _lineWidthMax() {
        return this._selectedTool === 'blur' ? BLUR_LINE_WIDTH_MAX : LINE_WIDTH_MAX;
    }

    _sliderValueToWidth(v) {
        return Math.round(LINE_WIDTH_MIN + v * (this._lineWidthMax() - LINE_WIDTH_MIN));
    }

    _widthToSliderValue(w) {
        return (w - LINE_WIDTH_MIN) / (this._lineWidthMax() - LINE_WIDTH_MIN);
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
        this._updatingSlider = true;
        this._slider.value = this._widthToSliderValue(width);
        this._updatingSlider = false;
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

            if (tool.id === 'blur')
                this._blurToolBtn = btn;

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

        button.connect('clicked', () => this._togglePopup(this._colorMenu, this._colorButton));

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
            this._hidePopup(this._colorMenu);
        });
        if (this._primaryBin)
            this._primaryBin.add_child(this._colorMenu);
    }

    _buildLineWidthSlider() {
        this._slider = new Slider((this._lineWidth - LINE_WIDTH_MIN) / (LINE_WIDTH_MAX - LINE_WIDTH_MIN));
        this._slider.style = 'width: 80px;';
        this._slider.y_align = Clutter.ActorAlign.CENTER;
        this._slider.connect('notify::value', () => {
            if (this._updatingSlider) return;
            this._lineWidth = this._sliderValueToWidth(this._slider.value);
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

        const wasBlur = this._selectedTool === 'blur';

        this._hidePopup(this._colorMenu);
        this._saveCurrentToolEntry();
        this._selectedTool = id;
        for (const btn of this._toolButtons)
            btn.checked = (btn._toolId === id);
        this.emit('tool-changed', id);
        this._restoreToolEntry(id);
        this._updateDrawingControlsSensitivity();

        if (id === 'blur') {
            if (wasBlur)
                this._togglePopup(this._blurMenu, this._blurToolBtn);
            else
                this._showPopup(this._blurMenu, this._blurToolBtn);
        } else {
            this._hidePopup(this._blurMenu);
        }
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
        const step = 1 / (this._lineWidthMax() - LINE_WIDTH_MIN);
        if (direction === Clutter.ScrollDirection.UP)
            this._slider.value = Math.min(1, this._slider.value + step);
        else if (direction === Clutter.ScrollDirection.DOWN)
            this._slider.value = Math.max(0, this._slider.value - step);
    }

    hideColorMenu() {
        this._hidePopup(this._colorMenu);
    }

    reposition({ selectionRect, monitorRect, primaryBin }) {
        this._primaryBin = primaryBin ?? this._primaryBin;
        if (this._colorMenu && this._primaryBin && !this._colorMenu.get_parent())
            this._primaryBin.add_child(this._colorMenu);
        if (this._blurMenu && this._primaryBin && !this._blurMenu.get_parent())
            this._primaryBin.add_child(this._blurMenu);

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
            this._repositionPopup(this._colorMenu, this._colorButton);
        if (this._blurMenu?.visible)
            this._repositionPopup(this._blurMenu, this._blurToolBtn);
    }

    get selectedTool() { return this._selectedTool; }
    get selectedColor() { return this._selectedColor; }
    get lineWidth() { return this._lineWidth; }
});
