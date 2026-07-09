import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';

import { SquareSlider } from '../widgets/squareSlider.js';

import { attachTooltip } from '../../platform/tooltip.js';
import { PopupMenu } from './popupMenu.js';
import { N_ } from '../../platform/i18n.js';

export const SIZE_MIN = 1;
export const SIZE_MAX = 16;
export const BLUR_SIZE_MAX = 64;
export const BLOCK_SIZE_MIN = 4;
export const BLOCK_SIZE_MAX = 32;

const COLORS = [
    { name: N_('White'), hex: '#ffffff' },
    { name: N_('Black'), hex: '#000000' },
    { name: N_('Red'), hex: '#ff4444' },
    { name: N_('Orange'), hex: '#ff8800' },
    { name: N_('Yellow'), hex: '#ffdd00' },
    { name: N_('Green'), hex: '#44cc44' },
    { name: N_('Blue'), hex: '#4488ff' },
    { name: N_('Purple'), hex: '#aa44ff' },
];

const BLUR_MODES = ['brush', 'selection'];

export const ToolPropsMenu = GObject.registerClass(
    {
        Signals: {
            'color-changed': { param_types: [GObject.TYPE_STRING] },
            'size-changed': { param_types: [GObject.TYPE_INT] },
            'mode-changed': { param_types: [GObject.TYPE_STRING] },
            'block-size-changed': { param_types: [GObject.TYPE_INT] },
        },
    },
    class ToolPropsMenu extends PopupMenu {
        _init(params = {}) {
            const { extensionPath = '', ...rest } = params;
            this._extensionPath = extensionPath;
            this._currentTool = null;
            this._currentColor = null;
            this._currentSize = 4;
            this._currentMode = 'brush';
            this._currentBlockSize = 16;
            this._updating = false;
            super._init('gradia-tool-props-menu', rest);
        }

        showForTool(toolId, props = {}) {
            this.destroy_all_children();
            this._sizeSliderSetValue = null;
            this._blockSliderSetValue = null;
            this._currentTool = toolId;

            if (toolId !== 'blur') {
                this._buildColorSwatches(props.color ?? '#000000');
                this._currentColor = props.color ?? '#000000';
                if (!this._isSolidRect(toolId)) {
                    this._addSep();
                    this._buildSizeSlider(props.size ?? 4, SIZE_MIN, SIZE_MAX, N_('Size'));
                    this._currentSize = props.size ?? 4;
                }
            } else {
                this._currentMode = props.mode ?? 'brush';
                this._currentSize = props.size ?? 4;
                this._currentBlockSize = props.blockSize ?? 16;
                this._buildModeToggle(this._currentMode);
                if (this._currentMode === 'brush') {
                    this._addSep();
                    this._buildSizeSlider(this._currentSize, SIZE_MIN, BLUR_SIZE_MAX, N_('Brush Size'));
                    this._addSep();
                    this._buildBlockSizeSlider(this._currentBlockSize);
                } else {
                    this._addSep();
                    this._buildBlockSizeSlider(this._currentBlockSize);
                }
            }
        }

        _isSolidRect(toolId) {
            return toolId === 'solid-rectangle';
        }

        _buildColorSwatches(selectedHex) {
            for (const col of COLORS) {
                const ring = new St.Button({
                    style_class: 'screenshot-ui-type-button gradia-option-button',
                    style: `border-color: ${col.hex === selectedHex ? col.hex : 'transparent'};`,
                    y_align: Clutter.ActorAlign.CENTER,
                    layout_manager: new Clutter.BinLayout(),
                });
                const swatch = new St.Widget({
                    style_class: 'gradia-swatch',
                    style: `background-color: ${col.hex};`,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                ring._colorHex = col.hex;
                ring.add_child(swatch);
                ring.connect('clicked', () => {
                    this._currentColor = col.hex;
                    for (const child of this.get_children()) {
                        if (child._colorHex !== undefined)
                            child.style = `border-color: ${child._colorHex === col.hex ? col.hex : 'transparent'};`;
                    }
                    this.emit('color-changed', col.hex);
                });
                this.add_child(ring);
                attachTooltip(ring, col.name);
            }
        }

        _buildSizeSlider(value, min, max, tooltip = '') {
            const slider = new Slider((value - min) / (max - min));
            slider.style = 'width: 60px;';
            slider.y_align = Clutter.ActorAlign.CENTER;
            slider.connect('notify::value', () => {
                if (this._updating) return;
                const v = min + Math.round(slider.value * (max - min));
                if (v === this._currentSize) return;
                this._currentSize = v;
                this.emit('size-changed', v);
            });
            this.add_child(slider);
            if (tooltip) attachTooltip(slider, tooltip);
            this._sizeSlider = slider;
            this._sizeSliderSetValue = (v) => {
                this._updating = true;
                slider.value = (v - min) / (max - min);
                this._updating = false;
            };
        }

        _buildBlockSizeSlider(value) {
            const min = BLOCK_SIZE_MIN,
                max = BLOCK_SIZE_MAX;
            const slider = new SquareSlider((value - min) / (max - min));
            slider.style = 'width: 60px;';
            slider.y_align = Clutter.ActorAlign.CENTER;
            slider.connect('notify::value', () => {
                if (this._updating) return;
                const size = min + Math.round((slider.value * (max - min)) / 2) * 2;
                if (size === this._currentBlockSize) return;
                this._currentBlockSize = size;
                this.emit('block-size-changed', size);
            });
            this.add_child(slider);
            attachTooltip(slider, N_('Block Size'));
            this._blockSlider = slider;
            this._blockSliderSetValue = (v) => {
                this._updating = true;
                slider.value = (v - min) / (max - min);
                this._updating = false;
            };
        }

        _buildModeToggle(currentMode) {
            for (const mode of BLUR_MODES) {
                const child =
                    mode === 'brush'
                        ? new St.Widget({ style_class: 'gradia-swatch', style: 'background-color: #ffffff;' })
                        : new St.Icon({
                              gicon: Gio.Icon.new_for_string(
                                  `${this._extensionPath}/icons/selection-opaque-3-symbolic.svg`,
                              ),
                              style: 'icon-size: 16px;',
                          });
                const btn = new St.Button({
                    style_class: 'screenshot-ui-type-button gradia-option-button',
                    style: 'border-color: transparent;',
                    y_align: Clutter.ActorAlign.CENTER,
                    layout_manager: new Clutter.BinLayout(),
                    toggle_mode: true,
                    checked: mode === currentMode,
                    child,
                });
                btn.connect('clicked', () => this.emit('mode-changed', mode));
                this.add_child(btn);
                attachTooltip(btn, mode === 'brush' ? N_('Brush') : N_('Selection'));
            }
        }

        updateWhenModeChanged(toolId, props) {
            this.showForTool(toolId, props);
        }
        _addSep() {
            this.add_child(new St.Widget({ style_class: 'gradia-separator', y_expand: true }));
        }
    },
);
