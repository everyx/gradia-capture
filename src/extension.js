import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Gio from 'gi://Gio';

import { Toolbar, TOOLS } from './topBar.js';
import { GradiaSettings } from './settings.js';
import { captureAndStoreScreenshot } from './screenshotStore.js';

const MAX_CANVAS_WIDTH = 1920;
const MAX_CANVAS_HEIGHT = 1080;

export function setAreaSelectorHandlesVisible(selector, visible) {
    const handles = [
        selector?._topLeftHandle,
        selector?._topRightHandle,
        selector?._bottomLeftHandle,
        selector?._bottomRightHandle,
    ].filter(h => h != null);

    for (const handle of handles) {
        if (visible)
            handle.show();
        else
            handle.hide();
    }
}

function getToolDef(id) {
    return TOOLS.find(t => t.id === id) ?? null;
}

const DrawingCanvas = GObject.registerClass(
    class DrawingCanvas extends St.DrawingArea {
        _init(params) {
            super._init({
                reactive: false,
                x_expand: true,
                y_expand: true,
                ...params,
            });

            this._strokes = [];
            this._currentStroke = null;
            this._strokeColor = '#000000';
            this._toolId = 'freehand';
            this._strokeWidth = 3;
            this._drawing = false;
            this._dragButton = 0;
            this._dragGrab = null;
            this._stampCounter = 1;

            this._scaleX = 1;
            this._scaleY = 1;

            this.connect('notify::allocation', () => this._updateScale());
        }

        get strokes() { return this._strokes; }

        setColor(hex) { this._strokeColor = hex; }
        setTool(id) { this._toolId = id; }
        setStrokeWidth(w) { this._strokeWidth = w; }

        clear() {
            this._strokes = [];
            this._currentStroke = null;
            this._stampCounter = 1;
            this.queue_repaint();
        }

        undo() {
            if (this._strokes.length > 0) {
                this._strokes.pop();
                this.queue_repaint();
            }
        }

        hasStrokes() { return this._strokes.length > 0; }

        _updateScale() {
            const alloc = this.allocation;
            const stageW = alloc.get_width();
            const stageH = alloc.get_height();

            this._scaleX = stageW > 0 ? Math.max(1, stageW / MAX_CANVAS_WIDTH) : 1;
            this._scaleY = stageH > 0 ? Math.max(1, stageH / MAX_CANVAS_HEIGHT) : 1;
        }

        _stageToLocal(stageX, stageY) {
            const [ok, localX, localY] = this.transform_stage_point(stageX, stageY);
            if (!ok) return null;
            return { x: localX, y: localY };
        }

        _startDrawing(stageX, stageY) {
            const tool = getToolDef(this._toolId);
            if (!tool?.isDrawing)
                return;

            const extra = tool.beginStroke?.() ?? {};
            this._currentStroke = {
                color: this._strokeColor,
                toolId: this._toolId,
                strokeWidth: this._strokeWidth,
                stagePoints: [{ x: stageX, y: stageY }],
                ...extra,
            };

            if (tool.isStamp) {
                this._currentStroke.counter = this._stampCounter;
                this._finishStamp();
                return;
            }

            this._drawing = true;
            this._dragGrab = global.stage.grab(this);
        }

        _finishStamp() {
            if (this._currentStroke)
                this._strokes.push(this._currentStroke);
            this._stampCounter++;
            this._currentStroke = null;
            this.queue_repaint();
        }

        _updateDrawing(stageX, stageY) {
            if (!this._drawing)
                return;

            const tool = getToolDef(this._toolId);

            if (tool?.id === 'freehand') {
                this._currentStroke.stagePoints.push({ x: stageX, y: stageY });
            } else {
                if (this._currentStroke.stagePoints.length === 1)
                    this._currentStroke.stagePoints.push({ x: stageX, y: stageY });
                else
                    this._currentStroke.stagePoints[this._currentStroke.stagePoints.length - 1] = { x: stageX, y: stageY };
            }

            this.queue_repaint();
        }

        _endDrawing() {
            if (this._currentStroke && this._currentStroke.stagePoints.length > 1)
                this._strokes.push(this._currentStroke);

            this._currentStroke = null;
            this._drawing = false;
            this._dragButton = 0;

            if (this._dragGrab) {
                this._dragGrab.dismiss();
                this._dragGrab = null;
            }

            this.queue_repaint();
        }

        commitTextStroke(stroke) {
            if (stroke)
                this._strokes.push(stroke);
            this.queue_repaint();
        }

        vfunc_button_press_event(event) {
            if (this._dragButton)
                return Clutter.EVENT_PROPAGATE;

            const button = event.get_button();
            if (button !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;

            this._dragButton = button;
            const [stageX, stageY] = event.get_coords();
            this._startDrawing(stageX, stageY);
            return Clutter.EVENT_STOP;
        }

        vfunc_button_release_event(event) {
            if (event.get_button() !== this._dragButton)
                return Clutter.EVENT_PROPAGATE;

            this._endDrawing();
            return Clutter.EVENT_STOP;
        }

        vfunc_motion_event(event) {
            if (!this._drawing)
                return Clutter.EVENT_PROPAGATE;

            const [stageX, stageY] = event.get_coords();
            this._updateDrawing(stageX, stageY);
            return Clutter.EVENT_STOP;
        }

        vfunc_touch_event(event) {
            const eventType = event.type();

            if (eventType === Clutter.EventType.TOUCH_BEGIN) {
                if (this._dragButton)
                    return Clutter.EVENT_PROPAGATE;

                this._dragButton = 1;
                const [stageX, stageY] = event.get_coords();
                this._startDrawing(stageX, stageY);
                return Clutter.EVENT_STOP;
            } else if (eventType === Clutter.EventType.TOUCH_UPDATE) {
                if (!this._drawing)
                    return Clutter.EVENT_PROPAGATE;
                const [stageX, stageY] = event.get_coords();
                this._updateDrawing(stageX, stageY);
                return Clutter.EVENT_STOP;
            } else if (eventType === Clutter.EventType.TOUCH_END ||
                eventType === Clutter.EventType.TOUCH_CANCEL) {
                if (!this._drawing)
                    return Clutter.EVENT_PROPAGATE;
                this._endDrawing();
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        vfunc_repaint() {
            const cr = this.get_context();

            const allStrokes = [...this._strokes];
            if (this._currentStroke)
                allStrokes.push(this._currentStroke);

            for (const stroke of allStrokes) {
                const tool = getToolDef(stroke.toolId);
                if (!tool?.render)
                    continue;

                const localPoints = stroke.stagePoints.map(sp => this._stageToLocal(sp.x, sp.y)).filter(p => p !== null);

                tool.render(cr, {
                    color: stroke.color,
                    points: localPoints,
                    counter: stroke.counter,
                    text: stroke.text,
                }, stroke.strokeWidth);
            }

            cr.$dispose();
        }
    });

const DrawingInputOverlay = GObject.registerClass(
    class DrawingInputOverlay extends St.Widget {
        _init(canvas, params) {
            super._init({
                reactive: false,
                x_expand: true,
                y_expand: true,
                ...params,
            });
            this._canvas = canvas;
        }

        vfunc_button_press_event(event) {
            return this._canvas.vfunc_button_press_event(event);
        }

        vfunc_button_release_event(event) {
            return this._canvas.vfunc_button_release_event(event);
        }

        vfunc_motion_event(event) {
            return this._canvas.vfunc_motion_event(event);
        }

        vfunc_touch_event(event) {
            return this._canvas.vfunc_touch_event(event);
        }
    });

export default class GradiaCompanion extends Extension {
    enable() {
        this._originalOpen = Main.screenshotUI.open.bind(Main.screenshotUI);
        this._originalSaveScreenshot = Main.screenshotUI._saveScreenshot.bind(Main.screenshotUI);
        this._gradiaSettings = new GradiaSettings(this);
        this._toolbar = null;
        this._canvases = [];
        this._overlays = [];
        this._textEntry = null;
        this._pendingTextStroke = null;

        const self = this;

        Main.screenshotUI.open = async function (...args) {
            const result = await self._originalOpen(...args);
            self._ensureUI();
            return result;
        };

        Main.screenshotUI._saveScreenshot = async function () {
          const ui = Main.screenshotUI;
          self._commitTextEntry();
          const hasStrokes = self._canvases.some(c => c.hasStrokes());
          if (!hasStrokes)
              return self._originalSaveScreenshot();

          const strokeData = self._buildStrokeData();
          let file = null;

          if (ui._selectionButton.checked || ui._screenButton.checked) {
              const content = ui._stageScreenshot.get_content();
              if (!content)
                  return;

              const texture = content.get_texture();
              const geometry = ui._getSelectedGeometry(true);
              let cursorTexture = ui._cursor.content?.get_texture();
              if (!ui._cursor.visible)
                  cursorTexture = null;

              const cursor = {
                  texture: cursorTexture ?? null,
                  x: ui._cursor.x * ui._scale,
                  y: ui._cursor.y * ui._scale,
                  scale: ui._cursorScale,
              };

              file = await captureAndStoreScreenshot(
                  texture,
                  geometry,
                  ui._scale,
                  cursor,
                  (bytes, pixbuf) => self._compositeStrokesOntoPixbuf(bytes, pixbuf, strokeData)
              );
          } else if (ui._windowButton.checked) {
              return self._originalSaveScreenshot();
          }

          if (file)
              ui.emit('screenshot-taken', file);
      };

        this._closedId = Main.screenshotUI.connect('closed', () => {
            self._removeUI();
        });
    }

    disable() {
        if (this._originalOpen) {
            Main.screenshotUI.open = this._originalOpen;
            this._originalOpen = null;
        }

        if (this._originalSaveScreenshot) {
            Main.screenshotUI._saveScreenshot = this._originalSaveScreenshot;
            this._originalSaveScreenshot = null;
        }

        if (this._closedId) {
            Main.screenshotUI.disconnect(this._closedId);
            this._closedId = null;
        }

        this._gradiaSettings.destroy();
        this._gradiaSettings = null;

        this._removeUI();
    }

    _compositeStrokesOntoPixbuf(bytes, pixbuf, data) {
        const { selX, selY, selW, selH, strokes, stageScale } = data;
        if (selW <= 0 || selH <= 0)
            return null;

        const imgWidth = pixbuf.get_width();
        const imgHeight = pixbuf.get_height();
        const scaleX = imgWidth / selW;
        const scaleY = imgHeight / selH;

        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, imgWidth, imgHeight);
        const cr = new Cairo.Context(surface);
        imports.gi.Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
        cr.paint();

        for (const stroke of strokes) {
            const tool = TOOLS.find(t => t.id === stroke.toolId);
            if (!tool?.render)
                continue;

            const converted = stroke.stagePoints.map(p => ({
                x: (p.x / stageScale - selX) * scaleX,
                y: (p.y / stageScale - selY) * scaleY,
            }));

            const lw = stroke.strokeWidth * ((scaleX + scaleY) / 2);

            tool.render(cr, {
                color: stroke.color,
                points: converted,
                counter: stroke.counter,
                text: stroke.text,
            }, lw);
        }

        cr.$dispose();

        const newPixbuf = imports.gi.Gdk.pixbuf_get_from_surface(surface, 0, 0, imgWidth, imgHeight);
        if (!newPixbuf)
            return null;

        const pngStream = Gio.MemoryOutputStream.new_resizable();
        newPixbuf.save_to_streamv(pngStream, 'png', [], [], null);
        pngStream.close(null);

        return { bytes: pngStream.steal_as_bytes(), pixbuf: newPixbuf };
    }

    _spawnTextEntry(stageX, stageY) {
        if (this._textEntry) {
            this._commitTextEntry();
            return;
        }

        const ui = Main.screenshotUI;
        const primaryBin = ui._primaryMonitorBin;
        if (!primaryBin)
            return;

        const [ok, localX, localY] = primaryBin.transform_stage_point(stageX, stageY);
        if (!ok)
            return;

        const bins = ui._monitorBins?.length > 0
            ? ui._monitorBins
            : (primaryBin ? [primaryBin] : []);

        this._textTargetCanvas = this._canvases[0] ?? null;
        for (let i = 0; i < bins.length; i++) {
            const [binOk, bx, by] = bins[i].transform_stage_point(stageX, stageY);
            if (!binOk) continue;
            const alloc = bins[i].allocation;
            const w = alloc.get_width();
            const h = alloc.get_height();
            if (bx >= 0 && bx < w && by >= 0 && by < h) {
                this._textTargetCanvas = this._canvases[i];
                break;
            }
        }

        this._pendingTextStroke = {
            color: this._toolbar.selectedColor,
            toolId: 'text',
            strokeWidth: this._toolbar.lineWidth,
            stagePoints: [{ x: stageX, y: stageY }],
            text: '',
        };

        const fontSize = Math.max(8, Math.round(this._toolbar.lineWidth * 3));

        const entry = new St.Entry({
            style_class: 'gradia-text-entry',
            reactive: true,
            can_focus: true,
        });

        entry.style = `
            color: ${this._toolbar.selectedColor};
            caret-color: ${this._toolbar.selectedColor};
            font-size: ${fontSize}px;
            font-family: "Sans";
        `;

        entry.set_x_expand(false);
        entry.set_width(fontSize * 4);
        primaryBin.add_child(entry);

        const allocId = entry.connect('notify::allocation', () => {
            entry.disconnect(allocId);

            const node = entry.get_theme_node();
            const paddingTop = node.get_padding(St.Side.TOP);
            const paddingLeft = node.get_padding(St.Side.LEFT);

            entry.set_position(
                Math.round(localX - paddingLeft),
                Math.round(localY - paddingTop)
            );
        });

        const clutterText = entry.get_clutter_text();

        clutterText.connect('text-changed', () => {
            const [, naturalWidth] = clutterText.get_preferred_width(-1);
            entry.set_width(Math.max(fontSize * 4, naturalWidth + fontSize));
        });

        clutterText.connect('key-press-event', (_actor, event) => {
            const sym = event.get_key_symbol();
            if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter)
                return this._commitTextEntry(), Clutter.EVENT_STOP;
            if (sym === Clutter.KEY_Escape)
                return this._cancelTextEntry(), Clutter.EVENT_STOP;
            return Clutter.EVENT_PROPAGATE;
        });

        this._committingText = false;
        clutterText.connect('notify::has-key-focus', () => {
            if (!clutterText.has_key_focus() && !this._committingText)
                this._commitTextEntry();
        });

        entry.grab_key_focus();
        this._textEntry = entry;
    }

    _commitTextEntry() {
        if (!this._textEntry)
            return;

        this._committingText = true;
        const text = this._textEntry.get_text()?.trim() ?? '';
        if (text.length > 0 && this._pendingTextStroke) {
            this._pendingTextStroke.text = text;
            this._textTargetCanvas?.commitTextStroke(this._pendingTextStroke);
        }

        this._textEntry.destroy();
        this._textEntry = null;
        this._pendingTextStroke = null;
        this._textTargetCanvas = null;

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._committingText = false;
             Main.screenshotUI.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelTextEntry() {
        if (!this._textEntry)
            return;

        this._committingText = true;
        this._textEntry.destroy();
        this._textEntry = null;
        this._pendingTextStroke = null;
        this._textTargetCanvas = null;

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._committingText = false;
            Main.screenshotUI.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _buildStrokeData() {
        const ui = Main.screenshotUI;

        let selX = 0, selY = 0, selW = 0, selH = 0;

        if (ui._selectionButton.checked) {
            [selX, selY, selW, selH] = ui._areaSelector.getGeometry();
        } else if (ui._screenButton.checked) {
            const index = ui._screenSelectors.findIndex(s => s.checked);
            const monitor = Main.layoutManager.monitors[index];
            selX = monitor.x;
            selY = monitor.y;
            selW = monitor.width;
            selH = monitor.height;
        } else if (ui._windowButton.checked) {
            const window = ui._windowSelectors
                .flatMap(sel => sel.windows())
                .find(win => win.checked);

            if (window) {
                const box = window.boundingBox;
                selX = box.x;
                selY = box.y;
                selW = box.width;
                selH = box.height;
            }
        }

        const strokes = this._canvases.flatMap(c =>
            c.strokes.map(s => ({
                color: s.color,
                toolId: s.toolId,
                counter: s.counter,
                strokeWidth: s.strokeWidth,
                text: s.text,
                stagePoints: s.stagePoints.map(p => ({ x: p.x, y: p.y })),
            }))
        );

        return {
            selX, selY, selW, selH,
            strokes,
            stageScale: global.stage.scale_factor || 1,
        };
    }

    _isDrawingTool(id) {
        return getToolDef(id)?.isDrawing ?? false;
    }

    _setTool(id) {
        if (id !== 'text')
            this._commitTextEntry();

        const drawing = this._isDrawingTool(id);

        for (const canvas of this._canvases)
            canvas.setTool(id);

        for (const overlay of this._overlays)
            overlay.reactive = drawing;

        this._updateAreaSelectorState(id);
    }

    _updateAreaSelectorState(id) {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        if (!Main.screenshotUI._selectionButton.checked)
            return;

        const drawing = this._isDrawingTool(id);

        if (drawing) {
            selector.reactive = false;
            setAreaSelectorHandlesVisible(selector, false);
        } else {
            selector.reactive = true;
            selector._areaIndicator?.show();
            setAreaSelectorHandlesVisible(selector, true);
        }
    }

    _isWindowMode() {
        return Main.screenshotUI._windowButton.checked;
    }

    _isRecordingMode() {
        return Main.screenshotUI._castButton?.checked ?? false;
    }

    _updateVisibilityForMode() {
        const windowMode = this._isWindowMode();
        const recordingMode = this._isRecordingMode();
        const show = !windowMode && !recordingMode;

        if (this._toolbar)
            this._toolbar.visible = show;

        for (const canvas of this._canvases)
            canvas.visible = show;

        for (const overlay of this._overlays)
            overlay.visible = show;

        if (show)
            this._updateAreaSelectorState(this._toolbar?.selectedTool ?? 'select');
    }

    _connectDragOpacity() {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        this._dragStartedId = selector.connect('drag-started', () => {
            this._toolbar?.ease({
                opacity: 100,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });

        this._dragEndedId = selector.connect('drag-ended', () => {
            this._toolbar?.ease({
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
    }

    _disconnectDragOpacity() {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        if (this._dragStartedId) {
            selector.disconnect(this._dragStartedId);
            this._dragStartedId = null;
        }
        if (this._dragEndedId) {
            selector.disconnect(this._dragEndedId);
            this._dragEndedId = null;
        }
    }

    _ensureUI() {
        if (this._toolbar)
            return;

        const ui = Main.screenshotUI;

        this._canvases = [];
        this._overlays = [];

        const monitorBins = ui._monitorBins ?? [];
        const binsToUse = monitorBins.length > 0
            ? monitorBins
            : (ui._primaryMonitorBin ? [ui._primaryMonitorBin] : []);

        for (const bin of binsToUse) {
            const canvas = new DrawingCanvas({
                style: 'background-color: transparent;',
            });
            canvas.add_constraint(new Clutter.BindConstraint({
                source: bin,
                coordinate: Clutter.BindCoordinate.ALL,
            }));
            ui.insert_child_below(canvas, ui._areaSelector);
            this._canvases.push(canvas);
            const overlay = new DrawingInputOverlay(canvas, {
                style: 'background-color: transparent;',
            });

            overlay.connect('button-press-event', (_actor, event) => {
                if (this._toolbar?.selectedTool !== 'text')
                    return Clutter.EVENT_PROPAGATE;

                const [stageX, stageY] = event.get_coords();
                this._spawnTextEntry(stageX, stageY);
                return Clutter.EVENT_STOP;
            });

            bin.add_child(overlay);
            this._overlays.push(overlay);
        }

        const primaryBin = ui._primaryMonitorBin;
        if (!primaryBin)
            return;

        this._toolbar = new Toolbar({ extensionPath: this.path, gradiaSettings: this._gradiaSettings });

        this._toolbar.connect('tool-changed', (_toolbar, id) => {
            this._setTool(id);
        });

        this._toolbar.connect('color-changed', (_toolbar, hex) => {
            for (const canvas of this._canvases)
                canvas.setColor(hex);
        });

        this._toolbar.connect('line-width-changed', (_toolbar, width) => {
            for (const canvas of this._canvases)
                canvas.setStrokeWidth(width);
        });

        this._toolbar.connect('undo', () => {
            if (this._textEntry) {
                this._cancelTextEntry();
                return;
            }
            for (let i = this._canvases.length - 1; i >= 0; i--) {
                if (this._canvases[i].hasStrokes()) {
                    this._canvases[i].undo();
                    break;
                }
            }
        });

        this._toolbar.connect('clear', () => {
            this._cancelTextEntry();
            for (const canvas of this._canvases)
                canvas.clear();
        });

        for (const canvas of this._canvases) {
            canvas.setColor(this._toolbar.selectedColor);
            canvas.setTool(this._toolbar.selectedTool);
            canvas.setStrokeWidth(this._toolbar.lineWidth);
        }

        primaryBin.add_child(this._toolbar);

        this._keyPressId = Main.screenshotUI.connect('key-press-event', (_actor, event) => {
            const sym = event.get_key_symbol();
            const mods = event.get_state();
            const ctrl = mods & Clutter.ModifierType.CONTROL_MASK;

            if (ctrl && sym === Clutter.KEY_z) {
                this._toolbar.emit('undo');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._windowButtonId = ui._windowButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });
        this._selectionButtonId = ui._selectionButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });
        this._screenButtonId = ui._screenButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });
        this._castButtonId = ui._castButton.connect('notify::checked', () => {
            this._updateVisibilityForMode();
        });

        this._connectDragOpacity();

        this._setTool('select');
        this._updateVisibilityForMode();
    }

    _removeUI() {
        this._cancelTextEntry();

        const ui = Main.screenshotUI;

        if (this._keyPressId) {
            Main.screenshotUI.disconnect(this._keyPressId);
            this._keyPressId = null;
        }

        if (this._windowButtonId) {
            ui._windowButton.disconnect(this._windowButtonId);
            this._windowButtonId = null;
        }
        if (this._selectionButtonId) {
            ui._selectionButton.disconnect(this._selectionButtonId);
            this._selectionButtonId = null;
        }
        if (this._screenButtonId) {
            ui._screenButton.disconnect(this._screenButtonId);
            this._screenButtonId = null;
        }
        if (this._castButtonId) {
            ui._castButton.disconnect(this._castButtonId);
            this._castButtonId = null;
        }

        this._disconnectDragOpacity();

        const selector = ui._areaSelector;
        if (selector) {
            selector.reactive = true;
            setAreaSelectorHandlesVisible(selector, true);
        }

        for (const overlay of this._overlays)
            overlay.destroy();
        this._overlays = [];

        for (const canvas of this._canvases)
            canvas.destroy();
        this._canvases = [];

        if (this._toolbar) {
            this._toolbar.destroy();
            this._toolbar = null;
        }
    }
}
