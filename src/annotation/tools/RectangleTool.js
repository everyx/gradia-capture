import Clutter from 'gi://Clutter';

import { N_ } from '../../platform/i18n.js';
import { DrawingTool } from './DrawingTool.js';
import { SELECTION_PADDING, hexToRgb, rectBounds, standardHitTest } from '../shared.js';

export class RectangleTool extends DrawingTool {
    get id() {
        return 'rectangle';
    }
    get name() {
        return N_('Rectangle');
    }
    get icon() {
        return 'icons/square-outline-thick-symbolic.svg';
    }
    get keybindings() {
        return [Clutter.KEY_4, Clutter.KEY_apostrophe, Clutter.KEY_r];
    }
    get propSchema() {
        return [
            { key: 'color', type: 's', default: '#000000' },
            { key: 'size', type: 'd', default: 3 },
        ];
    }
    bounds(s) {
        return rectBounds(s.stagePoints, SELECTION_PADDING + (s.strokeWidth ?? 4));
    }
    hitTest(s, x, y) {
        return standardHitTest.call(this, s, x, y);
    }
    render(cr, stroke, lineWidth) {
        if (stroke.points.length < 2) return;
        const { r, g, b } = hexToRgb(stroke.color);
        cr.setSourceRGBA(r, g, b, 1.0);
        cr.setLineWidth(lineWidth);
        const p0 = stroke.points[0],
            p1 = stroke.points[stroke.points.length - 1];
        cr.rectangle(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
        cr.stroke();
    }
}
