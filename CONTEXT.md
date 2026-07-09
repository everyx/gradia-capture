# CONTEXT.md

Gnome Shell 扩展(GJS),为截图工具加标注,可选集成 Gradia 做 OCR / 模糊。

本项目按**轻量 DDD**划分 bounded context:每个 context 是一个目录,模块接口不跨 context 反向依赖。目录重组的目标是把隐式的领域边界显式化,而非改变模块行为。

## Bounded Contexts

| Context | 目录 | 职责 |
|---|---|---|
| **capture** | `src/capture/` | 截图摄取与存储:从哪来、存哪去、合成 stroke。选区领域逻辑(`captureContext`)、摄取(`screenshotCapture`)、落盘/toast(`screenshotStore`)。 |
| **canvas** | `src/canvas/` | 绘制载体:`drawingCanvas`(单屏绘制面,持有该屏 `_strokes` 并 Cairo 渲染)+ `canvasCollection`(多屏集合与跨屏编排:坐标路由、undo/select/clear、聚合 `strokeData`)。 |
| **annotation** | `src/annotation/` | 标注工具声明与渲染。`tools/` 下 9 个工具 def(含 `BlurTool`),`blur/` 下 `BlurTool` 的像素化后端引擎(`engine.js`,原 `blurSelector`)。blur 工具与其后端**内聚成块**,不拆散。 |
| **utilities** | `src/utilities/` | 非批注功能,与 annotation 平级、互不依赖。当前仅 `ocr/`(`ocrSelector` + `backend` 即 rapidocr 子进程封装)。未来新增非批注功能(翻译、二维码等)在此平铺,不混入 annotation。 |
| **ui** | `src/ui/` | 用户操作入口与 GNOME 原生 UI 适配:`toolbar`、`toolPropsMenu`、`popupMenu`、`resolutionOverlay`、`dragTool`、`textEntryManager`、`selectionClearPatch`,及自定义控件 `widgets/`。 |
| **platform** | `src/platform/` | 外部系统集成与基础设施:通用 Gradia 应用集成(`gradiaApp`)、GSettings(`settings`)、i18n、toast、tooltip、prefs。 |
| **root** | `src/extension.js` | 唯一装配层(Composition Root)+ 意图执行者(`execute(intent)`)。 |

> 核心概念模型（协调中枢 / 组件 / 画板 / 交互、统一事件流、Stroke、合成阶段 underlay/overlay）详见 [`docs/concepts.md`](docs/concepts.md)。

## UI 按钮语义 ↔ Context 对照

工具栏按钮按行为分为三组(见 `src/ui/toolbarLayout.js`):

- **select** — 截图操作区(`capture` 领域 + `ui` 的 select 按钮)。先于批注存在,影响所有工具的操作区域。
- **annotate** — 批注的一切:`drag` + `undo` + `clear` + 所有批注工具。对应 `annotation` + `canvas` 协作,按钮在 `ui`。**ocr 激活时整组置灰**(沿用现有置灰交互,不整组抽离)。
- **utility** — 非批注功能(`utilities/`,当前 ocr)。有独立生命周期,不需要 undo/clear。

## 依赖约束

- `annotation` 不得反向 import `capture` / `utilities` / `ui`(只通过 `getToolDef().render` 回调暴露渲染)。
- `utilities/*` 之间互不依赖,且不得 import `annotation`(保持"非批注"独立性)。
- `ocr` 只依赖 `capture`(取截图)。
- 所有 context 可依赖 `platform`(基础设施)。
- `extension.js` 装配所有 context,是实现快捷键意图(`execute`)与信号连线的唯一场所。

## 快捷键架构

`shortcutDispatcher`(`src/shortcutDispatcher.js`,属 `ui`)只做**键码 → 意图**映射(`KEY_MAP` + `_matchIntent` + 读 `TOOL_SHORTCUTS` 的 `_matchToolShortcut`),执行委托给 `extension.execute(intent)`。工具选自身键已在 `annotation/tools/index.js` 的 `keybindings` 声明,dispatcher 不碰工具逻辑。会话级命令(undo/copy/save-as/ocr-*)由 `extension.execute` 翻译成对各 context 已有接口的调用。

## Blur 坐标系规范

`annotation/blur/engine.js` 中所有 surface(实时预览/画笔 stroke/马赛克)遵循:

- **放置原点**统一用 `regionAbs / _stageScale`(**不用 `region`**),确保屏幕空间渲染与 surface 内容对齐。
- **block 栅格锚点** `originAbs` 永远取第一落笔点的绝对 device 坐标(`round(startPt × _stageScale)`),不依赖 region。这样 block 格子在拖拽全程锚定起点,已绘制的马赛克区域不会随选区扩大而滑动。
- **核心陷阱**:分数 `_stageScale` 下 `round(A × ds) - round(B × ds) ≠ round((A-B) × ds)`,差 ±1 device pixel → 可见抖动。解法:放置原点用 `regionAbs/ds`,使 `regionAbs` 在 mask/block 的屏幕坐标中自然消掉:
  - mask 屏幕位置 = `regionAbs/ds + (pts[i]×ds - regionAbs)/ds = pts[i]` ✓
  - block 屏幕位置 = `regionAbs/ds + (originAbs - regionAbs)/ds = originAbs/ds` ✓
  - 两者都不依赖 `regionAbs` → 无抖动。
- 未来修改 blur 渲染路径时,若引入新的 `round` 配对计算,务必验证上述不变式——尤其注意只做 relative-to-region 的**单次 `round`**,避免 `round(a*ds) - round(b*ds)` 分布误差。详见 `engine.js` 头部注释块。
