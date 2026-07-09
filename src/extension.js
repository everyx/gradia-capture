import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { initI18n } from './platform/i18n.js';
import { GradiaSettings } from './platform/settings.js';
import { destroyActiveToast } from './platform/screenshotToast.js';
import { SelectionClearer } from './ui/adapters/selectionClearPatch.js';
import { Orchestrator } from './orchestrator/orchestrator.js';

export default class GradiaCompanion extends Extension {
    enable() {
        initI18n(this.dir);
        this._originalOpen = Main.screenshotUI.open.bind(Main.screenshotUI);
        this._originalSaveScreenshot = Main.screenshotUI._saveScreenshot.bind(Main.screenshotUI);
        this._gradiaSettings = new GradiaSettings(this);
        this._settings = this.getSettings();
        this._selectionClearer = new SelectionClearer();
        this._closedId = 0;

        const self = this;
        this._orchestrator = new Orchestrator({
            extensionPath: this.path,
            settings: this._settings,
            gradiaSettings: this._gradiaSettings,
            selectionClearer: this._selectionClearer,
            getPortalMode: () => self._portalMode,
            openPreferences: () => self.openPreferences(),
        });

        Main.screenshotUI.open = async function (mode = 0, ...rest) {
            self._portalMode = mode === 2;
            const result = await self._originalOpen(mode, ...rest);
            self._orchestrator.ensureUI();
            return result;
        };

        Main.screenshotUI._saveScreenshot = async function () {
            await self._orchestrator.capture({ copyOnly: false });
        };

        this._closedId = Main.screenshotUI.connect('closed', () => {
            self._portalMode = false;
            self._orchestrator.removeUI();
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
        this._settings = null;
        destroyActiveToast();

        this._orchestrator.removeUI();
        this._orchestrator = null;
    }
}
