# 0001. captureContext 保持普通可注入函数，不形式化为 port

- 状态：已接受
- 日期：2026-07-09

## 背景

架构评审提出候选 #6：把 `src/capture/captureContext.js` 的 `getCaptureContext()`
形式化为「端口 + stub adapter」，以便脱离 GNOME 测试截图路径。

复核现状：

- `getCaptureContext(ui = Main.screenshotUI)` **已经**以默认参数形式暴露注入点——
  测试可传入 stub `ui`。seam 已存在，无需新增。
- `selection` 分支只依赖 `ui`（`_areaSelector.getGeometry()` + 按钮 + `_scale`）；
  仅 `screen` 分支额外直接读 `Main.layoutManager`，属部分注入。
- 全仓库**无测试套件**，也**只有一个真实 adapter**（`Main.screenshotUI`）。

## 决策

`captureContext` 维持为**普通的可注入纯函数**，不引入正式 port 接口或 stub adapter。

依据 "一个 adapter 只是假想的 seam，两个才是真的"：当前只有单一真实 adapter、
且无测试驱动，形式化 port 属于**没有消费者的推测性基础设施**，反而增加接口负担、
降低 locality。现有 `ui` 默认参数已是恰当的 seam。

## 结果

- 不新增 port/stub 代码；`getCaptureContext(ui)` 保持现状。
- 未来若出现**第二个真实 adapter**（如非 GNOME 后端）或**引入测试套件**并需要 stub
  `screen` 分支，届时再：① 把 `screen` 分支的 `Main.layoutManager` 也改为可注入，
  ② 视需要形式化为 port。在此之前不做。
- 后续架构评审**不应**再把「captureContext 端口化」作为候选重复提出。
