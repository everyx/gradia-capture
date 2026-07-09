export function orderByPhase(strokes) {
    const { underlay, overlay } = splitByPhase(strokes);
    return [...underlay, ...overlay];
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
