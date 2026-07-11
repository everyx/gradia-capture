#!/bin/bash
# Build the extension .zip in dist/ and optionally install it.
#
# Layout:
#   data/     — static assets: icons, gettext .po, GSettings schemas
#   src/      — source JS + metadata (tracked in git)
#   dist/     — build output (gitignored); created from src/ + data/,
#               then packed into a .zip
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
# Compile gettext .po → .mo
for po in data/po/*.po; do
    [ -f "$po" ] || continue
    lang=$(basename "$po" .po)
    mkdir -p "dist/locale/$lang/LC_MESSAGES"
    msgfmt "$po" -o "dist/locale/$lang/LC_MESSAGES/gradia-capture.mo" 2>/dev/null || true
done
# Pack into zip
cd dist && zip -rq \
    "gradia-integration@alexandervanhee.github.io.shell-extension.zip" \
    . -x "*.shell-extension.zip" && cd ..
echo "Packing Done!"

while getopts i flag; do
    case $flag in
        i)  gnome-extensions install --force \
                "dist/gradia-integration@alexandervanhee.github.io.shell-extension.zip" && \
            echo "Extension is installed. Now restart the GNOME Shell." || \
            { echo "ERROR: Could not install the extension!"; exit 1; };;
        *)  echo "ERROR: Invalid flag!"
            echo "Use '-i' to install the extension to your system."
            echo "To just build it, run the script without any flag."
            exit 1;;
    esac
done
