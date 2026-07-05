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

## St 组件坑

- 光标：`set_cursor_type(TEXT)` 可用，`set_cursor()` 会破坏事件路由；St CSS 不支持 `cursor`。
- 透明度：用 `st-transparentize(-st-accent-color, 0.7)`（运行时 CSS），`transparentize()` 是 SASS-only。
- `St.BoxLayout` 构造器不支持 `{children: [...]}`，必须用 `add_child()`。
- 虚线边框：用 `St.DrawingArea` + `repaint` 信号 + Cairo `setDash`，`Clutter.Canvas` 在 St 容器里不渲染。
- 动画 opacity 需 `remove_all_transitions()` 防冲突。

## OCR 开发

- OCR 层（overlay）必须插在 `primaryBin` index 0（toolbar 下方）才能正确 z-order。
- `activate()` 始终触发，点第二次直接 return；退出 OCR 靠切工具或 `deactivate()`。
- `index_to_pos` 需要 UTF-8 字节偏移，不是 JS 字符索引 → `_toByteIdx` 辅助函数。
- 隐藏标注双重保护：`canvas.hide()` 视觉层 + `!ocr` 跳过 `strokeData` 合成。
- `transform_stage_point` 用于坐标转换（overlay 里 placement 按钮位置）。
- `EVENT_STOP` 阻断事件穿透到工具层。
