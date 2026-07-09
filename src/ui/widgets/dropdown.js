import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ROW_HEIGHT = 28;
const MAX_HEIGHT = 240;

export const Dropdown = GObject.registerClass(
    {
        Signals: {
            selected: { param_types: [GObject.TYPE_STRING] },
            'open-state-changed': { param_types: [GObject.TYPE_BOOLEAN] },
        },
    },
    class Dropdown extends St.BoxLayout {
        _init(params = {}) {
            const { options = [], current = '', overlayParent = null, ...rest } = params;
            super._init({
                vertical: true,
                style_class: 'gradia-dropdown',
                ...rest,
            });

            this._options = options;
            this._current = current;
            this._overlayParent = overlayParent ?? Main.screenshotUI;
            this._btns = [];
            this._activeIndex = -1;
            this._stageId = 0;
            this._keyId = 0;

            this._btn = new St.Button({
                style_class: 'gradia-dropdown-button',
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
                layout_manager: new Clutter.BinLayout(),
            });
            this._btnLabel = new St.Label({ text: current });
            this._btn.add_child(this._btnLabel);
            this.add_child(this._btn);

            this._scroll = new St.ScrollView({
                style_class: 'gradia-dropdown-scroll',
            });
            this._scroll.vscrollbar_policy = St.PolicyType.AUTOMATIC;
            this._scroll.hscrollbar_policy = St.PolicyType.NEVER;
            this._list = new St.BoxLayout({ vertical: true });
            this._scroll.add_child(this._list);
            this._scroll.connect('scroll-event', () => Clutter.EVENT_STOP);

            this._btn.connect('clicked', () => {
                if (this._scroll.get_parent()) this.close();
                else this.open();
            });

            this.connect('hide', () => this.close());
            this.connect('destroy', () => {
                this._disconnectStage();
                this._disconnectKey();
            });

            this._build();
        }

        get triggerButton() {
            return this._btn;
        }

        get listActor() {
            return this._scroll;
        }

        setOptions(options) {
            this._options = options || [];
            this._rebuild();
        }

        setCurrent(current) {
            this._current = current;
            this._btnLabel.text = current;
            for (const b of this._btns) b.checked = b._value === current;
        }

        _build() {
            for (const opt of this._options) {
                const btn = new St.Button({
                    style_class: 'gradia-dropdown-item',
                    x_align: Clutter.ActorAlign.START,
                    toggle_mode: true,
                    checked: opt === this._current,
                    reactive: true,
                });
                btn.set_child(new St.Label({ text: opt }));
                btn._value = opt;
                btn.connect('clicked', () => {
                    this.close();
                    this.emit('selected', opt);
                });
                this._list.add_child(btn);
                this._btns.push(btn);
            }
        }

        _rebuild() {
            for (const b of this._btns) b.destroy();
            this._btns = [];
            this._build();
        }

        _indexFor(value) {
            return this._btns.findIndex((b) => b._value === value);
        }

        open() {
            if (this._scroll.get_parent()) return;

            this.setCurrent(this._current);
            this._activeIndex = this._indexFor(this._current);

            const [bx, by] = this._btn.get_transformed_position();
            const [, bw] = this._btn.get_transformed_size();
            const [, bh] = this._btn.get_transformed_size();
            const height = Math.min(this._btns.length * ROW_HEIGHT + 8, MAX_HEIGHT);
            this._scroll.set_size(Math.max(bw, 200), height);
            this._scroll.set_position(Math.round(bx), Math.round(by + bh + 2));
            this._overlayParent.add_child(this._scroll);
            this._scroll.show();

            this._connectStage();
            this._connectKey();
            this.emit('open-state-changed', true);
        }

        close() {
            if (!this._scroll.get_parent()) return;
            this._scroll.hide();
            this._overlayParent.remove_child(this._scroll);
            this._disconnectStage();
            this._disconnectKey();
            this.emit('open-state-changed', false);
        }

        _move(delta) {
            if (this._btns.length === 0) return;
            let idx = this._activeIndex < 0 ? 0 : this._activeIndex + delta;
            idx = Math.max(0, Math.min(this._btns.length - 1, idx));
            this._activeIndex = idx;
            for (let i = 0; i < this._btns.length; i++) this._btns[i].checked = i === idx;
            this._btns[idx].grab_key_focus();
        }

        _selectActive() {
            if (this._activeIndex < 0) return;
            const value = this._btns[this._activeIndex]._value;
            this.close();
            this.emit('selected', value);
        }

        _onKey(event) {
            const sym = event.get_key_symbol();
            if (sym === Clutter.KEY_Down) {
                this._move(1);
                return Clutter.EVENT_STOP;
            }
            if (sym === Clutter.KEY_Up) {
                this._move(-1);
                return Clutter.EVENT_STOP;
            }
            if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
                this._selectActive();
                return Clutter.EVENT_STOP;
            }
            if (sym === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        _connectStage() {
            if (this._stageId) return;
            this._stageId = global.stage.connect('button-press-event', (_stage, event) => {
                const target = event.get_source();
                if (target && (this.contains(target) || this._scroll.contains(target))) return Clutter.EVENT_PROPAGATE;
                this.close();
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _connectKey() {
            if (this._keyId) return;
            this._keyId = global.stage.connect('key-press-event', (_stage, event) => this._onKey(event));
        }

        _disconnectStage() {
            if (this._stageId) {
                global.stage.disconnect(this._stageId);
                this._stageId = 0;
            }
        }

        _disconnectKey() {
            if (this._keyId) {
                global.stage.disconnect(this._keyId);
                this._keyId = 0;
            }
        }
    },
);
