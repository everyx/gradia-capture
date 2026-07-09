# 概念模型

本文件定义 gradia-capture 的核心概念与协作方式。各 bounded context 的目录划分与依赖约束见 [`../CONTEXT.md`](../CONTEXT.md)，此处只讲"概念是什么、怎么协作"。

## 四个核心概念

| 概念 | 本质 | 职责 |
|---|---|---|
| **协调中枢 Orchestrator** | 唯一装配者 + 事件路由表 | 创建组件 / 画板 / 交互，订阅信号，把事件派发到 handler |
| **组件 Components** | 独立功能模块（capture / annotation / utilities / ui / platform） | 各自边界内功能，只经事件 + 端口通信 |
| **画板 Board** | 绘制载体 + 数据模型 | 多屏画布集合、Stroke 原子存储、渲染 / 命中 / 撤销 / 聚合 |
| **交互 Interaction** | 输入 → 命令翻译器（dragTool / textEntryManager 等） | 把用户输入翻译成对画板 / 组件的命令，不认识具体工具 |

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  协调中枢     │  │   组件        │  │   画板        │  │   交互        │
│ Orchestrator │  │ Components   │  │   Board      │  │ Interaction  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ 事件路由         │ emit 事件        │ Stroke 原子     │ 输入→命令
       ▼                 ▼                 ▼                 ▼
  事件→handler 映射   独立功能模块      多屏画布+聚合      翻译用户输入
```

## 统一事件流（概念层）

所有跨概念通信在概念上都建模为**事件流**：事件源 emit 事件，协调中枢查"事件 → handler"映射并派发，handler 落在组件或画板。

```
组件 emit 事件 ─┐
输入 emit 事件 ─┼─▶ 协调中枢(事件→handler 映射) ─▶ 派发 ─┬─▶ 组件(算/取)
快捷键 emit ───┘                                        └─▶ 画板(画/聚)
                唯一交汇点 · 只认事件与端口，不认具体类
```

> 现状代码里"三种通道"——GNOME 原生信号（`toolbar.connect('tool-changed')`）、输入回调表（`_inputRegistry`）、工具激活回调（`_contextActivate`）、会话命令（`execute(intent)`）——在概念上**都是"事件 → handler 映射"**。本次重构**不抽独立 EventBus**，代码机制保持原生信号 + 直接回调；文档仅在概念层统一描述为事件驱动。

## Stroke（画板数据原子）

> **Stroke = 画板数据模型的原子**：最小可渲染 / 可命中 / 可撤销 / 可序列化单元。自带渲染能力与合成阶段属性，**无工具身份**。工具在产生它时注入能力（`renderTo`）与 `phase`，下游只消费这些属性。

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
- 代码中的 `InputCatcher`（原 `DrawingInputOverlay`，输入事件捕获层）与概念上的 `overlay`（批注覆盖层）无关；`overlay` 一词专指批注覆盖层。

## 通用约定

1. 数据（Stroke）随身带能力（`renderTo`）与 `phase`，组件消费能力 / 属性，不消费类型。
2. 交互层只翻译输入 → 画板 / 组件命令，不认识具体工具。
3. 组件间只经事件 + 端口通信，不认识具体类。
4. 依赖约束维持 [`CONTEXT.md`](../CONTEXT.md)：annotation 不反向依赖 capture / utilities / ui；utilities 之间互不依赖且不依赖 annotation；ocr 仅依赖 capture；全部可依赖 platform。

## 边界决议（历史模糊点）

- **Blur**：像素化引擎留 `annotation/blur/`，但 `ScreenshotCapture` 不再持有 `blurSelector`，改为遍历 `strokes[].renderTo(pixbuf)`（blur 的 `renderTo` 内部调 `composeOutput`）。消除 capture → annotation 的反向依赖。
- **DragTool / TextEntryManager**：归入 **Interaction** 概念，从 `ui/` 拆出；`ui/` 只保留纯 GNOME 原生 UI 适配（toolbar / popupMenu / toolPropsMenu / resolutionOverlay / widgets）。
- **`DrawingInputOverlay` → `InputCatcher` 改名**：已完成，避免与概念 `overlay`（批注覆盖层）撞义。

## 关键约束图

```
        协调中枢是唯一交汇点
              │
   ┌──────────┼──────────┐
   ▼          ▼          ▼
 组件 ──✗──▶ 组件     组件 ──▶ 画板
 (互不反向依赖)        (只能经中枢注入的端口)
```
