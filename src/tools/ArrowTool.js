import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';

import { N_ } from '../i18n.js';
import { DrawingTool } from './DrawingTool.js';
import { SELECTION_PADDING, hexToRgb, rectBounds, standardHitTest } from './shared.js';

export class ArrowTool extends DrawingTool {
    get id() { return 'arrow'; }
    get name() { return N_('Arrow'); }
    get icon() { return 'icons/arrow1-top-right-symbolic.svg'; }
    get keybindings() { return [Clutter.KEY_7, Clutter.KEY_egrave, Clutter.KEY_a]; }
    get propSchema() { return [{ key: 'color', type: 's', default: '#000000' }, { key: 'size', type: 'd', default: 3 }]; }
    bounds(s) { return rectBounds(s.stagePoints, SELECTION_PADDING + (s.strokeWidth ?? 4) * 2); }
    hitTest(s, x, y) { return standardHitTest.call(this, s, x, y); }
    render(cr, stroke, lineWidth) {
        if (stroke.points.length < 2) return;
        const { r, g, b } = hexToRgb(stroke.color);
        cr.setSourceRGBA(r, g, b, 1.0);
        cr.setLineWidth(lineWidth);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
        cr.moveTo(p0.x, p0.y); cr.lineTo(p1.x, p1.y); cr.stroke();
        const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        const spread = Math.PI / 7;
        const sz = lineWidth * 5;
        cr.moveTo(p1.x, p1.y);
        cr.lineTo(p1.x - sz * Math.cos(angle - spread), p1.y - sz * Math.sin(angle - spread));
        cr.moveTo(p1.x, p1.y);
        cr.lineTo(p1.x - sz * Math.cos(angle + spread), p1.y - sz * Math.sin(angle + spread));
        cr.stroke();
    }
}
