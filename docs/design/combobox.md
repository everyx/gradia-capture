# ComboBox — 通用下拉选择控件

## 动机

当前 `_makeFont` 内部耦合了一个完整可搜索的下拉选单：触发按钮（entry）、弹出层定位、列表渲染、搜索过滤、键盘导航、离屏批量构建、动态高度。这些逻辑与 font 无关，可以抽象为通用的 `ComboBox` 控件，`_makeFont` 只负责 font-specific 的配置（`font-family` 样式）。

## 接口

```js
const combo = new ComboBox({
    options:       {value, label}[],     // 选项列表
    selected:      string | null,        // 当前值
    enableSearch:  boolean,              // false → 按钮触发；true → 输入框触发
    enableCache:   boolean | 'auto',     // 'auto' = options.length > 20 时启用
    getStyle:      (opt) => string|null, // 每个 item label 的额外 CSS（例如 font-family）
    onSelect:      (value) => void,      // 选中回调
});

// 挂载到菜单
group.add_child(combo.actor);

// 后续更新
combo.setOptions(newOptions);
combo.select(newValue);
combo.destroy();
```

## 内部结构

```
ComboBox
├── .actor                      → St.Entry (enableSearch=true)
│                               或 St.Button (enableSearch=false)
├── ._popupPanel                → St.Widget（下拉面板，父级为 stage）
│   ├── ._scrollView            → St.ScrollView
│   │   └── ._list              → St.BoxLayout
│   └── （用 stage 坐标定位，clamp 到屏幕内）
├── ._detachedList              → St.BoxLayout（离屏构建用）
├── ._options                   → 当前选项列表
├── ._items                     → PopupMenuItem[]
├── ._highlightIdx              → 当前高亮
├── ._open / ._building / ._searchId
└── ._cache                     → 位置缓存（options.length > CACHE_THRESHOLD 时启用）
```

### 弹出层定位

不使用 BoxPointer（font picker 依赖菜单的 BoxPointer，通用化后不合适）。

改为：

1. 弹出层加到 `global.stage` 作为独立 overlay。
2. 定位时取 `.actor` 的 `get_transformed_position()` + `get_transformed_size()`，把面板放在 actor 正下方。
3. 如果下方空间不足则翻转到上方。
4. 启用 `enableCache` 时：首次定位后保存 stage 坐标；搜素重新过滤导致面板高度变化时，直接恢复缓存位置而非重新计算——避免 layout cascade 导致的偏移。

### 离屏构建

与当前实现一致：`options.length > 30` 时启用 `idle_add(PRIORITY_LOW)` 分批构建，`_detachedList` 交换为 `_list`。

### 搜索

`enableSearch=true` 时：
- 触发控件为 `St.Entry`，`notify::text` 150ms 防抖过滤。
- 清空搜索 → 恢复全部显示，高亮回到当前值。
- 激活回调沿用当前逻辑。

`enableSearch=false` 时：
- 触发控件为 `St.Button`，点击 `_openList()` 展开。
- 点击已选项关闭。

### 弹窗关闭

- 选中某项 → 关闭。
- Escape → 关闭。
- `.actor` 失去焦点（ClutterText `notify::focus` 或全局 stage key-focus） → 关闭（延迟检查，防止点击项时先触发 blur）。
- 点击弹出层外部 → 关闭（`captured-event` on stage）。

### 动画 / 样式

- 暂不添加展开/收缩动画（当前 font picker 没有动画，后续可加）。
- 面板有基础 box-shadow / border。
- Item 复用 `.gradia-font-item`，通用化为 `.gradia-combo-item`。

## 生命周期

| 方法 | 行为 |
|---|---|
| `constructor()` | 构建触发控件、弹出层结构，挂载 `captured-event` / `notify::focus` |
| `select(value)` | 更新选中值、更新 item ornaments、更新 trigger 文本 |
| `setOptions(options)` | 替换选项列表、触发重建（idle 中 destroy 旧 items + build 新） |
| `destroy()` | 从 stage 移除弹出层、断开所有信号连接、释放引用 |
| `open()` / `close()` | 手动控制弹出层（供 `_resetFontState` 等外部调用） |

## 迁移步骤

1. 新建 `src/ui/widgets/comboBox.js`，实现 `ComboBox` 类。
2. `toolPropsMenu._makeFont` 改为：

```js
_makeFont(item) {
    const combo = new ComboBox({
        options: item.options,
        selected: item.value,
        enableSearch: true,
        getStyle: (opt) => `font-family: "${opt.value}";`,
        onSelect: (value) => this._emit(item.key, value),
    });
    const group = new St.BoxLayout({ style_class: 'gradia-font-control' });
    group.add_child(combo.actor);
    return {
        group,
        update: (it) => combo.select(it.value),
        setValue: (v) => combo.select(v),
    };
}
```

3. 清理 `popupMenu.js` 中与 font overlay 相关的逻辑（`_fontOverlay`、`_fontAnchor`、position cache 保留但由 ComboBox 内部管理）。

## 开放问题

- `global.stage.add_child` 导致的 z-order / 事件穿透问题是否需额外处理？（当前 menu 的 BoxPointer 提供了隔离，独立 overlay 需要 `captured-event` 截获外部点击关闭。）
- ComboBox 的弹出面板是否需要像 BoxPointer 一样带箭头装饰？目前认为不需要（标准下拉风格），但如果未来 UI 需要，可以作为配置项。
