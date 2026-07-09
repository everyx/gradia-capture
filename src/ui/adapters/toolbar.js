import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import { TOOLS, getToolDef } from '../../annotation/tools/index.js';
import { attachTooltip } from '../../platform/tooltip.js';
import { _ } from '../../platform/i18n.js';
import { ToolPropsMenu, SIZE_MIN, SIZE_MAX, BLUR_SIZE_MAX } from './toolPropsMenu.js';
import { TOOLBAR_GROUPS, SEP } from './toolbarLayout.js';

function makeIcon(spec, extensionPath = '') {
    if (spec.startsWith('/') || spec.startsWith('icons/')) {
        const fullPath = spec.startsWith('/') ? spec : `${extensionPath}/${spec}`;
        return new St.Icon({ gicon: Gio.Icon.new_for_string(fullPath), style: 'icon-size: 16px;' });
    }
    return new St.Icon({ icon_name: spec, style: 'icon-size: 16px;' });
}

export const Toolbar = GObject.registerClass(
    {
        Signals: {
            'tool-changed': { param_types: [GObject.TYPE_STRING] },
            'tool-property-changed': { param_types: [GObject.TYPE_STRING] },
            undo: {},
            clear: {},
            'ocr-trigger': {},
        },
    },
    class Toolbar extends St.BoxLayout {
        _init(params = {}) {
            const { extensionPath = '', gradiaSettings = null, hasSelection, hasVisibleCanvas, ...rest } = params;
            this._extensionPath = extensionPath;
            this._lastReposition = null;

            super._init({
                style_class: 'screenshot-ui-panel gradia-toolbar',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.START,
                x_expand: false,
                y_expand: false,
                reactive: true,
                ...rest,
            });

            this._selectedTool = TOOLS[0].id;
            this._toolButtons = [];
            this._propsToolBtn = null;
            this._activeTool = null;
            this._activePropsTool = null;
            this._popupStagePressIds = new Map();
            this._hasSelection = hasSelection ?? (() => false);
            this._hasVisibleCanvas = hasVisibleCanvas ?? (() => true);
            this._groupButtons = {};

            if (gradiaSettings) {
                const changed = (key, value) => this.emit('tool-property-changed', JSON.stringify({ [key]: value }));
                for (const t of TOOLS) {
                    if (t.isDrawing) {
                        t._attach(gradiaSettings, changed);
                        t.load();
                    }
                }
            }

            this._buildFromLayout();

            this._toolPropsMenu = new ToolPropsMenu({ extensionPath: this._extensionPath });
            this._wirePropsMenu();

            this.connect('notify::visible', () => {
                if (!this.visible) this._hidePopup(this._toolPropsMenu);
            });
            this.connect('destroy', () => this._onDestroy());
        }

        _onDestroy() {
            const popup = this._toolPropsMenu;
            if (popup) {
                const id = this._popupStagePressIds.get(popup);
                if (id !== undefined) {
                    global.stage.disconnect(id);
                    this._popupStagePressIds.delete(popup);
                }
            }
            this._toolPropsMenu = null;
        }

        _wirePropsMenu() {
            const conn = (signal, handler) => this._toolPropsMenu.connect(signal, handler);

            conn('color-changed', (_m, hex) => {
                if (this._activeTool) {
                    this._activeTool.set('color', hex);
                    this._activeTool.save();
                }
            });

            conn('size-changed', (_m, size) => {
                if (this._activeTool) {
                    this._activeTool.set('size', size);
                    this._activeTool.save();
                }
            });

            conn('block-size-changed', (_m, size) => {
                if (this._blurSelector) this._blurSelector.setBlockSize(size);
                if (this._activeTool) {
                    this._activeTool.set('blockSize', size);
                    this._activeTool.save();
                }
            });

            conn('mode-changed', (_m, mode) => {
                if (this._blurSelector) this._blurSelector.setMode(mode);
                if (this._activeTool) {
                    this._activeTool.set('mode', mode);
                    this._activeTool.save();
                }
                if (this._toolPropsMenu.visible)
                    this._toolPropsMenu.updateWhenModeChanged('blur', this._blurPropsForMenu());
            });
        }

        _showPopup(popup, triggerBtn) {
            popup.opacity = 0;
            popup.show();
            popup.reposition({ triggerBtn, toolbar: this, ...this._lastReposition });
            popup.opacity = 255;
            const cb = popup.connect('notify::allocation', () => {
                popup.disconnect(cb);
                popup.reposition({ triggerBtn, toolbar: this, ...this._lastReposition });
            });
            this._popupStagePressIds.set(
                popup,
                global.stage.connect('button-press-event', (_stage, event) => {
                    const target = event.get_source();
                    if (target && (popup.contains(target) || triggerBtn?.contains(target)))
                        return Clutter.EVENT_PROPAGATE;
                    this._hidePopup(popup);
                    return Clutter.EVENT_STOP;
                }),
            );
        }

        _hidePopup(popup) {
            const id = this._popupStagePressIds.get(popup);
            if (id !== undefined) {
                global.stage.disconnect(id);
                this._popupStagePressIds.delete(popup);
            }
            if (popup.get_stage()) popup.hide();
        }

        _repositionPopup(popup, triggerBtn) {
            if (!popup?.visible || !this._lastReposition) return;
            popup.reposition({ triggerBtn, toolbar: this, ...this._lastReposition });
        }

        _isDrawingTool(id) {
            return getToolDef(id)?.isDrawing ?? false;
        }

        _emitLoadedProps() {
            if (!this._activeTool) return;
            for (const entry of this._activeTool.propSchema) {
                const v = this._activeTool.get(entry.key);
                if (v !== undefined) this.emit('tool-property-changed', JSON.stringify({ [entry.key]: v }));
            }
        }

        _blurPropsForMenu() {
            const t = getToolDef('blur');
            return { mode: t?.get('mode') ?? 'brush', size: t?.get('size') ?? 4, blockSize: t?.get('blockSize') ?? 16 };
        }

        setBlurSelector(blurSelector) {
            this._blurSelector = blurSelector;
            const t = getToolDef('blur');
            if (!t) return;
            blurSelector.restoreState({
                blurMode: t.get('mode') ?? 'brush',
                blockSize: t.get('blockSize') ?? 16,
            });
        }

        syncToStroke(stroke) {
            const tool = getToolDef(stroke.toolId);
            if (!tool?.isDrawing) return;

            tool.set('color', stroke.color, { silent: true });
            if (stroke.strokeWidth !== undefined) tool.set('size', stroke.strokeWidth, { silent: true });

            if (this._isDrawingTool(stroke.toolId)) {
                this._activeTool = tool;
                this._activePropsTool = stroke.toolId;
                this._propsToolBtn = this._toolButtons.find((b) => b._toolId === stroke.toolId);
                this._showPropsPopup(stroke.toolId);
            }
        }

        _showPropsPopup(toolId) {
            if (!this._isDrawingTool(toolId)) return;
            const btn = this._toolButtons.find((b) => b._toolId === toolId);
            if (!btn) return;

            this._propsToolBtn = btn;
            const tool = getToolDef(toolId);

            if (toolId === 'blur') {
                this._toolPropsMenu.showForTool('blur', this._blurPropsForMenu());
            } else {
                const props = { color: tool.get('color') ?? '#000000' };
                if (toolId !== 'solid-rectangle') props.size = tool.get('size') ?? 4;
                this._toolPropsMenu.showForTool(toolId, props);
            }

            this._showPopup(this._toolPropsMenu, btn);
        }

        _onBlurBlockSizeChanged(size) {
            if (this._toolPropsMenu?._blockSliderSetValue) this._toolPropsMenu._blockSliderSetValue(size);
        }

        _buildFromLayout() {
            for (const group of TOOLBAR_GROUPS) {
                const groupButtons = [];
                for (const item of group.items) {
                    if (item === SEP) {
                        this._addSeparator();
                        continue;
                    }
                    const btn = item.type === 'tool' ? this._buildToolButton(item.id) : this._buildActionButton(item);
                    groupButtons.push(btn);
                }
                this._groupButtons[group.id] = groupButtons;
            }
        }

        _buildToolButton(id) {
            const tool = getToolDef(id);
            const btn = new St.Button({
                child: makeIcon(tool.icon, this._extensionPath),
                style_class: 'screenshot-ui-type-button gradia-square-button',
                toggle_mode: true,
                checked: tool.id === this._selectedTool,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn._toolId = tool.id;
            btn.connect('clicked', () => this.selectTool(tool.id));
            this.add_child(btn);
            this._toolButtons.push(btn);
            btn._tooltip = attachTooltip(btn, tool.name);
            return btn;
        }

        _buildActionButton(def) {
            const btn = new St.Button({
                child: makeIcon(def.icon, this._extensionPath),
                style_class: 'screenshot-ui-type-button gradia-square-button',
                reactive: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.connect('clicked', () => this.emit(def.signal));
            this.add_child(btn);
            attachTooltip(btn, def.tooltip);
            if (def.id === 'ocr') {
                this._ocrButton = btn;
                this._ocrIcon = btn.get_child();
                this._ocrDone = false;
            } else if (def.id === 'undo') {
                this._undoBtn = btn;
            } else if (def.id === 'clear') {
                this._clearBtn = btn;
            }
            return btn;
        }

        setGroupEnabled(groupId, enabled) {
            for (const btn of this._groupButtons[groupId] ?? []) {
                btn.reactive = enabled;
                btn.opacity = enabled ? 255 : 80;
            }
        }

        setOcrProcessing() {
            this._ocrDone = false;
            this._ocrButton.reactive = false;
            if (this._ocrIcon) this._ocrButton.set_child(this._ocrIcon);
            this._ocrButton.remove_all_transitions();
            this._ocrButton.ease_property('opacity', 128, {
                duration: 500,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                repeat_count: -1,
                auto_reverse: true,
            });
        }

        setOcrDone() {
            this._ocrDone = true;
            this._ocrButton.remove_all_transitions();
            this._ocrButton.opacity = 255;
            this._ocrButton.reactive = true;
            this._ocrButton.add_style_pseudo_class('checked');
            if (this._ocrIcon) this._ocrButton.set_child(this._ocrIcon);
        }

        setOcrIdle() {
            this._ocrDone = false;
            this._ocrButton.remove_all_transitions();
            this._ocrButton.opacity = 255;
            this._ocrButton.reactive = true;
            this._ocrButton.remove_style_pseudo_class('checked');
            if (this._ocrIcon) this._ocrButton.set_child(this._ocrIcon);
        }

        updateUndoClearSensitivity() {
            const visible = this._hasVisibleCanvas?.() ?? true;
            this._undoBtn.reactive = visible;
            this._undoBtn.opacity = visible ? 255 : 80;
            this._clearBtn.reactive = visible;
            this._clearBtn.opacity = visible ? 255 : 80;
        }

        _addSeparator() {
            this.add_child(new St.Widget({ style_class: 'gradia-separator', y_expand: true }));
        }

        selectTool(id) {
            const btn = this._toolButtons.find((b) => b._toolId === id);
            if (btn && !btn.reactive) return;

            const prevTool = this._selectedTool;

            this._selectedTool = id;
            for (const b of this._toolButtons) b.checked = b._toolId === id;
            this.emit('tool-changed', id);

            if (this._isDrawingTool(id)) {
                this._activePropsTool = id;
                this._activeTool = getToolDef(id);
                if (id === prevTool && this._toolPropsMenu.visible) {
                    this._hidePopup(this._toolPropsMenu);
                } else {
                    if (id !== prevTool) this._emitLoadedProps();
                    this._showPropsPopup(id);
                }
            } else {
                this._activeTool = null;
                this._activePropsTool = null;
                this._hidePopup(this._toolPropsMenu);
            }
        }

        clearToolSelection() {
            for (const btn of this._toolButtons) btn.checked = false;
            this._activeTool = null;
            this._activePropsTool = null;
            this._hidePopup(this._toolPropsMenu);
        }

        setOcrAvailable(available) {
            this._ocrButton.reactive = available;
            this._ocrButton.opacity = available ? 255 : 80;
        }

        setSelectionToolVisible(enabled) {
            const btn = this._toolButtons.find((b) => b._toolId === 'select');
            const iconName = enabled ? 'icons/selection-opaque-3-symbolic.svg' : 'icons/display-symbolic.svg';
            btn.get_child().gicon = Gio.Icon.new_for_string(`${this._extensionPath}/${iconName}`);
            btn._tooltip.text = enabled ? _('Crop') : _('Pick Display');
        }

        scrollSize(direction, event) {
            if (!this._activeTool) return;
            const step = 1;
            const oldSize = this._activeTool.get('size') ?? 4;
            const max = this._sizeMax();
            let limit;
            if (direction === Clutter.ScrollDirection.UP) limit = Math.min(max, oldSize + step);
            else if (direction === Clutter.ScrollDirection.DOWN) limit = Math.max(SIZE_MIN, oldSize - step);
            else if (direction === Clutter.ScrollDirection.SMOOTH && event) {
                const [, dy] = event.get_scroll_delta();
                const d = dy < 0 ? step : dy > 0 ? -step : 0;
                limit = Math.max(SIZE_MIN, Math.min(max, oldSize + d));
            }
            if (limit === undefined || limit === oldSize) return;
            this._activeTool.set('size', limit);
            this._activeTool.save();
            if (this._toolPropsMenu?.visible && this._toolPropsMenu._sizeSliderSetValue)
                this._toolPropsMenu._sizeSliderSetValue(limit);
        }

        _sizeMax() {
            return this._selectedTool === 'blur' ? BLUR_SIZE_MAX : SIZE_MAX;
        }

        hideColorMenu() {
            this._hidePopup(this._toolPropsMenu);
        }

        hidePropsPopup() {
            this._hidePopup(this._toolPropsMenu);
        }

        reposition({ selectionRect, monitorRect }) {
            const [, natW] = this.get_preferred_width(-1);
            const natH = this.get_preferred_height(-1)[1];
            if (natW <= 0 || natH <= 0) return;

            const localMonCX = monitorRect.x + monitorRect.width / 2;
            let targetX, targetY;

            if (selectionRect) {
                const selTop = selectionRect.y,
                    selHeight = selectionRect.height,
                    selRight = selectionRect.x + selectionRect.width;
                const localMonBottom = monitorRect.y + monitorRect.height,
                    localMonRight = monitorRect.x + monitorRect.width;
                const yAbove = Math.round(selTop - natH),
                    yBelow = Math.round(selTop + selHeight);
                const spaceAbove = Math.round(selTop),
                    spaceBelow = Math.round(localMonBottom - selTop - selHeight);
                if (spaceAbove >= natH) targetY = yAbove;
                else if (spaceBelow >= natH) targetY = yBelow;
                else targetY = 0;
                targetX = Math.round(selRight - natW);
                targetX = Math.max(0, Math.min(targetX, Math.round(localMonRight - natW)));
            } else {
                targetX = Math.round(localMonCX - natW / 2);
                targetY = 0;
            }

            this.set_position(targetX, targetY);
            this._lastReposition = { selectionRect, monitorRect };
            if (this._toolPropsMenu?.visible && this._propsToolBtn)
                this._repositionPopup(this._toolPropsMenu, this._propsToolBtn);
        }

        get selectedTool() {
            return this._selectedTool;
        }
        get activePropsToolId() {
            return this._activePropsTool;
        }
        get selectedColor() {
            return this._activeTool?.get('color') ?? '#000000';
        }
        get size() {
            return this._activeTool?.get('size') ?? 4;
        }
        get colorMenu() {
            return null;
        }
        get blurMenu() {
            return null;
        }
        get toolPropsMenu() {
            return this._toolPropsMenu;
        }

        getToolButton(toolId) {
            return this._toolButtons.find((b) => b._toolId === toolId) || null;
        }
    },
);
