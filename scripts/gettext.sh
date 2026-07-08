#!/bin/bash
# i18n tooling for gradia-capture (standard GNU gettext toolchain).
#
# Thin wrapper around xgettext / msgmerge / msgfmt. No custom extraction
# logic — only pre-existing gettext binaries are used.
#
# For the actual build, gnome-extensions pack handles .mo compilation
# automatically via its --podir / --gettext-domain flags (see build.sh).
# This script is for development: extracting strings, updating po templates,
# and compiling .mo locally for inspection.
#
# Usage:
#   ./scripts/gettext.sh extract   # src/*.js -> po/gradia-capture.pot
#   ./scripts/gettext.sh update    # merge pot into each po/<lang>.po
#   ./scripts/gettext.sh compile   # po/<lang>.po -> dist/locale/<lang>/.../<domain>.mo
#   ./scripts/gettext.sh           # extract + update + compile (all)

set -e

cd "$(cd "$(dirname "$0")" && pwd)/.."

DOMAIN="gradia-capture"
SRC_DIR="src"
PO_DIR="data/po"
DIST_DIR="dist"
LOCALE_DIR="$DIST_DIR/locale"

# Languages we ship translations for (en is the source/fallback, no .po).
LANGS=("zh_CN")

PO_POT="$PO_DIR/$DOMAIN.pot"

cmd="${1:-all}"

extract() {
    mkdir -p "$PO_DIR"
    echo "Extracting strings -> $PO_POT"
    # screenshotStore.js uses GLib.dgettext('gnome-shell', ...) — those
    # strings belong to gnome-shell's translation domain, not ours.
    # GNU gettext's JS backend has a default keyword dgettext:2 which
    # would erroneously extract them into our .pot, so we exclude the file.
    # There is no xgettext comment directive for per-line ignore.
    xgettext \
        --language=JavaScript \
        --from-code=UTF-8 \
        --keyword=_ \
        --keyword=N_:1 \
        --add-comments=Translators \
        --package-name="$DOMAIN" \
        --copyright-holder="Gavin Luo" \
        --output="$PO_POT" \
        $(find "$SRC_DIR" -maxdepth 1 -name '*.js' ! -name 'screenshotStore.js')
}

update() {
    for lang in "${LANGS[@]}"; do
        po="$PO_DIR/$lang.po"
        if [ -f "$po" ]; then
            echo "Updating $po"
            msgmerge --update --backup=none "$po" "$PO_POT"
        else
            echo "Creating $po"
            cp "$PO_POT" "$po"
        fi
    done
}

compile() {
    mkdir -p "$LOCALE_DIR"
    for lang in "${LANGS[@]}"; do
        po="$PO_DIR/$lang.po"
        [ -f "$po" ] || { echo "Skip $lang: $po missing"; continue; }
        target="$LOCALE_DIR/$lang/LC_MESSAGES"
        mkdir -p "$target"
        echo "Compiling $po -> $target/$DOMAIN.mo"
        msgfmt "$po" --output-file="$target/$DOMAIN.mo"
    done
}

case "$cmd" in
    extract) extract ;;
    update)  update ;;
    compile) compile ;;
    all)     extract; update; compile ;;
    *) echo "Unknown command: $cmd"; exit 1 ;;
esac

echo "Done."
