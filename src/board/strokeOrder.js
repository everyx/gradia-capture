export function orderByPhase(strokes) {
    return strokes
        .map((s, i) => ({ s, i }))
        .sort((a, b) => (a.s.phase === 'underlay' ? 0 : 1) - (b.s.phase === 'underlay' ? 0 : 1) || a.i - b.i)
        .map((o) => o.s);
}

export function splitByPhase(strokes) {
    const underlay = [];
    const overlay = [];
    for (const s of strokes) {
        if (s.phase === 'underlay') underlay.push(s);
        else overlay.push(s);
    }
    return { underlay, overlay };
}
