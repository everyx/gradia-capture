import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { attachTooltip } from './tooltip.js';

const GRADIA_FLATPAK_ID = 'be.alexandervanhee.gradia';
const GRADIA_DESKTOP_ID = `${GRADIA_FLATPAK_ID}.desktop`;

export function isRapidOcrAvailable() {
    try {
        const proc = Gio.Subprocess.new(
            ['which', 'rapidocr'],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
        );
        return proc.wait_check(null);
    } catch (e) {
        return false;
    }
}

export function runRapidOcr(file, extensionPath) {
    return new Promise((resolve, reject) => {
        const path = file.get_path();
        if (!path) {
            reject(new Error('No file path'));
            return;
        }
        try {
            const proc = Gio.Subprocess.new(
                ['python3', `${extensionPath}/ocr.py`, path],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, (_p, res) => {
                try {
                    const [, stdout] = _p.communicate_utf8_finish(res);
                    const parsed = JSON.parse(stdout ?? '[]');
                    if (!Array.isArray(parsed)) {
                        reject(new Error(parsed?.error ?? 'OCR produced no results'));
                        return;
                    }
                    resolve(parsed);
                } catch (e) {
                    reject(e);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

export function isGradiaInstalled() {
    return Gio.DesktopAppInfo.new(GRADIA_DESKTOP_ID) !== null;
}

export function launchGradiaForScreenshot(file) {
    if (!file)
      return;

    const appInfo = Shell.AppSystem.get_default().lookup_app(GRADIA_DESKTOP_ID)?.get_app_info();
    if (!appInfo)
      return;

    try {
        Gio.Subprocess.new(['gio', 'launch', appInfo.get_filename(), file.get_uri()], Gio.SubprocessFlags.NONE);
    } catch (e) {
        console.error(`Failed to spawn Gradia: ${e.message}`);
    }
}

export function openContainingFolder(file) {
    Gio.DBus.session.call(
        'org.freedesktop.FileManager1',
        '/org/freedesktop/FileManager1',
        'org.freedesktop.FileManager1',
        'ShowItems',
        new GLib.Variant('(ass)', [[file.get_uri()], '']),
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        null
    );
}

export function openFileInDefaultApp(file) {
    Gio.app_info_launch_default_for_uri(
        file.get_uri(),
        global.create_app_launch_context(0, -1)
    );
}

export function createSettingsButton(onClick) {
    const button = new St.Button({
        style_class: 'screenshot-ui-show-pointer-button',
        icon_name: 'org.gnome.Settings-symbolic',
        toggle_mode: false,
    });
    button.connect('clicked', () => onClick());
    attachTooltip(button, 'Settings', St.Side.TOP);
    return button;
}
