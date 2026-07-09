export function groupBlocksToLines(blocks) {
    if (blocks.length === 0) return [];

    const lines = [];
    let cur = [blocks[0]];
    for (let i = 1; i < blocks.length; i++) {
        const prevH = cur[cur.length - 1].maxY - cur[cur.length - 1].minY;
        const dy = Math.abs(blocks[i].minY - cur[cur.length - 1].minY);
        if (dy < prevH * 0.6) cur.push(blocks[i]);
        else {
            lines.push(cur);
            cur = [blocks[i]];
        }
    }
    lines.push(cur);

    return lines.map((line) => {
        let s = '';
        for (let i = 0; i < line.length; i++) {
            if (i > 0) {
                if (line[i].parentIdx !== line[i - 1].parentIdx) s += ' ';
                else if (line[i].hasSpaceBefore) s += ' ';
            }
            s += line[i].text;
        }
        return s;
    });
}
