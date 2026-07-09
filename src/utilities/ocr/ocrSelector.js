import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { runRapidOcr } from './backend.js';
import { splitBlocks } from './ocrText.js';
import { groupBlocksToLines } from './ocrLines.js';
import { SelectionCornerButton } from '../../ui/widgets/selectionCornerButton.js';
import { getCaptureContext } from '../../capture/captureContext.js';
import { N_ } from '../../platform/i18n.js';

export class OcrSelector {
    constructor({ toolbar, canvases, extensionPath, screenshotFn }) {
        this._toolbar = toolbar;
        this._canvases = canvases;
        this._extensionPath = extensionPath;
        this._screenshotFn = screenshotFn;
        this._systemFont = null;

        this._blockData = null;
        this._overlay = null;
        this._cacheResult = null;
        this._highlightWidgets = [];
        this._selectedSet = new Set();
        this._selIdx0 = -1;
        this._cursorFrozen = false;
        this._rectMode = false;
        this._selBorder = null;
        this._copyBtn = null;
        this._rectWidget = null;
        this._rectStart = null;
        this._rectEnd = null;
        this._toast = null;
    }

    get isActive() {
        return this._blockData !== null;
    }

    clearCache() {
        this._cacheResult = null;
    }

    handleKey(event) {
        if (!this.isActive) return null;

        const ctrl = event.get_state() & Clutter.ModifierType.CONTROL_MASK;
        if (!ctrl) return null;

        const sym = event.get_key_symbol();
        if (sym === Clutter.KEY_c) {
            this.copySelected();
            return true;
        }
        if (sym === Clutter.KEY_a) {
            this.selectAll();
            return true;
        }
        return null;
    }

    async activate() {
        if (this._blockData) return;

        try {
            this._toolbar.setOcrProcessing();

            for (const canvas of this._canvases) canvas.hide();

            const ctx = getCaptureContext();
            const originX = ctx.origin.x;
            const originY = ctx.origin.y;
            let captureMonitor = null;

            if (ctx.mode === 'screen') {
                const idx = Main.screenshotUI._screenSelectors?.findIndex((s) => s.checked);
                if (idx >= 0) captureMonitor = Main.layoutManager.monitors[idx];
            }

            if (!captureMonitor)
                captureMonitor = global.display.get_monitor_geometry(global.display.get_primary_monitor());

            if (!this._systemFont) {
                try {
                    const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                    this._systemFont = iface.get_string('font-name');
                } catch {
                    this._systemFont = 'Sans';
                }
            }

            let blocks;
            let scale;

            if (this._cacheResult) {
                blocks = this._cacheResult.blocks;
                scale = this._cacheResult.scale;
            } else {
                const { file, scale: s } = await this._screenshotFn();
                if (!file) throw new Error('Screenshot capture failed');
                scale = s || 1;
                try {
                    blocks = await runRapidOcr(file, this._extensionPath);
                    this._cacheResult = { blocks, scale };
                } finally {
                    try {
                        file.delete(null);
                    } catch {}
                }
            }

            this._storeBlocks(blocks, originX, originY, scale, captureMonitor);
            this._toolbar.setOcrDone();
        } catch (e) {
            console.error(`OCR failed: ${e.message}`);
            this._toolbar.setOcrIdle();
        }
    }

    deactivate(restoreCanvas = false) {
        this._clearHighlight();
        this._hideRect();
        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
        this._cornerBtn?.hide();
        this._blockData = null;
        if (restoreCanvas) {
            for (const canvas of this._canvases) canvas.show();
        }
        this._toolbar.setOcrIdle();
    }

    selectAll() {
        if (!this._blockData || this._blockData.length === 0) {
            this._showToast('No OCR text available');
            return;
        }
        this._selectedSet.clear();
        for (let i = 0; i < this._blockData.length; i++) this._selectedSet.add(i);
        this._renderHighlights();
    }

    copySelected() {
        if (!this._selectedSet || this._selectedSet.size === 0) {
            this._showToast('No text selected');
            return;
        }
        const indices = [...this._selectedSet].sort((a, b) => a - b);
        const blocks = indices.map((i) => this._blockData[i]);
        const text = groupBlocksToLines(blocks).join('\n');

        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        this._showToast(`Copied ${indices.length} block${indices.length > 1 ? 's' : ''}`);
    }

    destroy() {
        this.deactivate(false);
        if (this._cornerBtn) {
            this._cornerBtn.destroy();
            this._cornerBtn = null;
        }
        if (this._toast) {
            this._toast.destroy();
            this._toast = null;
        }
    }

    _splitBlocks(blocks) {
        return splitBlocks(blocks, this._systemFont);
    }

    _storeBlocks(blocks, originX, originY, captureScale, captureMonitor) {
        this.deactivate(false);

        const splitBlocks = this._splitBlocks(blocks);

        this._blockData = splitBlocks.map((block) => {
            const xs = block.box.map((p) => p[0]);
            const ys = block.box.map((p) => p[1]);
            const minX = Math.min(...xs) / captureScale + originX;
            const minY = Math.min(...ys) / captureScale + originY;
            const maxX = Math.max(...xs) / captureScale + originX;
            const maxY = Math.max(...ys) / captureScale + originY;
            return {
                text: block.text,
                score: block.score,
                minX,
                minY,
                maxX,
                maxY,
                parentIdx: block.parentIdx,
                hasSpaceBefore: block.hasSpaceBefore,
            };
        });

        this._blockData.sort((a, b) => {
            const dy = Math.abs(a.minY - b.minY);
            if (dy < (a.maxY - a.minY) * 0.6) return a.minX - b.minX;
            return a.minY - b.minY;
        });

        this._selectedSet = new Set();
        this._selIdx0 = -1;
        this._highlightWidgets = [];

        const primaryBin = Main.screenshotUI._primaryMonitorBin;
        const overlay = new St.Widget({ reactive: true });
        overlay.set_cursor_type(Clutter.CursorType.CROSSHAIR);
        overlay.set_position(captureMonitor.x, captureMonitor.y);
        overlay.set_size(captureMonitor.width, captureMonitor.height);
        if (primaryBin) {
            primaryBin.add_child(overlay);
            primaryBin.set_child_at_index(overlay, 0);
        }
        this._overlay = overlay;

        overlay.connect('button-press-event', (_a, event) => {
            this._cursorFrozen = true;
            const [sx, sy] = event.get_coords();
            const idx = this._findBlockAt(sx, sy);
            if (idx >= 0) {
                this._selIdx0 = idx;
                this._updateSelection(idx, idx);
            } else if (this._blockData) {
                this._rectMode = true;
                this._rectStart = { x: sx, y: sy };
                this._rectEnd = { x: sx, y: sy };
                this._clearHighlight();
                this._showRect();
            }
            return Clutter.EVENT_STOP;
        });

        overlay.connect('motion-event', (_a, event) => {
            const [sx, sy] = event.get_coords();
            if (!this._cursorFrozen) {
                overlay.set_cursor_type(
                    this._findBlockAt(sx, sy) >= 0 ? Clutter.CursorType.TEXT : Clutter.CursorType.CROSSHAIR,
                );
            }
            if (this._selIdx0 >= 0) {
                const idx = this._findBlockAt(sx, sy);
                if (idx >= 0) this._updateSelection(this._selIdx0, idx);
            } else if (this._rectMode) {
                this._rectEnd = { x: sx, y: sy };
                this._showRect();
            }
            return Clutter.EVENT_STOP;
        });

        overlay.connect('button-release-event', () => {
            if (this._rectMode) {
                this._rectMode = false;
                if (this._rectStart && this._rectEnd) {
                    const sx = Math.min(this._rectStart.x, this._rectEnd.x);
                    const sy = Math.min(this._rectStart.y, this._rectEnd.y);
                    const ex = Math.max(this._rectStart.x, this._rectEnd.x);
                    const ey = Math.max(this._rectStart.y, this._rectEnd.y);
                    if (ex - sx > 3 || ey - sy > 3) {
                        this._selectBlocksInRect(sx, sy, ex, ey);
                    }
                }
                this._hideRect();
                this._rectStart = null;
                this._rectEnd = null;
            }
            this._selIdx0 = -1;
            this._cursorFrozen = false;
            return Clutter.EVENT_STOP;
        });
    }

    _findBlockAt(stageX, stageY) {
        for (let i = 0; i < this._blockData.length; i++) {
            const b = this._blockData[i];
            const MARGIN = 10;
            if (
                stageX >= b.minX - MARGIN &&
                stageX <= b.maxX + MARGIN &&
                stageY >= b.minY - MARGIN &&
                stageY <= b.maxY + MARGIN
            )
                return i;
        }
        return -1;
    }

    _updateSelection(idxA, idxB) {
        this._clearHighlight();
        const lo = Math.min(idxA, idxB);
        const hi = Math.max(idxA, idxB);
        for (let i = lo; i <= hi; i++) this._selectedSet.add(i);
        this._renderHighlights();
    }

    _renderHighlights() {
        for (const w of this._highlightWidgets) w.destroy();
        this._highlightWidgets = [];
        this._hideSelBorder();
        this._hideCopyBtn();

        if (this._selectedSet.size === 0) return;

        let uMinX = Infinity,
            uMinY = Infinity,
            uMaxX = -Infinity,
            uMaxY = -Infinity;

        for (const i of this._selectedSet) {
            const b = this._blockData[i];
            const hl = new St.Widget({ style_class: 'gradia-ocr-highlight' });
            hl.set_position(b.minX, b.minY);
            hl.set_size(b.maxX - b.minX, b.maxY - b.minY);
            Main.screenshotUI.add_child(hl);
            Main.screenshotUI.remove_child(hl);
            Main.screenshotUI.add_child(hl);
            this._highlightWidgets.push(hl);

            if (b.minX < uMinX) uMinX = b.minX;
            if (b.minY < uMinY) uMinY = b.minY;
            if (b.maxX > uMaxX) uMaxX = b.maxX;
            if (b.maxY > uMaxY) uMaxY = b.maxY;
        }

        const PAD = 8;
        const primaryBin = Main.screenshotUI._primaryMonitorBin;
        if (!primaryBin) return;

        const bx = uMinX - PAD;
        const by = uMinY - PAD;
        const bw = uMaxX - uMinX + PAD * 2;
        const bh = uMaxY - uMinY + PAD * 2;

        const border = new St.DrawingArea({ style: 'background-color: transparent;' });
        border.set_position(bx, by);
        border.set_size(Math.max(bw, 2), Math.max(bh, 2));
        border.connect('repaint', (area) => {
            const cr = area.get_context();
            cr.setSourceRGBA(1.0, 1.0, 1.0, 0.9);
            cr.setLineWidth(1.5);
            cr.setDash([5, 4], 0);
            cr.rectangle(1, 1, bw - 2, bh - 2);
            cr.stroke();
            cr.$dispose();
        });
        Main.screenshotUI.add_child(border);
        border.queue_repaint();
        this._selBorder = border;

        this._showCopyBtn(uMaxX, uMinY, uMaxY, primaryBin);
    }

    _showCopyBtn(uMaxX, uMinY, uMaxY, primaryBin) {
        if (!primaryBin) return;
        if (!this._cornerBtn) {
            this._cornerBtn = new SelectionCornerButton({
                parentBin: primaryBin,
                iconName: 'edit-copy-symbolic',
                iconSize: 14,
                styleClass: 'gradia-selection-trash gradia-circle-button',
                onClick: () => this.copySelected(),
                tooltipText: N_('Copy selected text'),
            });
        }
        this._cornerBtn.show(uMaxX + PAD, uMinY - PAD - 8);
    }

    _hideCopyBtn() {
        this._cornerBtn?.hide();
    }

    _hideSelBorder() {
        if (this._selBorder) {
            this._selBorder.destroy();
            this._selBorder = null;
        }
    }

    _clearHighlight() {
        for (const w of this._highlightWidgets) w.destroy();
        this._highlightWidgets = [];
        this._selectedSet.clear();
        this._hideSelBorder();
        this._hideCopyBtn();
    }

    _showRect() {
        if (!this._rectStart || !this._rectEnd) return;
        const x = Math.min(this._rectStart.x, this._rectEnd.x);
        const y = Math.min(this._rectStart.y, this._rectEnd.y);
        const w = Math.abs(this._rectEnd.x - this._rectStart.x);
        const h = Math.abs(this._rectEnd.y - this._rectStart.y);
        if (w < 3 && h < 3) {
            this._hideRect();
            return;
        }
        if (!this._rectWidget) {
            this._rectWidget = new St.Widget({
                style_class: 'gradia-ocr-sel-rect',
            });
            Main.screenshotUI.add_child(this._rectWidget);
            Main.screenshotUI.remove_child(this._rectWidget);
            Main.screenshotUI.add_child(this._rectWidget);
        }
        this._rectWidget.set_position(x, y);
        this._rectWidget.set_size(w, h);
    }

    _hideRect() {
        if (this._rectWidget) {
            this._rectWidget.destroy();
            this._rectWidget = null;
        }
    }

    _selectBlocksInRect(sx, sy, ex, ey) {
        this._clearHighlight();
        for (let i = 0; i < this._blockData.length; i++) {
            const b = this._blockData[i];
            if (b.minX < ex && b.maxX > sx && b.minY < ey && b.maxY > sy) {
                this._selectedSet.add(i);
            }
        }
        this._renderHighlights();
    }

    _showToast(text) {
        const monitor = global.display.get_monitor_geometry(global.display.get_primary_monitor());
        if (!this._toast) {
            this._toast = new St.Label({
                text,
                style: 'background: rgba(0,0,0,0.7); color: white; border-radius: 6px; padding: 6px 12px; font-size: 13px;',
                x_expand: false,
                y_expand: false,
            });
            Main.screenshotUI._primaryMonitorBin.add_child(this._toast);
        } else {
            this._toast.text = text;
        }
        this._toast.set_position(
            Math.round((monitor.width - this._toast.width) / 2),
            Math.round((monitor.height - this._toast.height) / 2) + 80,
        );
        this._toast.opacity = 255;
        this._toast.ease({
            opacity: 0,
            duration: 3000,
            delay: 1500,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }
}
