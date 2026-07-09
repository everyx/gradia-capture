import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';

import { N_ } from '../../platform/i18n.js';
import { DrawingTool } from './DrawingTool.js';
import { createPixelatePattern } from '../shared.js';
import { composeBlurStrokes } from './blur/engine.js';
import { MENU_KIND, SIZE_MIN, BLUR_SIZE_MAX, BLOCK_SIZE_MIN, BLOCK_SIZE_MAX } from '../../platform/menuSchema.js';

export class BlurTool extends DrawingTool {
    get id() {
        return 'blur';
    }
    get phase() {
        return 'underlay';
    }
    get name() {
        return N_('Blur');
    }
    get icon() {
        return 'icons/blur-symbolic.svg';
    }
    get keybindings() {
        return [Clutter.KEY_0, Clutter.KEY_agrave, Clutter.KEY_m];
    }
    get propSchema() {
        return [
            { key: 'mode', type: 's', default: 'brush' },
            { key: 'size', type: 'd', default: 4 },
            { key: 'blockSize', gsKey: 'block-size', type: 'i', default: 16 },
        ];
    }
    get paddingFactor() {
        return 0.5;
    }
    getMenuItems() {
        const mode = this.get('mode') ?? 'brush';
        const items = [
            {
                kind: MENU_KIND.TOGGLE,
                key: 'mode',
                value: mode,
                options: [
                    { value: 'brush', swatch: '#ffffff', label: N_('Brush') },
                    { value: 'selection', icon: 'icons/selection-opaque-3-symbolic.svg', label: N_('Selection') },
                ],
            },
        ];
        if (mode === 'brush') {
            items.push({
                kind: MENU_KIND.SLIDER,
                key: 'size',
                min: SIZE_MIN,
                max: BLUR_SIZE_MAX,
                label: N_('Brush Size'),
                value: this.get('size'),
            });
        }
        items.push({
            kind: MENU_KIND.SLIDER,
            key: 'blockSize',
            min: BLOCK_SIZE_MIN,
            max: BLOCK_SIZE_MAX,
            step: 2,
            variant: 'square',
            label: N_('Block Size'),
            value: this.get('blockSize'),
        });
        return items;
    }
    render(cr, stroke, lineWidth) {
        if (stroke.points.length < 2) return;
        const bs = stroke.blockSize || 16;
        const pattern = createPixelatePattern(bs);
        cr.save();
        cr.setSource(pattern);
        if (stroke.blurMode === 'selection') {
            const p0 = stroke.points[0],
                p1 = stroke.points[stroke.points.length - 1];
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

    bindCapabilities(stroke) {
        stroke.phase = this.phase;
        stroke.hitBounds = () => this.bounds(stroke);
        stroke.paintTo = (pixbuf, ctx) => {
            if (!pixbuf) return pixbuf;
            return composeBlurStrokes(pixbuf, [stroke], ctx);
        };
    }
}
