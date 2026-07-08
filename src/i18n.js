import GLib from 'gi://GLib';

import { bindtextdomain } from 'gettext';

const DOMAIN = 'gradia-capture';

let _bound = false;

export function initI18n(dir) {
    if (_bound) return;
    const localeDir = dir.get_child('locale');
    bindtextdomain(DOMAIN, localeDir.get_path());
    _bound = true;
}

export function _(str) {
    return GLib.dgettext(DOMAIN, str);
}

export function N_(str) {
    return str;
}
