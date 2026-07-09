import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    PopupMenu as ShellPopupMenu,
    PopupMenuItem,
    PopupMenuManager,
} from 'resource:///org/gnome/shell/ui/popupMenu.js';

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
            Main.screenshotUI.add_child(this._menu.actor);

            this._btn.connect('clicked', () => {
                if (this._menu.isOpen) this._menu.close();
                else this.open();
            });

            this.connect('destroy', () => {
                Main.screenshotUI.remove_child(this._menu.actor);
                this._menu.destroy();
            });
        }

        get triggerButton() {
            return this._btn;
        }

        get listActor() {
            return this._menu.actor;
        }

        setOptions(options) {
            this._options = options || [];
            if (this._menu.isOpen) this._rebuild();
        }

        setCurrent(current) {
            this._current = current;
            this._btnLabel.text = current;
            this._syncChecks();
        }

        _syncChecks() {
            for (const item of this._menu._getMenuItems()) {
                if (item._familyLabel) item.setOrnament(item._familyLabel === this._current ? 2 : 0);
            }
        }

        _buildList() {
            for (const fam of this._options) {
                const item = new PopupMenuItem(fam);
                item._familyLabel = fam;
                item.setOrnament(fam === this._current ? 2 : 0);
                item.connect('activate', () => this._select(fam));
                this._menu.addMenuItem(item);
            }
        }

        _rebuild() {
            this._menu.removeAll();
            this._buildList();
        }

        open() {
            if (this._menu.isOpen) return;
            this._rebuild();
            this._menu.open();
            this.emit('open-state-changed', true);
        }

        close() {
            if (!this._menu.isOpen) return;
            this._menu.close();
            this.emit('open-state-changed', false);
        }

        _select(value) {
            this._menu.close();
            this.emit('selected', value);
        }
    },
);
