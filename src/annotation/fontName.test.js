import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFontDescription, normalizeFontFamily, FALLBACK_FONT } from './fontName.js';

test('buildFontDescription uses family and size', () => {
    assert.equal(buildFontDescription('Cantarell', 24), 'Cantarell 24px');
    assert.equal(buildFontDescription('Monospace', 12), 'Monospace 12px');
});

test('buildFontDescription falls back on empty family', () => {
    assert.equal(buildFontDescription('', 16), `${FALLBACK_FONT} 16px`);
    assert.equal(buildFontDescription('   ', 16), `${FALLBACK_FONT} 16px`);
    assert.equal(buildFontDescription(undefined, 16), `${FALLBACK_FONT} 16px`);
});

test('buildFontDescription ignores non-positive size', () => {
    assert.equal(buildFontDescription('Sans', 0), 'Sans 0px');
    assert.equal(buildFontDescription('Sans', -3), 'Sans 0px');
    assert.equal(buildFontDescription('Sans', NaN), 'Sans 0px');
});

test('normalizeFontFamily strips trailing size', () => {
    assert.equal(normalizeFontFamily('Cantarell 11'), 'Cantarell');
    assert.equal(normalizeFontFamily('DejaVu Sans 10.5'), 'DejaVu Sans');
    assert.equal(normalizeFontFamily('Cantarell 11 bold'), 'Cantarell 11 bold');
});

test('normalizeFontFamily falls back on empty', () => {
    assert.equal(normalizeFontFamily(''), FALLBACK_FONT);
    assert.equal(normalizeFontFamily('   '), FALLBACK_FONT);
    assert.equal(normalizeFontFamily(undefined), FALLBACK_FONT);
});

test('normalizeFontFamily keeps plain family', () => {
    assert.equal(normalizeFontFamily('Monospace'), 'Monospace');
    assert.equal(normalizeFontFamily('Sans'), 'Sans');
});
