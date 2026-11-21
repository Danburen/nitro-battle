// @ts-check
/**
 * 预加载脚本：渲染进程唯一的桌面能力入口（`window.nitro`）。
 * 浏览器版本没有该对象，前端用 `window.nitro?.xxx` 可选调用。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nitro", {
    isDesktop: true,
    platform: process.platform,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
    },
    getAppInfo: () => ipcRenderer.invoke("nitro:app-info"),
    toggleFullscreen: () => ipcRenderer.invoke("nitro:toggle-fullscreen"),
    quit: () => ipcRenderer.invoke("nitro:quit"),
});
