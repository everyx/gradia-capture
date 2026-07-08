const SCHEMA_ID = 'org.gnome.shell.extensions.gradia-companion';
const TOOL_SCHEMA_PREFIX = `${SCHEMA_ID}.tool.`;

const DRAWING_TOOLS = ['freehand', 'rectangle', 'solid-rectangle', 'highlighter', 'arrow', 'stamp', 'text', 'blur'];

export class GradiaSettings {
    constructor(extension) {
        this._toolSettings = {};
        for (const toolId of DRAWING_TOOLS)
            this._toolSettings[toolId] = extension.getSettings(TOOL_SCHEMA_PREFIX + toolId);
    }

    _for(toolId) {
        return this._toolSettings[toolId];
    }

    hasTool(toolId) {
        return toolId in this._toolSettings;
    }

    getValue(toolId, gsKey, type) {
        const s = this._for(toolId);
        if (!s) return null;
        if (type === 'd') return s.get_double(gsKey);
        if (type === 'i') return s.get_int(gsKey);
        return s.get_string(gsKey) ?? null;
    }

    setValue(toolId, gsKey, type, value) {
        const s = this._for(toolId);
        if (!s || value === undefined) return;
        if (type === 'd') s.set_double(gsKey, value);
        else if (type === 'i') s.set_int(gsKey, value);
        else s.set_string(gsKey, value);
    }

    destroy() {
        this._toolSettings = null;
    }
}
