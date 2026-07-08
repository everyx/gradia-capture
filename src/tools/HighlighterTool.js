import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';

import { N_ } from '../i18n.js';
import { DrawingTool } from './DrawingTool.js';
import { SELECTION_PADDING, hexToRgb, rectBounds, standardHitTest } from './shared.js';

export class HighlighterTool extends DrawingTool {
    get id() { return 'highlighter'; }
    get name() { return N_('Highlighter'); }
    get icon() { return 'icons/marker-symbolic.svg'; }
    get keybindings() { return [Clutter.KEY_6, Clutter.KEY_section, Clutter.KEY_h]; }
    get propSchema() { return [{ key: 'color', type: 's', default: '#ffdd00' }, { key: 'size', type: 'd', default: 4 }]; }
    bounds(s) { return rectBounds(s.stagePoints, SELECTION_PADDING + (s.strokeWidth ?? 4) * 4); }
    hitTest(s, x, y) { return standardHitTest.call(this, s, x, y); }
    render(cr, stroke, lineWidth) {
        if (stroke.points.length < 2) return;
        const { r, g, b } = hexToRgb(stroke.color);
        cr.setSourceRGBA(r, g, b, 0.4);
        cr.setLineWidth(lineWidth * 4);
        cr.setLineCap(Cairo.LineCap.SQUARE);
        cr.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) cr.lineTo(stroke.points[i].x, stroke.points[i].y);
        cr.stroke();
    }
}
