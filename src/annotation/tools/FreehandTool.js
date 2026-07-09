import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';

import { N_ } from '../../platform/i18n.js';
import { DrawingTool } from './DrawingTool.js';
import { SELECTION_PADDING, hexToRgb, rectBounds, standardHitTest } from '../shared.js';

export class FreehandTool extends DrawingTool {
    get id() {
        return 'freehand';
    }
    get name() {
        return N_('Freehand');
    }
    get icon() {
        return 'document-edit-symbolic';
    }
    get keybindings() {
        return [Clutter.KEY_3, Clutter.KEY_quotedbl, Clutter.KEY_f];
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
        cr.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) cr.lineTo(stroke.points[i].x, stroke.points[i].y);
        cr.stroke();
    }
}
