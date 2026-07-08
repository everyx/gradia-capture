export class DrawingTool {
    constructor() {
        this._props = {};
        this._settings = null;
        this._onChanged = null;
    }

    get propSchema() { return []; }
    get id() { return ''; }
    get name() { return ''; }
    get icon() { return ''; }
    get keybindings() { return []; }
    get isDrawing() { return true; }

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
            if (v !== undefined)
                s.setValue(this.id, this._gsKey(entry), entry.type, v);
        }
    }

    set(key, value, { silent = false } = {}) {
        this._props[key] = value;
        if (!silent) this._onChanged?.(key, value);
    }

    get(key) {
        return this._props[key];
    }

    beginStroke() { return {}; }
    bounds(_stroke) { return { minX: 0, minY: 0, maxX: 0, maxY: 0 }; }
    hitTest(_stroke, _sx, _sy) { return false; }
    render(_cr, _stroke, _size) {}
}
