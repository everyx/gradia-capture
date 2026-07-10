import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import PangoCairo from 'gi://PangoCairo';

import { normalizeFontFamily, FALLBACK_FONT } from './fontName.js';

let _cache = null;

// Enumerate installed font families once, then cache for the session.
// Clear with clearFontFamiliesCache() when the screenshot session exits.
export function getFontFamilies() {
    if (_cache) return _cache;
    let families = [];
    try {
        families = PangoCairo.font_map_get_default().list_families() ?? [];
    } catch {
        families = [];
    }
    _cache = families
        .map((f) => f.get_name())
        .filter((name) => name && name.length > 0)
        .sort((a, b) => a.localeCompare(b));
    return _cache;
}

export function clearFontFamiliesCache() {
    _cache = null;
}

// Start enumeration in idle to avoid blocking the first tool switch.
export function warmFontFamiliesCache() {
    if (_cache) return;
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        getFontFamilies();
        return GLib.SOURCE_REMOVE;
    });
}

// The user's UI font (org.gnome.desktop.interface font-name), normalized
// to a family name (e.g. "Cantarell 11" -> "Cantarell").
export function getSystemFontFamily() {
    try {
        const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const raw = iface.get_string('font-name');
        return normalizeFontFamily(raw) || FALLBACK_FONT;
    } catch {
        return FALLBACK_FONT;
    }
}
