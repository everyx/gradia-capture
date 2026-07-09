import { SELECTION_PADDING, rectBounds, rectHit } from '../shared.js';
import { MENU_KIND, SIZE_MIN, SIZE_MAX } from '../../platform/menuSchema.js';
import { N_ } from '../../platform/i18n.js';

export class DrawingTool {
    constructor() {
        this._props = {};
        this._settings = null;
        this._onChanged = null;
    }

    get phase() {
        return 'overlay';
    }

    get propSchema() {
        return [];
    }
    get id() {
        return '';
    }
    get name() {
        return '';
    }
    get icon() {
        return '';
    }
    get keybindings() {
        return [];
    }
    get isDrawing() {
        return true;
    }

    get paddingFactor() {
        return 1;
    }

    _attach(settings, onChanged) {
        this._settings = settings;
        this._onChanged = onChanged;
    }

    _gsKey(schemaEntry) {
        return schemaEntry.gsKey || schemaEntry.key;
    }

    load() {
        const s = this._settings;
        if (!s?.hasTool(this.id)) return;
        for (const entry of this.propSchema) {
            const v = s.getValue(this.id, this._gsKey(entry), entry.type);
            this._props[entry.key] = v ?? entry.default;
        }
    }

    save() {
        const s = this._settings;
        if (!s?.hasTool(this.id)) return;
        for (const entry of this.propSchema) {
            const v = this._props[entry.key];
            if (v !== undefined) s.setValue(this.id, this._gsKey(entry), entry.type, v);
        }
    }

    set(key, value, { silent = false } = {}) {
        this._props[key] = value;
        if (!silent) this._onChanged?.(key, value);
    }

    get(key) {
        return this._props[key];
    }

    getMenuItems() {
        const items = [];
        for (const entry of this.propSchema) {
            if (entry.key === 'color') {
                items.push({ kind: MENU_KIND.COLOR, key: 'color', value: this.get('color') });
            } else if (entry.key === 'size') {
                items.push({
                    kind: MENU_KIND.SLIDER,
                    key: 'size',
                    min: SIZE_MIN,
                    max: SIZE_MAX,
                    label: N_('Size'),
                    value: this.get('size'),
                });
            }
        }
        return items;
    }

    beginStroke() {
        return {};
    }
    bounds(stroke) {
        const w = stroke.strokeWidth ?? 4;
        return rectBounds(stroke.stagePoints, SELECTION_PADDING + this.paddingFactor * w);
    }
    hitTest(stroke, sx, sy) {
        return rectHit(this.bounds(stroke), sx, sy);
    }
    render(_cr, _stroke, _size) {}

    bindCapabilities(stroke) {
        stroke.phase = this.phase;
        stroke.hitBounds = () => this.bounds(stroke);
        stroke.paintTo = (cr, ctx) => {
            if (!cr || !this.render) return;
            const { selX, selY, selW, selH, stageScale } = ctx;
            if (selW <= 0 || selH <= 0) return;
            const imgW = cr.getTarget()?.getWidth?.() ?? 0;
            const scaleX = selW > 0 ? imgW / selW : 1;
            const scaleY = selH > 0 ? (cr.getTarget()?.getHeight?.() ?? 0) / selH : 1;
            const converted = stroke.stagePoints.map((p) => ({
                x: (p.x / stageScale - selX) * scaleX,
                y: (p.y / stageScale - selY) * scaleY,
            }));
            const lw = stroke.strokeWidth * ((scaleX + scaleY) / 2);
            this.render(
                cr,
                {
                    color: stroke.color,
                    points: converted,
                    counter: stroke.toolId === 'stamp' ? stroke.counter : stroke.counter,
                    text: stroke.text,
                    blurMode: stroke.blurMode,
                    blockSize: stroke.blockSize,
                },
                lw,
            );
        };
    }
}
