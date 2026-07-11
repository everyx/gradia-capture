# 领域概念模型

> 本文档是项目的概念宪法。定义所有参与者（人、agent）共用的术语体系与架构纪律。
> 代码从本文档编译，每次修 bug 先在本文档找源头。

---

## 1. 角色模型

系统由**协调中枢**、**组件**、**画板**三类角色构成。组件是各 bounded context 的统称。

| 概念 | 本质 | 职责 |
|---|---|---|
| **协调中枢 Orchestrator** | 唯一装配者 + 注入端口 | 创建组件 / 画板，经 `emitter` 广播事件，不调用组件内部 |
| **组件 Components** | 独立功能模块（capture / annotation / utilities / ui / platform） | 各自边界内功能，订阅端口自行响应 |
| **画板 Board** | 绘制载体 + 数据模型 | 多屏画布集合、Stroke 原子存储、渲染 / 命中 / 撤销 / 聚合 |

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  协调中枢     │  │   组件        │  │   画板        │
│ Orchestrator │  │ Components   │  │   Board      │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ 事件路由         │ emit 事件        │ Stroke 原子
       ▼                 ▼                 ▼
  事件→handler 映射   独立功能模块      多屏画布+聚合
```

## 2. Bounded Contexts

| Context | 目录 | 职责 |
|---|---|---|
| **orchestrator** | `src/orchestrator/` | 协调中枢（应用层）：装配所有组件 + 信号编排 + 意图分发。`orchestrator.js`（原 `extension.js` 的装配/信号/`execute`）+ `shortcutDispatcher.js`（键码→意图映射）。`extension.js` 仅做 GNOME 生命周期壳（enable/disable + 猴子补丁 `Main.screenshotUI`）。 |
| **capture** | `src/capture/` | 截图摄取与存储：从哪来、存哪去、合成 stroke。含 `select`（截图操作区，先于批注存在、影响所有工具的操作区域）。选区领域逻辑（`captureContext`）、摄取（`screenshotCapture`）、落盘/toast（`screenshotStore`）。 |
| **board** | `src/board/` | 画板（绘制载体）：`drawingCanvas`（单屏绘制面，持有该屏 `_strokes` 并 Cairo 渲染）+ `canvasCollection`（多屏集合与跨屏编排：坐标路由、undo/select/clear、聚合 `strokeData`）+ `inputCatcher`（画板事件入口壳，仅转发 vfunc，**非 Interaction**）。 |
| **annotation** | `src/annotation/` | 标注工具声明、渲染与输入翻译。`tools/` 下工具 def（`DrawingTool` 基类 + 9 工具含 `BlurTool`），共享领域能力提至 `annotation/shared.js`；`input/` 为标注工具的输入翻译层（`dragTool`/`textEntryManager`，drag 是标注操作，text 是文字标注输入，均属 annotation）。`BlurTool` 的像素化后端引擎作其内部实现置于 `tools/blur/engine.js`。每个工具经 `getMenuItems()` 声明**自己的属性菜单（纯数据）**。 |
| **utilities** | `src/utilities/` | 非批注功能，与 annotation 平级、互不依赖。当前仅 `ocr/`（`ocrSelector` + `backend` 即 rapidocr 子进程封装）。未来新增非批注功能（翻译、二维码等）在此平铺，不混入 annotation。同样可经 `getMenuItems()` 声明属性菜单（如 OCR 语言）。 |
| **ui** | `src/ui/` | GNOME 原生 UI 适配，分 `adapters/`（工具栏/菜单/分辨率层/选区清理等原生适配）与 `widgets/`（展示构件 `squareSlider`）。`toolPropsMenu` 为**通用属性菜单渲染器**：读 provider 的 `getMenuItems()` 数据，映射持久原语（color/slider/toggle），不含工具专有分支。 |
| **platform** | `src/platform/` | 外部系统集成与基础设施：通用 Gradia 应用集成（`gradiaApp`）、GSettings（`settings`）、i18n、toast、tooltip、prefs、事件端口（`emitter`）、属性菜单契约（`menuSchema`：kind 词汇 + 量程常量）。 |

---

## 3. 通信机制：统一事件流

跨概念通信统一建模为**事件流**：事件经注入端口（`emitter`）广播，订阅者自行响应，不认识对方具体类。

```
组件/输入/快捷键 ──emit──▶ 注入端口(emitter) ──▶ 订阅者(组件/画板)自行响应
                            只认事件与端口，不认具体类
```

> 跨概念通信统一为**事件 → handler 映射**，落在 `src/platform/emitter.js`（`addEmitter`，注入式实例，非全局类）。组件构造时订阅、自行响应（如 `tool-changed`），协调中枢只 emit、不再调用组件内部。**禁止抽独立全局 EventBus 类**——保持"经注入端口通信"，组件不反向依赖 orchestrator。

---

## 4. Stroke 数据模型

> **Stroke = 画板数据模型的原子**：最小可渲染 / 可命中 / 可撤销 / 可序列化单元。自带渲染能力与合成阶段属性，**无工具身份**。工具在产生它时注入能力（`paintTo`）与 `phase`，下游只消费这些属性。

- Stroke 不是工具本身，也不是像素；它是"工具的输出结果"被抽象为画板原子。
- 画板不关心 Stroke 从哪个工具来，只关心它能否渲染 / 命中 / 撤销 / 导出。
- 工具在产生 Stroke 时写入渲染参数与 `phase`；下游（画板渲染、capture 合成）只消费这些属性，不识别工具类型。

## 5. 合成阶段：underlay / overlay

渲染与合成按两个阶段排序，先 `underlay` 后 `overlay`：

```
渲染 / 合成顺序：
  ① 截图底图
  ② underlay  phase  — blur / ocr 等效用，处理截图本身，固定前置
  ③ overlay   phase  — annotation 批注，画板层自由交错（按 order）
```

- `phase` 由工具在产生 Stroke 时声明；画板渲染与 capture 合成均按 `phase` 排序，**不再有 `toolId === 'blur'` 特判**。
- `overlay` 指"批注覆盖层"（画在截图之上、彼此自由交错）；`underlay` 指"衬底层"（blur 像素化 / ocr 识别，作用在截图本身、固定前置）。二者对称。
- OCR 激活时置灰 annotate 组，本质是"当前 phase 切到 underlay，overlay 不可用"，与 blur 的底层约束同源。
- `InputCatcher`（`board/inputCatcher.js`，原 `DrawingInputOverlay`）是**画板的事件入口壳**：仅把原始鼠标/触摸/滚动事件透明转发给 `DrawingCanvas.vfunc_*`，**不做输入→命令翻译**（翻译由 annotation 的 `dragTool` / `textEntryManager` 完成）。它属画板内部，与概念 `overlay`（批注覆盖层）无关。

---

## 6. 架构纪律

### 6.1 依赖约束

- `annotation` 不得反向 import `capture` / `utilities` / `ui/adapters/`（只通过 `getToolDef().render` 回调 + `getMenuItems()` 纯数据暴露渲染/菜单）。`ui/widgets/` 被视为共享基础设施层，所有 context 均可使用。
- **属性菜单契约**在 `platform/menuSchema.js`（kind 词汇 + 量程常量，纯数据）。provider（annotation tool / utilities）出 `getMenuItems()` 数据 + `set(key,value)`；`ui` 渲染器泛型消费，三方互不依赖。新增 bespoke 控件 = 往 ui 加一个原语 + provider 声明对应 kind。
- `utilities/*` 之间互不依赖，且不得 import `annotation`（保持"非批注"独立性）。
- `ocr` 只依赖 `capture`（取截图）。
- 所有 context 可依赖 `platform`（基础设施）。
- 各组件**不得反向 import `orchestrator`**；orchestrator 是唯一装配者，经事件/端口连接各组件。
- `orchestrator` 是 `execute(intent)` 的实现者；`extension.js` 仅做生命周期壳与装配委托。

### 6.2 通用约定

1. 数据（Stroke）随身带能力（`paintTo`）与 `phase`，组件消费能力 / 属性，不消费类型。
2. 标注工具的输入翻译（drag / text）在 `annotation/input/`，属 annotation 内部，不认识具体工具（经 `stroke.hitBounds` 等能力）。
3. 组件间只经事件 + 端口通信，不认识具体类。
4. 属性菜单由 provider 出**数据**（`getMenuItems()`），ui 出**渲染**；契约在 `platform/menuSchema.js`。

### 6.3 属性菜单（两个维度）

工具栏的二级属性菜单按两个正交维度拆分：

- **UI 维度（`ui`）**：弹层壳 + 通用渲染器 + widget 原语（color-grid / slider / toggle，未来可加 dropdown）。唯一含 UI 逻辑处；原语建一次、持久复用（切换只 show/hide + 更新值 + 动态分隔符，不销毁重建）。
- **Provider 维度（`annotation` tool / `utilities`）**：每个可配置对象经 `getMenuItems()` 声明自己的菜单（**纯数据**：`{kind,key,params,value}` 有序数组，条件项是当前值的纯函数），并实现 `set(key,value)`。零 UI 逻辑、零 ui 依赖。

契约（kind 词汇 + 量程常量）在 `platform/menuSchema.js`，三方共享。"专有"控件（blur 的 mode/blockSize）本质是 slider/toggle 的**参数差异**，非独立控件类型；真正 bespoke 时再往 ui 原语词汇加一个（一处），provider 声明对应 kind 即可。菜单变更经单一 `property-changed(key,value)` 回写 provider，ui 无工具专有分支。

### 6.4 快捷键架构

`shortcutDispatcher`（`src/orchestrator/shortcutDispatcher.js`，属 `orchestrator`）只做**键码 → 意图**映射（`KEY_MAP` + `_matchIntent` + 读 `TOOL_SHORTCUTS` 的 `_matchToolShortcut`），执行委托给 `orchestrator.execute(intent)`。工具自身键绑定在 `annotation/tools/index.js` 的 `keybindings` 声明，dispatcher 不碰工具逻辑。会话级命令（undo/copy/save-as/ocr-*）由 `orchestrator.execute` 翻译成对各 context 已有接口的调用。

### 6.5 UI 按钮语义 ↔ Context 对照

工具栏按钮按行为分为三组（见 `src/ui/toolbarLayout.js`）：

- **select** — 截图操作区（`capture` 领域 + `ui` 的 select 按钮）。先于批注存在，影响所有工具的操作区域。
- **annotate** — 批注的一切：`drag` + `undo` + `clear` + 所有批注工具。对应 `annotation` + `canvas` 协作，按钮在 `ui`。**ocr 激活时整组置灰**（沿用现有置灰交互，不整组抽离）。
- **utility** — 非批注功能（`utilities/`，当前 ocr）。有独立生命周期，不需要 undo/clear。

### 6.6 关键约束图

```
        协调中枢是唯一交汇点
              │
   ┌──────────┼──────────┐
   ▼          ▼          ▼
 组件 ──✗──▶ 组件     组件 ──▶ 画板
 (互不反向依赖)        (只能经中枢注入的端口)
```

---

## 7. 历史边界决议

以下决策澄清了长期模糊的边界。后续如有类似争议，先查此处再讨论。

- **Blur**：`BlurTool` 是 tool，留在 `annotation/tools/`（与其他工具同级）；其像素化后端引擎作内部实现置于 `tools/blur/engine.js`（不与之平级）。`ScreenshotCapture` 不再持有 `blurSelector`，改为遍历 `strokes[].paintTo(...)`（blur 的 `paintTo` 内部调 `composeBlurStrokes`）。消除 capture → annotation 的反向依赖。
- **DragTool / TextEntryManager**：归入 **annotation**（`src/annotation/input/`，标注工具的输入翻译层），不是独立概念；`interaction` 概念取消，概念模型回到 5 组件 + board + orchestrator。
- **`DrawingInputOverlay` → `InputCatcher` 改名**：已完成，避免与概念 `overlay`（批注覆盖层）撞义；现留 `board/`，属画板内部事件入口。
- **协调中枢 Orchestrator**：`src/orchestrator/` 是 `execute(intent)` 的实现者（装配 + 信号编排 + 意图分发）；`extension.js` 仅做 GNOME 生命周期壳与装配委托，不再含业务。

---

## 8. 技术备忘

### Blur 坐标系规范

`annotation/blur/engine.js` 中所有 surface（实时预览/画笔 stroke/马赛克）遵循以下不变式：

- **放置原点**统一用 `regionAbs / _stageScale`（**不用 `region`**），确保屏幕空间渲染与 surface 内容对齐。
- **block 栅格锚点** `originAbs` 永远取第一落笔点的绝对 device 坐标（`round(startPt × _stageScale)`），不依赖 region。这样 block 格子在拖拽全程锚定起点，已绘制的马赛克区域不会随选区扩大而滑动。
- **核心陷阱**：分数 `_stageScale` 下 `round(A × ds) - round(B × ds) ≠ round((A-B) × ds)`，差 ±1 device pixel → 可见抖动。解法见 `engine.js` 头部注释块。
