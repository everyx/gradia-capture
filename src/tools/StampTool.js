import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import Clutter from 'gi://Clutter';

import { N_ } from '../i18n.js';
import { DrawingTool } from './DrawingTool.js';
import { SELECTION_PADDING, hexToRgb, rectHit } from './shared.js';

export class StampTool extends DrawingTool {
    constructor() {
        super();
        this._counter = 0;
    }
    get id() { return 'stamp'; }
    get name() { return N_('Number Stamp'); }
    get icon() { return 'icons/one-circle-symbolic.svg'; }
    get keybindings() { return [Clutter.KEY_9, Clutter.KEY_ccedilla, Clutter.KEY_n]; }
    get isStamp() { return true; }
    get propSchema() { return [{ key: 'color', type: 's', default: '#000000' }, { key: 'size', type: 'd', default: 3 }]; }
    beginStroke() { return { counter: ++this._counter }; }
    bounds(stroke) {
        const pt = stroke.stagePoints[0];
        const r = (stroke.strokeWidth ?? 4) * 5 + SELECTION_PADDING;
        return { minX: pt.x - r, minY: pt.y - r, maxX: pt.x + r, maxY: pt.y + r };
    }
    hitTest(stroke, sx, sy) {
        if (stroke.stagePoints.length < 1) return false;
        return rectHit(this.bounds(stroke), sx, sy);
    }
    render(cr, stroke, lineWidth) {
        if (stroke.points.length < 1) return;
        const pt = stroke.points[0];
        const radius = lineWidth * 5;
        const rgb = hexToRgb(stroke.color);
        const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
        const textColor = lum > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 1, g: 1, b: 1 };
        cr.setSourceRGBA(rgb.r, rgb.g, rgb.b, 1.0);
        cr.arc(pt.x, pt.y, radius, 0, 2 * Math.PI);
        cr.fill();
        const label = String(stroke.counter ?? 1);
        const fontSize = Math.round(radius * 1.2);
        const layout = PangoCairo.create_layout(cr);
        const desc = Pango.font_description_from_string(`Sans Bold ${fontSize}px`);
        layout.set_font_description(desc);
        layout.set_text(label, -1);
        const [, extents] = layout.get_pixel_extents();
        cr.setSourceRGBA(textColor.r, textColor.g, textColor.b, 1.0);
        cr.moveTo(pt.x - extents.width / 2 - extents.x, pt.y - extents.height / 2 - extents.y);
        PangoCairo.show_layout(cr, layout);
    }
}
