# AGENTS.md · Nitro Battle

项目上下文见 `.ai/PROJECT.md`（唯一协作文档）。以下为硬约束，冲突时以 `.ai/PROJECT.md` 为准。

## 开发前

- 动跨模块代码或改玩法前先读 `.ai/PROJECT.md`（架构、约定、Electron 评估都在其中）。
- 桌面化（Electron）相关决策见 `.ai/PROJECT.md` §8，不要另起方案。

## 不可破坏的约束

1. **零运行时依赖**：`package.json` 只有 `typescript` + `vite` 两个 devDependency。新增依赖必须先说明理由。
2. `src/game/**` 不得引用 DOM/`window`/`localStorage`，必须能在 Node 里直接跑（测试依赖这一点）。
3. UI/渲染器只读 `engine.state`；所有状态变更必须经 `GameEngine` 门面方法。
4. 游戏逻辑禁止 `Math.random()`；只用 `core.rand` 或 `new LCGRandom(seed ^ 常量)`。
5. 导入必须带 `.ts` 后缀，类型导入用 `import type`，只用具名导出，不用 `enum`。
6. 玩家可见文案用中文 + `ui/text.ts` 的 token（`[[funds:+2]]`、`chipToken`），不要手拼数值 HTML。

## 提交前

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

当前基线：`typecheck` 通过，`lint` 0 问题，`node --test` 226 个用例全绿（2026-11-21）。

## 文档同步

改了规则/数值/架构/构建方式，同步更新 `.ai/` 下对应文档；设计稿放 `docs/`。
