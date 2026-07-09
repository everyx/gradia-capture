import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { PopupMenu as ShellPopupMenu, PopupMenuManager } from 'resource:///org/gnome/shell/ui/popupMenu.js';

const ROW_HEIGHT = 28;
const MAX_HEIGHT = 340;

export const FontPicker = GObject.registerClass(
    {
        Signals: {
            selected: { param_types: [GObject.TYPE_STRING] },
            'open-state-changed': { param_types: [GObject.TYPE_BOOLEAN] },
        },
    },
    class FontPicker extends St.BoxLayout {
        _init(params = {}) {
            const { options = [], current = '', ...rest } = params;
            super._init({
                vertical: true,
                style_class: 'gradia-dropdown',
                ...rest,
            });

            this._options = options;
            this._current = current;
            this._btns = [];
            this._activeIndex = -1;
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

            this._menu = new ShellPopupMenu(this._btn, 0, St.Side.BOTTOM);
            this._menuManager = new PopupMenuManager(this._btn);
            this._menuManager.addMenu(this._menu);

            this._buildList();
            Main.screenshotUI.add_child(this._menu.actor);

            this._btn.connect('clicked', () => {
                if (this._menu.isOpen) this._menu.close();
                else this.open();
            });

            this.connect('destroy', () => this._disconnectKey());
        }

        get triggerButton() {
            return this._btn;
        }

        get listActor() {
            return this._menu.actor;
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

        _buildList() {
            const scroll = new St.ScrollView({
                style_class: 'gradia-dropdown-scroll',
                style: `max-height: ${MAX_HEIGHT}px;`,
            });
            scroll.vscrollbar_policy = St.PolicyType.AUTOMATIC;
            scroll.hscrollbar_policy = St.PolicyType.NEVER;
            scroll.connect('scroll-event', () => Clutter.EVENT_STOP);
            const list = new St.BoxLayout({ vertical: true });
            scroll.add_child(list);
            this._scroll = scroll;
            this._list = list;

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
                btn.connect('clicked', () => this._select(opt));
                list.add_child(btn);
                this._btns.push(btn);
            }
            this._menu.box.add_child(scroll);
        }

        _rebuild() {
            for (const b of this._btns) b.destroy();
            this._btns = [];
            this._buildList();
        }

        _indexFor(value) {
            return this._btns.findIndex((b) => b._value === value);
        }

        open() {
            if (this._menu.isOpen) return;
            this.setCurrent(this._current);
            this._activeIndex = this._indexFor(this._current);
            this._menu.open();
            this._connectKey();
            this.emit('open-state-changed', true);
        }

        close() {
            if (!this._menu.isOpen) return;
            this._menu.close();
            this._disconnectKey();
            this.emit('open-state-changed', false);
        }

        _select(value) {
            this.close();
            this.emit('selected', value);
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
            this._select(this._btns[this._activeIndex]._value);
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

        _connectKey() {
            if (this._keyId) return;
            this._keyId = global.stage.connect('key-press-event', (_stage, event) => this._onKey(event));
        }

        _disconnectKey() {
            if (this._keyId) {
                global.stage.disconnect(this._keyId);
                this._keyId = 0;
            }
        }
    },
);
