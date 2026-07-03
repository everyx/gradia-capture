# AGENTS.md

GNOME Shell extension（GJS），为截图工具加标注，可选集成 Gradia Flatpak 做 OCR。

## 命令

- `./dev.sh` — 推荐开发循环：build+install 后用 `dbus-run-session
  gnome-shell --devkit --wayland` 起嵌套 shell，避开打扰当前会话，
  日志（过滤过）落到 `./logs/`。

## 参考

确认 GNOME Shell 行为时可查源码与 API 文档：
- GNOME Shell 源码：https://github.com/gnome/gnome-shell
- GJS API 文档：https://gjs-docs.gnome.org/
