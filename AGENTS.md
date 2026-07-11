# 项目约束

1. **硬边界**：
   - 只读目录：`/docs/0_aim.md` 和 `/docs/1_specs/`（可提修改建议，不可代改）。
   - 技术栈锁定：GJS，St 组件。
2. **任务指针**：开始任何工作前，先读 `docs/3_now.md`。只做该文件中列出的当前唯一事项。
3. **落地即剔除**：事项完成后，由我（人）手动从 `docs/3_now.md` 中删除该条目，你负责提醒。

## 分支策略

禁止直接 push 到 `master` 分支。所有变更通过 PR 合并。

## 提交规范

commit 格式见 [`docs/commits.md`](docs/commits.md)。
