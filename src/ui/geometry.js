import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function getSelectionRect(ui = Main.screenshotUI) {
    const area = ui?._areaSelector;
    if (!area) return null;
    const [x, y, w, h] = area.getGeometry();
    if (w <= 2 || h <= 2) return null;
    return { x, y, width: w, height: h };
}

export function monitorForPoint(cx, cy) {
    const monitors = Main.layoutManager.monitors;
    if (!monitors?.length) return null;
    for (const m of monitors) {
        if (cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height)
            return { x: m.x, y: m.y, width: m.width, height: m.height };
    }
    return null;
}

export function monitorForRect(rect) {
    if (!rect) return _primaryRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return monitorForPoint(cx, cy) ?? _primaryRect();
}

function _primaryRect() {
    const m = Main.layoutManager.primaryMonitor;
    return m ? { x: m.x, y: m.y, width: m.width, height: m.height } : null;
}

export function clampToMonitor(x, y, width, height, monitorRect) {
    if (!monitorRect) return { x, y };
    return {
        x: Math.max(monitorRect.x, Math.min(x, monitorRect.x + monitorRect.width - width)),
        y: Math.max(monitorRect.y, Math.min(y, monitorRect.y + monitorRect.height - height)),
    };
}
