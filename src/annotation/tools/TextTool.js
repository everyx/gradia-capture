import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import Clutter from 'gi://Clutter';

import { N_ } from '../../platform/i18n.js';
import { MENU_KIND } from '../../platform/menuSchema.js';
import { listFontFamilies } from '../../platform/fonts.js';
import { DrawingTool } from './DrawingTool.js';
import { SELECTION_PADDING, hexToRgb } from '../shared.js';

export class TextTool extends DrawingTool {
    get id() {
        return 'text';
    }
    get name() {
        return N_('Text');
    }
    get icon() {
        return 'icons/text-insert2-symbolic.svg';
    }
    get keybindings() {
        return [Clutter.KEY_8, Clutter.KEY_exclam, Clutter.KEY_t];
    }
    get propSchema() {
        return [
            { key: 'color', type: 's', default: '#000000' },
            { key: 'size', type: 'd', default: 4 },
            { key: 'font', type: 's', default: 'Sans', gsKey: 'font' },
        ];
    }
    getMenuItems() {
        const items = super.getMenuItems();
        items.push({
            kind: MENU_KIND.SELECT,
            key: 'font',
            label: N_('Font'),
            value: this.get('font'),
            options: listFontFamilies(),
        });
        return items;
    }
    beginStroke() {
        return { text: '' };
    }
    bounds(stroke) {
        const pt = stroke.stagePoints[0];
        const fontSize = Math.max(8, Math.round((stroke.strokeWidth ?? 4) * 3));
        if (!stroke.text)
            return {
                minX: pt.x - SELECTION_PADDING,
                minY: pt.y - SELECTION_PADDING,
                maxX: pt.x + SELECTION_PADDING,
                maxY: pt.y + SELECTION_PADDING,
            };
        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1, 1);
        const cr = new Cairo.Context(surface);
        const layout = PangoCairo.create_layout(cr);
        const family = stroke.font || 'Sans';
        const desc = Pango.font_description_from_string(`${family} ${fontSize}px`);
        layout.set_font_description(desc);
        layout.set_text(stroke.text, -1);
        const [, extents] = layout.get_pixel_extents();
        cr.$dispose();
        surface.finish();
        return {
            minX: pt.x - SELECTION_PADDING,
            minY: pt.y - SELECTION_PADDING,
            maxX: pt.x + extents.width + SELECTION_PADDING,
            maxY: pt.y + extents.height + SELECTION_PADDING,
        };
    }
    render(cr, stroke, lineWidth) {
        if (!stroke.text || stroke.points.length < 1) return;
        const pt = stroke.points[0];
        const { r, g, b } = hexToRgb(stroke.color);
        const fontSize = Math.max(8, Math.round(lineWidth * 3));
        const layout = PangoCairo.create_layout(cr);
        const family = stroke.font || 'Sans';
        const desc = Pango.font_description_from_string(`${family} ${fontSize}px`);
        layout.set_font_description(desc);
        layout.set_text(stroke.text, -1);
        cr.setSourceRGBA(r, g, b, 1.0);
        cr.moveTo(pt.x, pt.y);
        PangoCairo.show_layout(cr, layout);
    }
}
