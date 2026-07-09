import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

function _isCjk(ch) {
    return (
        (ch >= '\u4e00' && ch <= '\u9fff') || (ch >= '\u3400' && ch <= '\u4dbf') || (ch >= '\uf900' && ch <= '\ufaff')
    );
}

function _toByteIdx(text, charIdx) {
    let byteCount = 0;
    for (let i = 0; i < charIdx; i++) {
        const c = text.charCodeAt(i);
        byteCount += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    }
    return byteCount;
}

export function splitBlocks(rawBlocks, systemFont) {
    const result = [];
    let parentIdx = 0;
    for (const block of rawBlocks) {
        const xs = block.box.map((p) => p[0]);
        const ys = block.box.map((p) => p[1]);
        const bMinX = Math.min(...xs);
        const bMaxX = Math.max(...xs);
        const bMinY = Math.min(...ys);
        const bMaxY = Math.max(...ys);
        const bW = bMaxX - bMinX;
        const bH = bMaxY - bMinY;

        const tokens = [];
        const text = block.text;
        let i = 0;
        let spaced = false;
        while (i < text.length) {
            const ch = text[i];
            if (ch === ' ') {
                spaced = true;
                i++;
                continue;
            }
            if (_isCjk(ch)) {
                tokens.push({ text: ch, startIdx: i, endIdx: i + 1, hasSpaceBefore: spaced });
                spaced = false;
                i++;
            } else {
                let j = i + 1;
                while (j < text.length && text[j] !== ' ' && !_isCjk(text[j])) j++;
                tokens.push({ text: text.substring(i, j), startIdx: i, endIdx: j, hasSpaceBefore: spaced });
                spaced = false;
                i = j;
            }
        }

        if (tokens.length === 0) continue;

        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1, 1);
        const cr = new Cairo.Context(surface);
        const layout = PangoCairo.create_layout(cr);
        const fontSize = Math.max(8, Math.round(bH * 0.8));
        const fontFamily = (systemFont || 'Sans').replace(/\s+\d+(\.\d+)?$/, '');
        const desc = Pango.font_description_from_string(`${fontFamily} ${fontSize}px`);
        layout.set_font_description(desc);
        layout.set_text(text, -1);

        const rawWidths = [];
        let totalRaw = 0;
        for (const token of tokens) {
            const sb = _toByteIdx(text, token.startIdx);
            const eb = _toByteIdx(text, token.endIdx);
            const w = (layout.index_to_pos(eb).x - layout.index_to_pos(sb).x) / Pango.SCALE;
            rawWidths.push(w);
            totalRaw += w;
        }
        cr.$dispose();
        surface.finish();

        const scale = totalRaw > 0 ? bW / totalRaw : bW / text.length;
        let cursorX = 0;
        for (let i = 0; i < tokens.length; i++) {
            const tokW = rawWidths[i] * scale;
            const tokMinX = bMinX + cursorX;
            const tokMaxX = tokMinX + tokW;
            cursorX += tokW;

            result.push({
                text: tokens[i].text,
                score: block.score,
                hasSpaceBefore: tokens[i].hasSpaceBefore,
                parentIdx,
                box: [
                    [tokMinX, bMinY],
                    [tokMaxX, bMinY],
                    [tokMaxX, bMaxY],
                    [tokMinX, bMaxY],
                ],
            });
        }
        parentIdx++;
    }
    return result;
}
