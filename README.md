# Nitro Battle · 硝基战役

零运行时依赖的单机回合制大战略游戏：Voronoi 程序生成大陆、军团与补给、外交与政策。同一份代码跑网页与 Electron 桌面端。

完整上下文见 [`.ai/PROJECT.md`](.ai/PROJECT.md)。

## 网页版

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # → dist/（相对路径产物，可静态托管）
npm run preview    # 预览 dist/
```

## 桌面版（Electron）

```bash
npm run electron:dev     # Vite dev server + Electron，带热更新
npm run electron:start   # 构建后用 Electron 加载 dist/
npm run electron:build   # 打安装包 → release/（Windows NSIS / macOS dmg / Linux AppImage）
```

- 渲染进程零 Node 能力（`contextIsolation` + `sandbox`），桌面能力只经 preload 暴露的 `window.nitro`，浏览器版行为不变。
- 页面走自定义 `app://nitro/` 协议（`file://` 下 ESM 会被 CORS 拦、`localStorage` 为 opaque origin）。
- 下载慢时设镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，打包再加 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。
- 应用图标当前为 Electron 默认图标，放到 `build/icon.ico`（Windows）/ `build/icon.icns`（macOS）即可替换。

## 检查

```bash
npm run typecheck   # tsc -b（tsconfig.app 浏览器侧 + tsconfig.node 脚本侧）
npm run lint
npm test            # node --test，226 个回归用例
```

## 其他

```bash
npm run gen:names   # 地名池生成脚本：node src/tools/gen-names.ts --seed 42 --count 8
```
