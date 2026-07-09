import GObject from 'gi://GObject';
import St from 'gi://St';

export const InputCatcher = GObject.registerClass(
    class InputCatcher extends St.Widget {
        _init(canvas, params) {
            super._init({
                reactive: false,
                x_expand: true,
                y_expand: true,
                ...params,
            });
            this._canvas = canvas;
            canvas._overlay = this;
        }

        vfunc_button_press_event(event) {
            return this._canvas.vfunc_button_press_event(event);
        }

        vfunc_button_release_event(event) {
            return this._canvas.vfunc_button_release_event(event);
        }

        vfunc_motion_event(event) {
            return this._canvas.vfunc_motion_event(event);
        }

        vfunc_touch_event(event) {
            return this._canvas.vfunc_touch_event(event);
        }

        vfunc_scroll_event(event) {
            return this._canvas.vfunc_scroll_event(event);
        }
    },
);
