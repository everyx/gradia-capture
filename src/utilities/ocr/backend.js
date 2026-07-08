import Gio from 'gi://Gio';

export function isRapidOcrAvailable() {
    try {
        const proc = Gio.Subprocess.new(
            ['which', 'rapidocr'],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
        );
        return proc.wait_check(null);
    } catch {
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
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
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
