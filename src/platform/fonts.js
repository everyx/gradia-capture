import Pango from 'gi://Pango';

let _families = null;

const GENERIC_FAMILIES = ['Sans', 'Serif', 'Monospace'];

export function listFontFamilies() {
    if (_families) return _families;
    let families = [];
    try {
        const map = Pango.font_map_get_default();
        families = map.list_families().map((f) => f.get_name());
    } catch {
        families = [];
    }
    const seen = new Set();
    const result = [];
    for (const name of [...GENERIC_FAMILIES, ...families]) {
        if (!name || seen.has(name)) continue;
        seen.add(name);
        result.push(name);
    }
    _families = result;
    return _families;
}
