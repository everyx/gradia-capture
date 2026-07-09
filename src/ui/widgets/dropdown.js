import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

export const Dropdown = GObject.registerClass(
    {
        Signals: {
            selected: { param_types: [GObject.TYPE_STRING] },
        },
    },
    class Dropdown extends St.BoxLayout {
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
            this._stageId = 0;

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
                visible: false,
            });
            this._scroll.vscrollbar_policy = St.PolicyType.AUTOMATIC;
            this._scroll.hscrollbar_policy = St.PolicyType.NEVER;
            this._list = new St.BoxLayout({ vertical: true });
            this._scroll.add_actor(this._list);
            this.add_child(this._scroll);

            this._btn.connect('clicked', () => {
                if (this.visible && this._scroll.visible) this.close();
                else this.open();
            });

            this.connect('hide', () => this.close());
            this.connect('destroy', () => this._disconnectStage());

            this._build();
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

        get triggerButton() {
            return this._btn;
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

        open() {
            this.setCurrent(this._current);
            this._scroll.show();
            this._connectStage();
        }

        close() {
            this._scroll.hide();
            this._disconnectStage();
        }

        _connectStage() {
            if (this._stageId) return;
            this._stageId = global.stage.connect('button-press-event', (_stage, event) => {
                const target = event.get_source();
                if (target && this.contains(target)) return Clutter.EVENT_PROPAGATE;
                this.close();
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _disconnectStage() {
            if (this._stageId) {
                global.stage.disconnect(this._stageId);
                this._stageId = 0;
            }
        }
    },
);
