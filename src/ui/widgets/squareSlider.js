import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';

export const SquareSlider = GObject.registerClass(
    class SquareSlider extends Slider {
        _init(value) {
            super._init(value);
        }

        vfunc_repaint() {
            super.vfunc_repaint();

            const cr = this.get_context();
            const themeNode = this.get_theme_node();
            const [width, height] = this.get_surface_size();
            const rtl = this.get_text_direction() === Clutter.TextDirection.RTL;
            const half = this._handleRadius;
            const size = half * 2;
            const corner = 2;

            const handleY = height / 2;
            let handleX = half + ((width - 2 * half) * this._value) / this._maxValue;
            if (rtl) handleX = width - handleX;

            cr.save();
            cr.setSourceColor(themeNode.get_foreground_color());
            cr.translate(handleX - half, handleY - half);
            cr.arc(corner, corner, corner, Math.PI, (3 * Math.PI) / 2);
            cr.arc(size - corner, corner, corner, (3 * Math.PI) / 2, 2 * Math.PI);
            cr.arc(size - corner, size - corner, corner, 0, Math.PI / 2);
            cr.arc(corner, size - corner, corner, Math.PI / 2, Math.PI);
            cr.closePath();
            cr.fill();
            cr.restore();
            cr.$dispose();
        }
    },
);
