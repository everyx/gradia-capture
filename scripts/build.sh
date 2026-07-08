#!/bin/bash
# Build the extension .zip in dist/ and optionally install it.
#
# Layout:
#   data/     — static assets: icons, gettext .po, GSettings schemas
#   src/      — source JS + metadata (tracked in git)
#   dist/     — build output (gitignored); created from src/ + data/,
#               then packed into a .zip by gnome-extensions pack
#
# gettext .mo files are auto-compiled from po/ by gnome-extensions pack
# via its --podir / --gettext-domain flags; no manual msgfmt needed here.
#
# This Script is released under GPL v3 license
# Copyright (C) 2020-2025 Javad Rahmatzadeh
# Copyright (C) 2025 Alexander Vanhee

set -e
cd "$(cd "$(dirname "$0")" && pwd)/.."

echo "Preparing dist..."
rm -rf dist
mkdir -p dist

rsync -a --exclude='locale/' src/ dist/
cp -r data/icons dist/
cp -r data/schemas dist/
cp LICENSE dist/ 2>/dev/null || true
cp README.md dist/ 2>/dev/null || true

echo "Packing extension..."
gnome-extensions pack dist \
    --force \
    --podir=../data/po \
    --gettext-domain=gradia-capture \
    --schema="schemas/org.gnome.shell.extensions.gradia-companion.gschema.xml" \
    --out-dir=dist \
    --extra-source="icons" \
    --extra-source="schemas" \
    $(find dist -maxdepth 1 \( -name '*.js' -o -name '*.py' \) ! -name 'extension.js' ! -name 'prefs.js' -printf '--extra-source=%f ')
echo "Packing Done!"

while getopts i flag; do
    case $flag in
        i)  gnome-extensions install --force \
                dist/gradia-integration@alexandervanhee.github.io.shell-extension.zip && \
            echo "Extension is installed. Now restart the GNOME Shell." || \
            { echo "ERROR: Could not install the extension!"; exit 1; };;
        *)  echo "ERROR: Invalid flag!"
            echo "Use '-i' to install the extension to your system."
            echo "To just build it, run the script without any flag."
            exit 1;;
    esac
done
