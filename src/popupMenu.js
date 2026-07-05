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

    reposition({ triggerBtn, toolbar, selectionRect, monitorRect, primaryBin }) {
        if (!this.visible)
            return;
        if (!primaryBin || !triggerBtn || !toolbar)
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

        const [okC, localBtnX, localTbTop] = primaryBin.transform_stage_point(btnSX, tbSY);
        if (!okC) return;
        const localTbBottom = localTbTop + tbH;

        const [okL, localMonLeft, localMonTop] = primaryBin.transform_stage_point(
            monitorRect.x, monitorRect.y);
        const [okB, , localMonBottom] = primaryBin.transform_stage_point(
            monitorRect.x, monitorRect.y + monitorRect.height);
        const [okR, localMonRight] = primaryBin.transform_stage_point(
            monitorRect.x + monitorRect.width, monitorRect.y);
        if (!okL || !okB || !okR)
            return;

        let menuX = localBtnX;
        if (menuX + menuW > localMonRight)
            menuX = localMonRight - menuW;
        if (menuX < localMonLeft)
            menuX = localMonLeft;
        menuX = Math.round(menuX);

        const toolbarTop = localTbTop;
        const toolbarBottom = localTbBottom;

        let preferAbove = true;
        if (selectionRect) {
            const [okS, , localSelTop] = primaryBin.transform_stage_point(
                selectionRect.x, selectionRect.y);
            const [okS2, , localSelBottom] = primaryBin.transform_stage_point(
                selectionRect.x, selectionRect.y + selectionRect.height);
            if (okS && okS2) {
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
