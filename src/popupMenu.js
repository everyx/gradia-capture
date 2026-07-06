import GObject from 'gi://GObject';
import St from 'gi://St';

export const PopupMenu = GObject.registerClass({
    Signals: {},
}, class PopupMenu extends St.BoxLayout {
    _init(style_class = '', params = {}) {
        const classes = 'screenshot-ui-panel' + (style_class ? ` ${style_class}` : '');
        super._init({
            style_class: classes,
            x_expand: false,
            y_expand: false,
            reactive: true,
            visible: false,
            ...params,
        });
    }

    reposition({ triggerBtn, toolbar, selectionRect, monitorRect }) {
        if (!this.visible)
            return;
        if (!triggerBtn || !toolbar)
            return;

        const [btnSX, btnSY] = triggerBtn.get_transformed_position();
        const [tbSX, tbSY] = toolbar.get_transformed_position();
        const [, tbH] = toolbar.get_size();
        if (btnSX == null || tbSX == null)
            return;

        const [, menuW] = this.get_preferred_width(-1);
        const [, menuH] = this.get_preferred_height(menuW);
        if (menuW <= 0 || menuH <= 0)
            return;

        const localBtnX = btnSX;
        const toolbarTop = tbSY;
        const toolbarBottom = tbSY + tbH;

        const localMonLeft = monitorRect.x;
        const localMonTop = monitorRect.y;
        const localMonBottom = monitorRect.y + monitorRect.height;
        const localMonRight = monitorRect.x + monitorRect.width;

        let menuX = localBtnX;
        if (menuX + menuW > localMonRight)
            menuX = localMonRight - menuW;
        if (menuX < localMonLeft)
            menuX = localMonLeft;
        menuX = Math.round(menuX);

        let preferAbove = true;
        if (selectionRect) {
            const localSelTop = selectionRect.y;
            const localSelBottom = selectionRect.y + selectionRect.height;
            if (toolbarBottom <= localSelTop)
                preferAbove = true;
            else if (toolbarTop >= localSelBottom)
                preferAbove = false;
            else {
                const spaceAbove = toolbarTop - localMonTop;
                const spaceBelow = localMonBottom - toolbarBottom;
                preferAbove = spaceAbove >= spaceBelow;
            }
        }

        const yAbove = toolbarTop - menuH;
        const yBelow = toolbarBottom;
        const candidates = preferAbove ? [yAbove, yBelow] : [yBelow, yAbove];

        let menuY = null;
        for (const y of candidates) {
            if (y >= localMonTop && y + menuH <= localMonBottom) {
                menuY = y;
                break;
            }
        }
        if (menuY === null)
            menuY = Math.max(localMonTop, Math.min(preferAbove ? yAbove : yBelow, localMonBottom - menuH));
        menuY = Math.round(menuY);

        this.set_position(menuX, menuY);
    }
});
