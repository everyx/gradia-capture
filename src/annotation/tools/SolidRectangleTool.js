import Clutter from 'gi://Clutter';

import { N_ } from '../../platform/i18n.js';
import { DrawingTool } from './DrawingTool.js';
import { SELECTION_PADDING, hexToRgb, rectBounds, standardHitTest } from '../shared.js';

export class SolidRectangleTool extends DrawingTool {
    get id() {
        return 'solid-rectangle';
    }
    get name() {
        return N_('Solid Rectangle');
    }
    get icon() {
        return 'icons/square-filled-symbolic.svg';
    }
    get keybindings() {
        return [Clutter.KEY_5, Clutter.KEY_parenleft, Clutter.KEY_b];
    }
    get propSchema() {
        return [{ key: 'color', type: 's', default: '#000000' }];
    }
    bounds(s) {
        return rectBounds(s.stagePoints, SELECTION_PADDING);
    }
    hitTest(s, x, y) {
        return standardHitTest.call(this, s, x, y);
    }
    render(cr, stroke, _lineWidth) {
        if (stroke.points.length < 2) return;
        const { r, g, b } = hexToRgb(stroke.color);
        cr.setSourceRGBA(r, g, b, 1.0);
        const p0 = stroke.points[0],
            p1 = stroke.points[stroke.points.length - 1];
        cr.rectangle(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
        cr.fill();
    }
}
