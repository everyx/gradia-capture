import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { PopupMenuItem, Ornament } from 'resource:///org/gnome/shell/ui/popupMenu.js';

// ---- ComboBox — a dropdown selector with optional search filtering.
//
// Usage:
//   const combo = new ComboBox({
//       options: [{value, label}]
//       selected: 'some-value',
//       enableSearch: true,
//       getStyle: (opt) => `font-family: "${opt.value}";`,
//       onSelect: (value) => console.log('selected', value),
//   });
//   parent.add_child(combo.actor);
//
// Public API:
//   .actor         — St.Entry (search enabled) or St.Button (no search)
//   .select(value) — programmatically select an option
//   .open()        — open the dropdown
//   .close(token)  — close the dropdown
//   .destroy()     — teardown and release resources

const ITEM_HEIGHT = 32;  // px per item for dynamic height calculation
const MAX_POPUP_HEIGHT = 200;

export function ComboBox(params = {}) {
    const {
        options = [],
        selected = null,
        enableSearch = false,
        getStyle = null,     // (opt) => cssString  — per-item label CSS
        onSelect = null,     // (value) => void
        host = null,         // actor whose parent hosts the popup tree
    } = params;

    // ---- Mutable state ----
    let _currentValue = selected;
    let _items = [];
    let _highlightIdx = -1;
    let _open = false;
    let _building = false;
    let _built = false;
    let _settingText = false;
    let _lastY1 = -1;
    let _stageCapId = 0;

    const _visibleItems = () => _items.filter(mi => mi.visible);

    // =============================================================
    //  Trigger widget — St.Entry (searchable) or St.Button
    // =============================================================

    let actor, entry, clutterText;

    if (enableSearch) {
        entry = new St.Entry({
            style_class: 'gradia-combo-entry',
            text: _currentValue || '',
            width: 100,
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        clutterText = entry.clutter_text;
        clutterText.line_alignment = Pango.Alignment.LEFT;
        actor = entry;
    } else {
        actor = new St.Button({
            style_class: 'gradia-combo-button',
            label: _currentValue || '',
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    // =============================================================
    //  Popup tree
    // =============================================================

    const popup = new St.BoxLayout({
        vertical: true,
        style_class: 'gradia-combo-popup',
        visible: false,
        reactive: true,
    });

    const scrollView = new St.ScrollView({
        style_class: 'gradia-combo-list',
        width: 200,
        clip_to_allocation: true,
        reactive: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    scrollView.style = `height: ${MAX_POPUP_HEIGHT}px;`;
    popup.add_child(scrollView);

    // St.Viewport implements StScrollable — the scroll view needs this
    // to set up vadjustment bounds and receive scroll events.
    const listViewport = new St.Viewport();
    const list = new St.BoxLayout({ vertical: true, style_class: 'gradia-combo-list-inner' });
    listViewport.add_child(list);
    scrollView.add_child(listViewport);

    const detachedViewport = new St.Viewport();
    const detachedList = new St.BoxLayout({ vertical: true });
    detachedViewport.add_child(detachedList);

    // Loading indicator — shown until all idle batches are swapped in
    const loadingLabel = new St.Label({
        text: 'Loading…',
        style_class: 'gradia-combo-loading',
    });
    list.add_child(loadingLabel);

    // =============================================================
    //  Helpers
    // =============================================================

    const _scrollToItem = (mi) => {
        const adj = scrollView.vadjustment;
        const box = mi.get_allocation_box();
        if (box.y2 - box.y1 > 0) {
            adj.value = Math.max(0, box.y1);
        } else {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                _scrollToItem(mi);
                return GLib.SOURCE_REMOVE;
            });
        }
    };

    const _setHighlight = (idx) => {
        const vis = _visibleItems();
        _items.forEach(mi => mi.remove_style_pseudo_class('selected'));
        _highlightIdx = Math.max(0, Math.min(idx, vis.length - 1));
        if (vis.length > 0) {
            vis[_highlightIdx].add_style_pseudo_class('selected');
            _scrollToItem(vis[_highlightIdx]);
        }
    };

    const _resizeToItems = () => {
        const visCount = _visibleItems().length;
        const contentH = Math.max(visCount, 1) * ITEM_HEIGHT;
        const newH = Math.min(contentH, MAX_POPUP_HEIGHT);
        scrollView.style = `height: ${newH}px;`;
        popup.style = `height: ${newH + 8}px;`;
    };

    const _tryScroll = () => {
        const sel = _items.find(mi => mi._value === _currentValue);
        if (!sel) return;
        const adj = scrollView.vadjustment;
        const box = sel.get_allocation_box();
        if (box.y2 - box.y1 <= 0) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, _tryScroll);
            return;
        }
        if (box.y1 === _lastY1) return;
        _lastY1 = box.y1;
        adj.value = Math.max(0, box.y1);
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, _tryScroll);
    };

    // Determine the actor that will host the popup subtree.
    // Use the host's parent (ScreenshotUI) so the popup is in
    // the same actor tree as the tool menu — critical for
    // correct event routing (scrolling etc.).
    let popupRoot = global.stage;
    if (host) {
        const p = host.get_parent();
        if (p) popupRoot = p;
    }

    // =============================================================
    //  Popup positioning
    // =============================================================

    const _positionPopup = () => {
        // Compute trigger position in popupRoot's coordinate space
        const [ax, ay] = actor.get_transformed_position();
        const [rx, ry] = popupRoot.get_transformed_position();
        const [, ah] = actor.get_size();
        // get_preferred_size returns [minW, natW, minH, natH]
        const [, pw, , ph] = popup.get_preferred_size();

        let x = ax - rx;
        let y = ay - ry + ah;   // below trigger, left-aligned

        const monIdx = Main.layoutManager.findIndexForActor(actor);
        const mon = Main.layoutManager.monitors[monIdx] ?? Main.layoutManager.primaryMonitor;
        if (mon) {
            // Flip above if not enough room below
            const ayLocal = ay - ry;
            if (y + ph > mon.y + mon.height - ry && ayLocal - ph >= mon.y - ry)
                y = ayLocal - ph;
            // Clamp horizontally
            if (x + pw > mon.x + mon.width - rx)
                x = Math.max(0, mon.x + mon.width - rx - pw);
            if (x < Math.max(0, mon.x - rx))
                x = Math.max(0, mon.x - rx);
        }

        popup.set_position(x, y);
        popup.set_size(pw, ph);
    };

    // =============================================================
    //  Item creation & batch build
    // =============================================================

    const _createItem = (idx) => {
        const opt = options[idx];
        const mi = new PopupMenuItem(opt.label, { style_class: 'gradia-combo-item', reactive: true });
        mi._value = opt.value;
        mi.label.style = getStyle ? getStyle(opt) : '';
        mi.x_expand = true;
        mi.y_expand = false;
        mi.y_align = Clutter.ActorAlign.START;
        mi.connect('activate', () => {
            if (onSelect) onSelect(opt.value);
            select(opt.value);
            _close();
        });
        _items.push(mi);
        return mi;
    };

    const _buildChain = (start) => {
        const end = Math.min(start + 5, options.length);

        for (let i = start; i < end; i++)
            detachedList.add_child(_createItem(i));

        if (end < options.length) {
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                _buildChain(end);
                return GLib.SOURCE_REMOVE;
            });
        } else {
            // All batches done → swap the actor tree in one shot.
            // Replace the viewport (scrollable child) rather than
            // the bare BoxLayout, so the scroll adjustment chain
            // is maintained correctly.
            if (loadingLabel.get_parent()) loadingLabel.destroy();
            listViewport.destroy();
            scrollView.add_child(detachedViewport);

            const selIdx = _visibleItems().findIndex(mi => mi._value === _currentValue);
            _setHighlight(selIdx >= 0 ? selIdx : 0);
            _resizeToItems();
            _positionPopup();   // height may have changed
            _building = false;
        }
    };

    // =============================================================
    //  select() — update selected value and UI
    // =============================================================

    const select = function select(value) {
        _currentValue = value;
        for (const mi of _items) {
            const sel = mi._value === value;
            mi.setOrnament(sel ? Ornament.CHECK : Ornament.NONE);
        }
        if (entry) {
            _settingText = true;
            entry.text = value || '';
            _settingText = false;
            clutterText.set_cursor_position(0);
        } else {
            actor.label = value || '';
        }
    };

    // =============================================================
    //  Open / Close
    // =============================================================

    // Captured-event on stage — close when clicking outside the popup
    const _onStageEvent = (a, event) => {
        if (!_open) return Clutter.EVENT_PROPAGATE;
        if (event.type() !== Clutter.EventType.BUTTON_PRESS)
            return Clutter.EVENT_PROPAGATE;

        const [ex, ey] = event.get_coords();

        // Inside the popup? → let the event through
        const [px, py] = popup.get_transformed_position();
        const [pw, ph] = popup.get_size();
        if (ex >= px && ex <= px + pw && ey >= py && ey <= py + ph)
            return Clutter.EVENT_PROPAGATE;

        // On the trigger? → let it through
        const [ax, ay] = actor.get_transformed_position();
        const [aw, ah] = actor.get_size();
        if (ex >= ax && ex <= ax + aw && ey >= ay && ey <= ay + ah)
            return Clutter.EVENT_PROPAGATE;

        _close();
        return Clutter.EVENT_PROPAGATE;
    };

    const _openPopup = () => {
        if (_open) return;
        _open = true;

        // Listen for outside clicks
        _stageCapId = global.stage.connect('captured-event', _onStageEvent);

        if (popup.get_parent())
            popupRoot.remove_child(popup);
        popupRoot.add_child(popup);
        _positionPopup();
        popup.show();

        // First open → build the item list
        if (!_built) {
            _built = true;
            if (options.length > 0) {
                _building = true;
                GLib.idle_add(GLib.PRIORITY_LOW, () => {
                    _buildChain(0);
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                if (loadingLabel.get_parent()) loadingLabel.destroy();
            }
        } else {
            // Re-open after first build → reset filter
            _settingText = true;
            if (entry) entry.text = '';
            _settingText = false;
            for (const mi of _items) mi.visible = true;
            const selIdx = _visibleItems().findIndex(mi => mi._value === _currentValue);
            _setHighlight(selIdx >= 0 ? selIdx : 0);
            _lastY1 = -1;
            _tryScroll();
            _resizeToItems();
            _positionPopup();
            if (entry) {
                _settingText = true;
                entry.text = _currentValue || '';
                _settingText = false;
                clutterText.set_cursor_position(0);
            }
        }
    };

    const _close = () => {
        _open = false;
        popup.hide();
        if (popup.get_parent())
            popupRoot.remove_child(popup);
        if (_stageCapId) {
            global.stage.disconnect(_stageCapId);
            _stageCapId = 0;
        }
    };

    // =============================================================
    //  Search (entry only)
    // =============================================================

    if (entry) {
        entry.connect('notify::text', () => {
            if (!_open || _settingText || _building) return;

            const query = entry.text.toLowerCase().trim();
            if (!query) {
                for (const mi of _items) mi.visible = true;
                _lastY1 = -1;
                _tryScroll();
                const selIdx = _visibleItems().findIndex(mi => mi._value === _currentValue);
                _setHighlight(selIdx >= 0 ? selIdx : 0);
                _resizeToItems();
                _positionPopup();
                return;
            }

            let firstMatch = null;
            for (const mi of _items) {
                const match = mi._value.toLowerCase().includes(query);
                mi.visible = match;
                if (match && !firstMatch) firstMatch = mi;
            }
            if (firstMatch) {
                const idx = _visibleItems().indexOf(firstMatch);
                _setHighlight(idx >= 0 ? idx : 0);
            }
            _resizeToItems();
            _positionPopup();
        });

        // Focus coupling — keyboard Tab / programmatic focus opens list
        clutterText.connect('notify::focus', () => {
            if (clutterText.focus)
                _openPopup();
        });

        // Primary open & keyboard nav
        entry.connect('captured-event', (a, event) => {
            const etype = event.type();

            if (_open && etype === Clutter.EventType.KEY_PRESS) {
                const sym = event.get_key_symbol();
                if (sym === Clutter.KEY_Up || sym === Clutter.KEY_Down) {
                    const vis = _visibleItems();
                    if (vis.length === 0) return Clutter.EVENT_STOP;
                    const delta = sym === Clutter.KEY_Down ? 1 : -1;
                    const next = (_highlightIdx >= 0 ? _highlightIdx : 0) + delta;
                    _setHighlight(Math.max(0, Math.min(next, vis.length - 1)));
                    return Clutter.EVENT_STOP;
                }
                if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
                    const vis = _visibleItems();
                    if (_highlightIdx >= 0 && _highlightIdx < vis.length)
                        vis[_highlightIdx].activate(event);
                    return Clutter.EVENT_STOP;
                }
                if (sym === Clutter.KEY_Escape) {
                    _close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            if (etype === Clutter.EventType.BUTTON_PRESS)
                _openPopup();

            return Clutter.EVENT_PROPAGATE;
        });
    } else {
        // Button trigger — toggle on click
        actor.connect('clicked', () => {
            if (_open) _close();
            else _openPopup();
        });
    }

    // =============================================================
    //  Destroy
    // =============================================================

    const destroy = () => {
        _close();
        popup.destroy();
        _items = [];
    };

    // =============================================================
    //  Public API
    // =============================================================

    return {
        actor,
        select,
        open: _openPopup,
        close: _close,
        destroy,
        get open() { return _open; },
    };
}
