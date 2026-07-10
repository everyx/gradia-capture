// Pure font-name helpers (no GJS/gi imports) so they are unit-testable
// under plain Node via `node --test`.

export const FALLBACK_FONT = 'Sans';

// Build a Pango font description string, e.g. "Sans 24px".
export function buildFontDescription(family, px) {
    const fam = family && family.trim() ? family.trim() : FALLBACK_FONT;
    const size = Number.isFinite(px) && px > 0 ? px : 0;
    return `${fam} ${size}px`;
}

// Strip a trailing point size from a font name, e.g.
// "Cantarell 11" -> "Cantarell". Empty/garbage -> FALLBACK_FONT.
export function normalizeFontFamily(name) {
    if (!name) return FALLBACK_FONT;
    const trimmed = name.trim();
    if (!trimmed) return FALLBACK_FONT;
    return trimmed.replace(/\s+\d+(\.\d+)?$/, '') || FALLBACK_FONT;
}
