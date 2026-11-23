# AGENTS.md · Nitro Battle

本文件**只放架构约定**（必须遵守的硬约束）。架构地图见 `.ai/PROJECT.md`；当前状态、历史与业务决策在 `.ai/context/`（由 log-context skill 维护）。业务规则不写进文档——以代码为准，按需实时探索。

## 硬约束

1. **零运行时依赖**：`dependencies` 为空；devDependencies 仅构建/检查工具与 Electron 外壳。新增依赖须先说明理由。
2. **`src/game/**` 平台无关**：不得引用 DOM / `window` / `localStorage` / Canvas，必须能在 Node 里直接跑（测试依赖此点）。
3. **单向数据流**：UI / 渲染器只读 `engine.state`；所有状态变更必须经 `GameEngine` 门面方法，由领域模块改 state 并 `emit`。
4. **确定性**：游戏逻辑禁 `Math.random()`；随机只用 `core.rand` 或 `new LCGRandom(seed ^ 常量)`。
5. **导入与语法**：导入带 `.ts` 后缀，类型导入用 `import type`，只用具名导出（无 `export default`），不用 `enum`。
6. **文案**：玩家可见文案用中文 + `ui/text.ts` 的 token（`[[funds:+2]]`、`chipToken`），不手拼数值 HTML。
7. **桌面端**：渲染进程零 Node 能力（`contextIsolation` + `sandbox`）；桌面能力只经 `window.nitro`（`src/desktop.ts`）可选调用，浏览器版必须继续可用；游戏逻辑不进主进程。
8. **音效统一入口**：业务代码只调 `sound.play(name, context?)`；策略在 `src/audio/strategy.ts`，合成/压缩/限制在 `src/audio/mix.ts`，别处不另建 `AudioContext`。
9. **测试按需运行**：不主动跑测试、不主动生成测试输出；仅当用户明确要求时才跑 `npm test`，日常验证最多用 Playwright 做可视化检查。

## 提交前

用户明确要求时才按序执行：`npm run typecheck` → `npm run lint` → `npm test` → `npm run build`；未要求时最多用 Playwright 检查。
