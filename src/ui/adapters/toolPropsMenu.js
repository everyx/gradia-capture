import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';

import { SquareSlider } from '../widgets/squareSlider.js';
import { FontPicker } from '../widgets/fontPicker.js';

import { attachTooltip } from '../../platform/tooltip.js';
import { PopupMenu } from './popupMenu.js';
import { MENU_KIND } from '../../platform/menuSchema.js';
import { N_, _ } from '../../platform/i18n.js';

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

export const ToolPropsMenu = GObject.registerClass(
    {
        Signals: {
            'property-changed': { param_types: [GObject.TYPE_STRING] },
        },
    },
    class ToolPropsMenu extends PopupMenu {
        _init(params = {}) {
            const { extensionPath = '', ...rest } = params;
            this._extensionPath = extensionPath;
            this._controls = new Map();
            this._seps = [];
            this._updating = false;
            this._containmentExtras = new Set();
            super._init('gradia-tool-props-menu', rest);
        }

        containsExtra(target) {
            for (const actor of this._containmentExtras) {
                if (actor.contains(target)) return true;
            }
            return false;
        }

        render(items) {
            const visible = [];
            for (const item of items) {
                const control = this._ensureControl(item);
                control.update(item);
                control.group.show();
                visible.push(control.group);
            }
            for (const [key, control] of this._controls) {
                if (!items.some((i) => i.key === key)) control.group.hide();
            }
            this._layout(visible);
        }

        setValue(key, value) {
            const control = this._controls.get(key);
            if (control?.setValue) control.setValue(value);
        }

        _emit(key, value) {
            this.emit('property-changed', JSON.stringify({ key, value }));
        }

        _ensureControl(item) {
            let control = this._controls.get(item.key);
            if (!control) {
                if (item.kind === MENU_KIND.COLOR) control = this._makeColor(item);
                else if (item.kind === MENU_KIND.SLIDER) control = this._makeSlider(item);
                else if (item.kind === MENU_KIND.TOGGLE) control = this._makeToggle(item);
                else if (item.kind === MENU_KIND.SELECT) control = this._makeSelect(item);
                this._controls.set(item.key, control);
                this.add_child(control.group);
            }
            return control;
        }

        _layout(groups) {
            const needed = Math.max(0, groups.length - 1);
            while (this._seps.length < needed) {
                const sep = new St.Widget({ style_class: 'gradia-separator', y_expand: true });
                this._seps.push(sep);
                this.add_child(sep);
            }
            for (let i = 0; i < this._seps.length; i++) {
                if (i < needed) this._seps[i].show();
                else this._seps[i].hide();
            }
            const ordered = [];
            groups.forEach((g, i) => {
                if (i > 0) ordered.push(this._seps[i - 1]);
                ordered.push(g);
            });
            ordered.forEach((child, idx) => this.set_child_at_index(child, idx));
        }

        _makeColor(item) {
            const group = new St.BoxLayout({ style_class: 'gradia-menu-group' });
            const rings = [];
            const setSelected = (hex) => {
                for (const r of rings) r.style = `border-color: ${r._colorHex === hex ? r._colorHex : 'transparent'};`;
            };
            for (const col of COLORS) {
                const ring = new St.Button({
                    style_class: 'screenshot-ui-type-button gradia-option-button',
                    style: 'border-color: transparent;',
                    y_align: Clutter.ActorAlign.CENTER,
                    layout_manager: new Clutter.BinLayout(),
                });
                ring._colorHex = col.hex;
                ring.add_child(
                    new St.Widget({
                        style_class: 'gradia-swatch',
                        style: `background-color: ${col.hex};`,
                        y_align: Clutter.ActorAlign.CENTER,
                    }),
                );
                ring.connect('clicked', () => {
                    setSelected(col.hex);
                    this._emit(item.key, col.hex);
                });
                group.add_child(ring);
                attachTooltip(ring, col.name);
                rings.push(ring);
            }
            return { group, update: (it) => setSelected(it.value), setValue: setSelected };
        }

        _makeSlider(item) {
            const group = new St.BoxLayout({ style_class: 'gradia-menu-group' });
            const isSquare = item.variant === 'square';
            const slider = isSquare ? new SquareSlider(0) : new Slider(0);
            slider.style = 'width: 60px;';
            slider.y_align = Clutter.ActorAlign.CENTER;

            const state = { min: item.min, max: item.max, step: item.step ?? 1, current: item.value };

            const setValue = (value) => {
                state.current = value;
                this._updating = true;
                slider.value = (value - state.min) / (state.max - state.min);
                this._updating = false;
            };

            slider.connect('notify::value', () => {
                if (this._updating) return;
                const raw = state.min + slider.value * (state.max - state.min);
                const v = state.step > 1 ? Math.round(raw / state.step) * state.step : Math.round(raw);
                if (v === state.current) return;
                state.current = v;
                this._emit(item.key, v);
            });

            group.add_child(slider);
            const tooltip = item.label ? attachTooltip(slider, item.label) : null;

            return {
                group,
                setValue,
                update: (it) => {
                    state.min = it.min;
                    state.max = it.max;
                    state.step = it.step ?? 1;
                    if (tooltip && it.label) tooltip.text = _(it.label);
                    setValue(it.value);
                },
            };
        }

        _makeToggle(item) {
            const group = new St.BoxLayout({ style_class: 'gradia-menu-group' });
            const btns = [];
            const setSelected = (value) => {
                for (const b of btns) b.checked = b._optValue === value;
            };
            for (const opt of item.options) {
                const child = opt.swatch
                    ? new St.Widget({ style_class: 'gradia-swatch', style: `background-color: ${opt.swatch};` })
                    : new St.Icon({
                          gicon: Gio.Icon.new_for_string(`${this._extensionPath}/${opt.icon}`),
                          style: 'icon-size: 16px;',
                      });
                const btn = new St.Button({
                    style_class: 'screenshot-ui-type-button gradia-option-button',
                    style: 'border-color: transparent;',
                    y_align: Clutter.ActorAlign.CENTER,
                    layout_manager: new Clutter.BinLayout(),
                    toggle_mode: true,
                    checked: opt.value === item.value,
                    child,
                });
                btn._optValue = opt.value;
                btn.connect('clicked', () => this._emit(item.key, opt.value));
                group.add_child(btn);
                if (opt.label) attachTooltip(btn, opt.label);
                btns.push(btn);
            }
            return { group, update: (it) => setSelected(it.value), setValue: setSelected };
        }

        _makeSelect(item) {
            const group = new St.BoxLayout({
                vertical: true,
                style_class: 'gradia-menu-group gradia-select-group',
            });

            const picker = new FontPicker({
                options: item.options,
                current: item.value,
            });
            picker.connect('selected', (_d, value) => this._emit(item.key, value));
            picker.connect('open-state-changed', (_d, open) => {
                if (open) this._containmentExtras.add(picker.listActor);
                else this._containmentExtras.delete(picker.listActor);
            });
            this.connect('hide', () => {
                picker.close();
                this._containmentExtras.delete(picker.listActor);
            });
            group.add_child(picker);
            if (item.label) attachTooltip(picker.triggerButton, item.label);

            return {
                group,
                setValue: (v) => picker.setCurrent(v),
                update: (it) => {
                    picker.setOptions(it.options);
                    picker.setCurrent(it.value);
                },
            };
        }
    },
);
