import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { PopupMenu as ShellPopupMenu, PopupBaseMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';

let _popupId = 0;

const CappedPopup = GObject.registerClass(
    class CappedPopup extends St.Bin {
        _init(params = {}) {
            super._init(params);
            this._id = ++_popupId;
            console.log(`CappedPopup#${this._id} created`);
        }
        vfunc_get_preferred_width(forHeight) {
            const [min, nat] = super.vfunc_get_preferred_width(forHeight);
            console.log(
                'CappedPopup',
                this._id,
                'get_pref_w',
                forHeight,
                'in',
                { min, nat },
                'out',
                Math.min(min, 280),
                Math.min(nat, 280),
            );
            return [Math.min(min, 280), Math.min(nat, 280)];
        }
        vfunc_get_preferred_height(forWidth) {
            const [min, nat] = super.vfunc_get_preferred_height(forWidth);
            console.log(
                'CappedPopup',
                this._id,
                'get_pref_h',
                forWidth,
                'in',
                { min, nat },
                'out',
                Math.min(min, 300),
                Math.min(nat, 300),
            );
            return [Math.min(min, 300), Math.min(nat, 300)];
        }
        vfunc_allocate(box) {
            const inW = box.get_width();
            const inH = box.get_height();
            const w = Math.min(inW, 280);
            const h = Math.min(inH, 300);
            box.set_size(w, h);
            super.vfunc_allocate(box);
            const child = this.get_first_child();
            if (child) {
                const cb = child.get_allocation_box();
                console.log(
                    'CappedPopup',
                    this._id,
                    'alloc',
                    'box',
                    inW,
                    '×',
                    inH,
                    '→',
                    w,
                    '×',
                    h,
                    'scrollview',
                    cb.get_width(),
                    '×',
                    cb.get_height(),
                );
            }
        }
    },
);

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
            this._closeIdle = 0;
            this._pendingValue = null;

            this._btn = new St.Button({
                style_class: 'gradia-dropdown-button',
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
                layout_manager: new Clutter.BinLayout(),
                can_focus: true,
            });
            this._btnLabel = new St.Label({ text: current });
            this._btn.add_child(this._btnLabel);
            this.add_child(this._btn);

            this._menu = new ShellPopupMenu(this._btn, 0, St.Side.TOP);
            this._menu.actor.add_style_class_name('gradia-font-picker-popup');
            this._wrapMenuInScrollView();
            Main.screenshotUI.add_child(this._menu.actor);
            this._menu.actor.hide();

            this._btn.connect('clicked', () => {
                if (this._menu.isOpen) this.close();
                else this.open();
            });

            this._capturedEventId = global.stage.connect('captured-event', (actor, event) => {
                if (!this._menu.isOpen) return Clutter.EVENT_PROPAGATE;

                if (event.type() === Clutter.EventType.KEY_PRESS) {
                    if (event.get_key_symbol() === Clutter.KEY_Escape) {
                        this.close();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                }

                if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                    const target = global.stage.get_event_actor(event);
                    if (!this._menu.actor.contains(target) && target !== this._btn && !this._btn.contains(target)) {
                        this.close();
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });

            this.connect('destroy', () => {
                if (this._closeIdle) {
                    GLib.source_remove(this._closeIdle);
                    this._closeIdle = 0;
                }
                if (this._capturedEventId) {
                    global.stage.disconnect(this._capturedEventId);
                    this._capturedEventId = 0;
                }
                Main.screenshotUI.remove_child(this._menu.actor);
                this._menu.destroy();
            });
        }

        _wrapMenuInScrollView() {
            this._menu._boxPointer.bin.remove_child(this._menu.box);
            this._menu.box.style_class = '';
            const scrollView = new St.ScrollView({
                style_class: 'popup-menu-content gradia-font-scrollview',
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                hscrollbar_policy: St.PolicyType.NEVER,
                clip_to_allocation: true,
                x_expand: true,
                y_expand: true,
                child: this._menu.box,
            });
            const capped = new CappedPopup({
                child: scrollView,
                clip_to_allocation: true,
            });
            this._menu._boxPointer.bin.set_child(capped);
        }

        get triggerButton() {
            return this._btn;
        }

        get listActor() {
            return this._menu.actor;
        }

        setOptions(options) {
            this._options = options || [];
        }

        setCurrent(current) {
            this._current = current;
            this._btnLabel.text = current;
        }

        _buildList() {
            for (const fam of this._options) {
                const item = new PopupBaseMenuItem({
                    can_focus: true,
                    reactive: true,
                });
                const label = new St.Label({
                    text: fam,
                    y_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                item.add_child(label);
                item._fontFamily = fam;
                item.setOrnament(fam === this._current ? 2 : 0);
                item.connect('activate', () => this._onItemActivated(fam));
                this._menu.box.add_child(item);
            }
        }

        _onItemActivated(fam) {
            this._pendingValue = fam;
            if (!this._closeIdle) {
                this._closeIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._closeIdle = 0;
                    this.close();
                    if (this._pendingValue !== null) {
                        const v = this._pendingValue;
                        this._pendingValue = null;
                        this.emit('selected', v);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        _rebuild() {
            const before = this._menu.box.get_children().length;
            for (const child of this._menu.box.get_children()) child.destroy();
            this._buildList();
            const after = this._menu.box.get_children().length;
            console.log('FontPicker:_rebuild', { destroyed: before, created: after });
            this._menu.box.queue_relayout();
        }

        open() {
            if (this._menu.isOpen) return;
            const binChild = this._menu._boxPointer.bin.get_first_child();
            console.log('FontPicker:open', {
                isOpen: this._menu.isOpen,
                items: this._options.length,
                binChild: binChild?.constructor.name,
                binChildId: binChild?._id,
            });
            this._rebuild();
            const btnW = this._btn.get_width();
            if (btnW > 0) this._menu._arrowAlignment = 8 / (btnW - 280);
            this._menu.open(0);
            this.emit('open-state-changed', true);

            const first = this._menu.firstMenuItem;
            if (first && first.actor && first.actor.can_focus) first.actor.grab_key_focus();
        }

        close() {
            console.log('FontPicker:close', { isOpen: this._menu.isOpen });
            if (this._closeIdle) {
                GLib.source_remove(this._closeIdle);
                this._closeIdle = 0;
                this._pendingValue = null;
            }
            if (!this._menu.isOpen) return;
            this._menu.close(0);
            this._btn.grab_key_focus();
            this.emit('open-state-changed', false);
        }
    },
);
