export function stageToImageCoords(points, { stageScale, selX, selY, scaleX, scaleY }) {
    return points.map((p) => ({
        x: (p.x / stageScale - selX) * scaleX,
        y: (p.y / stageScale - selY) * scaleY,
    }));
}

export function imageScaleFactors(imgW, imgH, selW, selH) {
    return {
        scaleX: selW > 0 ? imgW / selW : 1,
        scaleY: selH > 0 ? imgH / selH : 1,
    };
}

export function stageLineWidth(strokeWidth, scaleX, scaleY) {
    return strokeWidth * ((scaleX + scaleY) / 2);
}
