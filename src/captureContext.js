import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function getCaptureContext(ui = Main.screenshotUI) {
    let mode;
    if (ui._windowButton.checked)
        mode = 'window';
    else if (ui._screenButton.checked)
        mode = 'screen';
    else if (ui._selectionButton.checked)
        mode = 'selection';
    else
        mode = 'none';

    let origin;
    switch (mode) {
        case 'selection': {
            const [x, y, w, h] = ui._areaSelector.getGeometry();
            origin = {x, y, w, h};
            break;
        }
        case 'screen': {
            const idx = ui._screenSelectors.findIndex(s => s.checked);
            const m = Main.layoutManager.monitors[idx] ?? Main.layoutManager.primaryMonitor;
            origin = {x: m.x, y: m.y, w: m.width, h: m.height};
            break;
        }
        case 'window': {
            const win = ui._windowSelectors
                .flatMap(s => s.windows())
                .find(w => w.checked);
            const b = win?.boundingBox;
            origin = b ? {x: b.x, y: b.y, w: b.width, h: b.height} : {x: 0, y: 0, w: 0, h: 0};
            break;
        }
        default:
            origin = {x: 0, y: 0, w: 0, h: 0};
    }

    const scale = ui._scale || 1;
    return {mode, origin, scale};
}
