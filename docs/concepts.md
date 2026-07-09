# 概念模型

本文件定义 gradia-capture 的核心概念与协作方式。各 bounded context 的目录划分与依赖约束见 [`../CONTEXT.md`](../CONTEXT.md)，此处只讲"概念是什么、怎么协作"。

## 核心概念

系统由**协调中枢**、**组件**、**画板**三类角色构成。组件是各 bounded context 的统称（capture / annotation / utilities / ui / platform）。

| 概念 | 本质 | 职责 |
|---|---|---|
| **协调中枢 Orchestrator** | 唯一装配者 + 注入端口 | 创建组件 / 画板，经 `emitter` 广播事件，不调用组件内部 |
| **组件 Components** | 独立功能模块（capture / annotation / utilities / ui / platform） | 各自边界内功能，订阅端口自行响应 |
| **画板 Board** | 绘制载体 + 数据模型 | 多屏画布集合、Stroke 原子存储、渲染 / 命中 / 撤销 / 聚合 |

> 标注工具的输入翻译（drag / text）属于 **annotation** 内部（`annotation/input/`），不是独立概念；ui 的按钮语义分组（select / annotate / utility）对应 capture / annotation / utilities 三个组件。

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  协调中枢     │  │   组件        │  │   画板        │
│ Orchestrator │  │ Components   │  │   Board      │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ 事件路由         │ emit 事件        │ Stroke 原子
       ▼                 ▼                 ▼
  事件→handler 映射   独立功能模块      多屏画布+聚合
```

## 统一事件流（概念层）

跨概念通信统一建模为**事件流**：事件经注入端口（`emitter`）广播，订阅者自行响应，不认识对方具体类。

```
组件/输入/快捷键 ──emit──▶ 注入端口(emitter) ──▶ 订阅者(组件/画板)自行响应
                            只认事件与端口，不认具体类
```

> 跨概念通信统一为**事件 → handler 映射**，落在 `src/platform/emitter.js`（`addEmitter`，注入式实例，非全局类）。组件构造时订阅、自行响应（如 `tool-changed`），协调中枢只 emit、不再调用组件内部。**禁止抽独立全局 EventBus 类**——保持"经注入端口通信"，组件不反向依赖 orchestrator。

## Stroke（画板数据原子）

> **Stroke = 画板数据模型的原子**：最小可渲染 / 可命中 / 可撤销 / 可序列化单元。自带渲染能力与合成阶段属性，**无工具身份**。工具在产生它时注入能力（`paintTo`）与 `phase`，下游只消费这些属性。

- Stroke 不是工具本身，也不是像素；它是"工具的输出结果"被抽象为画板原子。
- 画板不关心 Stroke 从哪个工具来，只关心它能否渲染 / 命中 / 撤销 / 导出。
- 工具在产生 Stroke 时写入渲染参数与 `phase`；下游（画板渲染、capture 合成）只消费这些属性，不识别工具类型。

## 合成阶段：underlay / overlay

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

## 通用约定

1. 数据（Stroke）随身带能力（`paintTo`）与 `phase`，组件消费能力 / 属性，不消费类型。
2. 标注工具的输入翻译（drag / text）在 `annotation/input/`，属 annotation 内部，不认识具体工具（经 `stroke.hitBounds` 等能力）。
3. 组件间只经事件 + 端口通信，不认识具体类。
4. 属性菜单由 provider 出**数据**（`getMenuItems()`），ui 出**渲染**；契约在 `platform/menuSchema.js`。详见「属性菜单（两个维度）」。
5. 依赖约束维持 [`CONTEXT.md`](../CONTEXT.md)：annotation 不反向依赖 capture / utilities / ui；utilities 之间互不依赖且不依赖 annotation；ocr 仅依赖 capture；组件不反向依赖 orchestrator；全部可依赖 platform。

## 属性菜单（两个维度）

工具栏的二级属性菜单按两个正交维度拆分：

- **UI 维度（`ui`）**：弹层壳 + 通用渲染器 + widget 原语（color-grid / slider / toggle，未来可加 dropdown）。唯一含 UI 逻辑处；原语建一次、持久复用（切换只 show/hide + 更新值 + 动态分隔符，不销毁重建）。
- **Provider 维度（`annotation` tool / `utilities`）**：每个可配置对象经 `getMenuItems()` 声明自己的菜单（**纯数据**：`{kind,key,params,value}` 有序数组，条件项是当前值的纯函数），并实现 `set(key,value)`。零 UI 逻辑、零 ui 依赖。

契约（kind 词汇 + 量程常量）在 `platform/menuSchema.js`，三方共享。"专有"控件（blur 的 mode/blockSize）本质是 slider/toggle 的**参数差异**,非独立控件类型；真正 bespoke 时再往 ui 原语词汇加一个（一处），provider 声明对应 kind 即可。菜单变更经单一 `property-changed(key,value)` 回写 provider,ui 无工具专有分支。

## 边界决议（历史模糊点）

- **Blur**：`BlurTool` 是 tool，留在 `annotation/tools/`（与其他工具同级）；其像素化后端引擎作内部实现置于 `tools/blur/engine.js`（不与之平级）。`ScreenshotCapture` 不再持有 `blurSelector`，改为遍历 `strokes[].paintTo(...)`（blur 的 `paintTo` 内部调 `composeBlurStrokes`）。消除 capture → annotation 的反向依赖。
- **DragTool / TextEntryManager**：归入 **annotation**（`src/annotation/input/`，标注工具的输入翻译层），不是独立概念；`interaction` 概念取消，概念模型回到 5 组件 + board + orchestrator。
- **`DrawingInputOverlay` → `InputCatcher` 改名**：已完成，避免与概念 `overlay`（批注覆盖层）撞义；现留 `board/`，属画板内部事件入口。
- **协调中枢 Orchestrator**：`src/orchestrator/` 是 `execute(intent)` 的实现者（装配 + 信号编排 + 意图分发）；`extension.js` 仅做 GNOME 生命周期壳与装配委托，不再含业务。

## 关键约束图

```
        协调中枢是唯一交汇点
              │
   ┌──────────┼──────────┐
   ▼          ▼          ▼
 组件 ──✗──▶ 组件     组件 ──▶ 画板
 (互不反向依赖)        (只能经中枢注入的端口)
```
