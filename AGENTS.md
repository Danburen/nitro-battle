# AGENTS.md · Nitro Battle

项目上下文见 `.ai/PROJECT.md`（唯一协作文档）。以下为硬约束，冲突时以 `.ai/PROJECT.md` 为准。

## 开发前

- 动跨模块代码或改玩法前先读 `.ai/PROJECT.md`（架构、约定、Electron 评估都在其中）。
- 桌面化（Electron）相关决策见 `.ai/PROJECT.md` §8，不要另起方案。

## 不可破坏的约束

1. **零运行时依赖**：`dependencies` 为空。devDependencies 仅构建/检查工具（`typescript`、`vite`、ESLint 栈）与桌面外壳（`electron`、`electron-builder`、`@types/node`）。新增依赖必须先说明理由。
2. `src/game/**` 不得引用 DOM/`window`/`localStorage`，必须能在 Node 里直接跑（测试依赖这一点）。
3. UI/渲染器只读 `engine.state`；所有状态变更必须经 `GameEngine` 门面方法。
4. 游戏逻辑禁止 `Math.random()`；只用 `core.rand` 或 `new LCGRandom(seed ^ 常量)`。
5. 导入必须带 `.ts` 后缀，类型导入用 `import type`，只用具名导出，不用 `enum`。
6. 玩家可见文案用中文 + `ui/text.ts` 的 token（`[[funds:+2]]`、`chipToken`），不要手拼数值 HTML。
7. 桌面端：渲染进程零 Node 能力（`contextIsolation` + `sandbox`，不开 `nodeIntegration`）；桌面能力只经 `window.nitro`（`src/desktop.ts`）可选调用，浏览器版必须继续可用；不要把游戏逻辑搬进主进程。
8. **音效统一入口**：业务代码只调用 `sound.play(name, context?)` / `ctx.sound.play(name)`；模板、并发/优先级/超限策略在 `src/audio/strategy.ts`，合成与压缩/限制器总线在 `src/audio/mix.ts`，不要在其他地方另建 `AudioContext` 或直接播放声音。

## 提交前

```bash
npm run typecheck   # tsc -b（tsconfig.app 浏览器侧 + tsconfig.node 脚本侧）
npm run lint
npm test
npm run build
```

当前基线：`typecheck` 通过，`lint` 0 问题，`node --test` 272 个用例全绿；`electron:build` 可出 NSIS 安装包（2026-11-23）。

## 文档同步

改了规则/数值/架构/构建方式，同步更新 `.ai/` 下对应文档；设计稿放 `docs/`。
