import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { showScreenshotToast } from './screenshotToast.js';

function* _suffixes() {
    yield '';
    for (let i = 1; ; i++)
        yield `-${i}`;
}

function _saveRecentFile(screenshotFile) {
    const recentFile = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
    const uri = screenshotFile.get_uri();
    const bookmarks = new GLib.BookmarkFile();
    try {
        bookmarks.load_from_file(recentFile);
    } catch (e) {
        if (!e.matches(GLib.BookmarkFileError, GLib.BookmarkFileError.FILE_NOT_FOUND))
            return;
    }
    bookmarks.add_application(uri, GLib.get_prgname(), 'gio open %u');
    bookmarks.to_file(recentFile);
}

function _pixbufSaveToStreamAsync(pixbuf, format = 'png') {
    return new Promise((resolve, reject) => {
        const stream = Gio.MemoryOutputStream.new_resizable();
        pixbuf.save_to_streamv_async(stream, format, [], [], null, (pb, res) => {
            try {
                GdkPixbuf.Pixbuf.save_to_stream_finish(res);
                stream.close(null);
                resolve(stream.steal_as_bytes());
            } catch (e) {
                reject(e);
            }
        });
    });
}

async function _writeBytesToFile(file, bytes) {
    return new Promise((resolve, reject) => {
        const stream = file.create(Gio.FileCreateFlags.NONE, null);
        stream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, (s, res) => {
            try {
                s.write_bytes_finish(res);
                s.close(null);
                _saveRecentFile(file);
                resolve(file);
            } catch (e) {
                reject(e);
            }
        });
    });
}

async function _saveBytesToDir(dir, bytes, format) {
    const timestamp = GLib.DateTime.new_now_local().format('%Y-%m-%d %H-%M-%S');
    const name = `Screenshot From ${timestamp}`;

    for (const suffix of _suffixes()) {
        const file = dir.get_child(`${name}${suffix}.${format}`);
        try {
            return await _writeBytesToFile(file, bytes);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }
    }
    return null;
}

function _saveToDiskAsync(bytes, format = 'png') {
    const lockdownSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.lockdown'});
    if (lockdownSettings.get_boolean('disable-save-to-disk'))
        return Promise.resolve(null);

    const dir = Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || GLib.get_home_dir(),
        'Screenshots',
    ]));

    try {
        dir.make_directory_with_parents(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw e;
    }

    return _saveBytesToDir(dir, bytes, format);
}

function _showToast(file, pixbuf, copyOnly) {
    const coglContext = global.stage.context.get_backend().get_cogl_context();
    const pixels = pixbuf.read_pixel_bytes();
    const imageContent = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
    imageContent.set_bytes(
        coglContext, pixels, Cogl.PixelFormat.RGBA_8888,
        pixbuf.width, pixbuf.height, pixbuf.rowstride
    );
    showScreenshotToast(file, imageContent, pixbuf.width, pixbuf.height, copyOnly);
}

async function _storeScreenshotAsync(bytes, pixbuf, { copy = true, save = true, format = 'png', alreadyEncoded = false } = {}) {
    let finalBytes = bytes;
    if (format !== 'png' && !alreadyEncoded)
        finalBytes = await _pixbufSaveToStreamAsync(pixbuf, format);

    if (copy) {
        const clipboard = St.Clipboard.get_default();
        clipboard.set_content(St.ClipboardType.CLIPBOARD, `image/${format}`, finalBytes);
    }

    let file = null;
    if (save) {
        file = await _saveToDiskAsync(finalBytes, format);
        if (file)
            Main.screenshotUI.emit('screenshot-taken', file);
    }

    if (copy)
        _showToast(file, pixbuf, copy && !save);

    return file;
}

async function _pickSaveLocationViaPortal(suggestedName) {
    const handle_token = `gradia${Math.floor(Math.random() * 1000000)}`;
    const sender = Gio.DBus.session.get_unique_name().replace(/\./g, '_').slice(1);
    const request_path = `/org/freedesktop/portal/desktop/request/${sender}/${handle_token}`;

    return new Promise((resolve, reject) => {
        const sub = Gio.DBus.session.signal_subscribe(
            null, 'org.freedesktop.portal.Request', 'Response', null, null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, path, _iface, _signal, params) => {
                if (path !== request_path)
                    return;
                Gio.DBus.session.signal_unsubscribe(sub);
                const [response, results] = params.deepUnpack();
                if (response !== 0) { resolve(null); return; }
                const uris = results['uris']?.deepUnpack();
                resolve(uris?.[0] ?? null);
            }
        );

        Gio.DBus.session.call(
            'org.freedesktop.portal.Desktop',
            '/org/freedesktop/portal/desktop',
            'org.freedesktop.portal.FileChooser',
            'SaveFile',
            new GLib.Variant('(ssa{sv})', [
                '',
                'Save Screenshot As…',
                {
                    handle_token: new GLib.Variant('s', handle_token),
                    current_name: new GLib.Variant('s', suggestedName),
                },
            ]),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    Gio.DBus.session.signal_unsubscribe(sub);
                    reject(e);
                }
            }
        );
    });
}

async function _saveToUserChosenLocation(bytes, pixbuf, format = 'png') {
    const timestamp = GLib.DateTime.new_now_local().format('%Y-%m-%d %H-%M-%S');
    const suggestedName = `Screenshot From ${timestamp}.${format}`;

    const chosenUri = await _pickSaveLocationViaPortal(suggestedName);
    if (!chosenUri)
        return null;

    let finalBytes = bytes;
    if (format !== 'png')
        finalBytes = await _pixbufSaveToStreamAsync(pixbuf, format);

    const file = await _writeBytesToFile(Gio.File.new_for_uri(chosenUri), finalBytes);
    if (file)
        _showToast(file, pixbuf, false);
    return file;
}

export async function captureAndStoreScreenshot(texture, geometry, scale, cursor, compositeFn, { copy = true, save = true, externalSave = false, format = 'png', playSound = true } = {}) {
    const stream = Gio.MemoryOutputStream.new_resizable();
    const [x, y, w, h] = geometry ?? [0, 0, -1, -1];
    if (cursor === null)
        cursor = {texture: null, x: 0, y: 0, scale: 1};

    if (playSound)
        global.display.get_sound_player().play_from_theme('screen-capture', 'Screenshot taken', null);

    const pixbuf = await Shell.Screenshot.composite_to_stream(
        texture,
        x, y, w, h,
        scale,
        cursor.texture, cursor.x, cursor.y, cursor.scale,
        stream
    );

    stream.close(null);
    const originalBytes = stream.steal_as_bytes();

    let finalBytes = originalBytes;
    let finalPixbuf = pixbuf;
    let alreadyEncoded = false;

    if (compositeFn) {
        const composited = compositeFn(originalBytes, pixbuf);
        if (composited) {
            finalPixbuf = composited.pixbuf;
            finalBytes = await _pixbufSaveToStreamAsync(finalPixbuf, format);
            alreadyEncoded = true;
        }
    }

    if (externalSave)
        return _saveToUserChosenLocation(finalBytes, finalPixbuf, format);

    return _storeScreenshotAsync(finalBytes, finalPixbuf, { copy, save, format, alreadyEncoded });
}
