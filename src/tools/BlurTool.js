import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';

import { N_ } from '../i18n.js';
import { DrawingTool } from './DrawingTool.js';
import { SELECTION_PADDING, createPixelatePattern, standardHitTest, rectBounds } from './shared.js';

export class BlurTool extends DrawingTool {
    get id() { return 'blur'; }
    get name() { return N_('Blur'); }
    get icon() { return 'icons/blur-symbolic.svg'; }
    get keybindings() { return [Clutter.KEY_0, Clutter.KEY_agrave, Clutter.KEY_m]; }
    get propSchema() {
        return [
            { key: 'mode', type: 's', default: 'brush' },
            { key: 'size', type: 'd', default: 4 },
            { key: 'blockSize', gsKey: 'block-size', type: 'i', default: 16 },
        ];
    }
    bounds(s) { return rectBounds(s.stagePoints, SELECTION_PADDING + (s.strokeWidth ?? 8) / 2); }
    hitTest(s, x, y) { return standardHitTest.call(this, s, x, y); }
    render(cr, stroke, lineWidth) {
        if (stroke.points.length < 2) return;
        const bs = stroke.blockSize || 16;
        const pattern = createPixelatePattern(bs);
        cr.save();
        cr.setSource(pattern);
        if (stroke.blurMode === 'selection') {
            const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
            cr.rectangle(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
            cr.fill();
        } else {
            cr.setLineWidth(lineWidth);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) cr.lineTo(stroke.points[i].x, stroke.points[i].y);
            cr.stroke();
        }
        cr.restore();
    }
}
