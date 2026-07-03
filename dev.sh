#!/bin/bash
set -e

cd "$( cd "$( dirname "$0" )" && pwd )"

export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/gnome-shell-$(date +%Y%m%d-%H%M%S).log"

echo "Building and installing extension..."
./build.sh -i

echo ""
echo "Starting nested GNOME Shell (--devkit)..."
echo "Logs: $LOG_FILE"
echo "Close the window or press Ctrl+C to exit."
echo ""

dbus-run-session gnome-shell --devkit --wayland 2>&1 \
  | tee "$LOG_FILE" \
  | grep -v '^$' \
  | grep --line-buffered -E '(gradia|\[text\]|Gjs|JS ERROR|EXTENSION|Warning|CRITICAL)' \
    || true
