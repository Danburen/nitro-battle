// @ts-check
/**
 * Electron 主进程：把 Vite 产物（dist/）装进桌面外壳。
 *
 * - 自定义 `app://` 协议服务 dist（`file://` 下 ESM 脚本会被 CORS 拦截）。
 * - 渲染进程零 Node 能力；桌面能力只经 preload 的 `window.nitro` 暴露。
 * - 开发模式：设置 NITRO_DEV_SERVER=http://127.0.0.1:5173 直接加载 Vite dev server。
 */
import { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEV_SERVER = process.env.NITRO_DEV_SERVER ?? "";
const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://nitro`;
const APP_ENTRY = `${APP_ORIGIN}/index.html`;
const ALLOWED_ORIGIN = DEV_SERVER !== "" ? new URL(DEV_SERVER).origin : APP_ORIGIN;
const WINDOW_BACKGROUND = "#0d1117";

const APP_ROOT = app.getAppPath();
const DIST_DIR = path.join(APP_ROOT, "dist");
const PRELOAD = path.join(APP_ROOT, "electron", "preload.cjs");

protocol.registerSchemesAsPrivileged([
    {
        scheme: APP_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
]);

/** @type {BrowserWindow | null} */
let mainWindow = null;

/**
 * 把 `app://nitro/<path>` 映射到 dist 目录，并挡住路径穿越。
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function serveDist(request) {
    const { pathname } = new URL(request.url);
    /** @type {string} */
    let relative;
    try {
        relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    } catch {
        return new Response("Bad Request", { status: 400 });
    }
    const target = path.normalize(path.join(DIST_DIR, relative));
    const inside = target === DIST_DIR || target.startsWith(DIST_DIR + path.sep);
    if (!inside) return new Response("Forbidden", { status: 403 });

    try {
        return await net.fetch(pathToFileURL(target).toString());
    } catch {
        return new Response("Not Found", { status: 404 });
    }
}

function buildMenu() {
    if (process.platform !== "darwin") {
        Menu.setApplicationMenu(null);
        return;
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        { role: "windowMenu" },
    ]));
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 640,
        backgroundColor: WINDOW_BACKGROUND,
        show: false,
        autoHideMenuBar: true,
        title: "Nitro Battle",
        webPreferences: {
            preload: PRELOAD,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
            backgroundThrottling: false,
        },
    });

    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
        if (mainWindow === win) mainWindow = null;
    });

    // 页面内不缩放（Ctrl+滚轮只用于地图），外部链接交给系统浏览器。
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
        // 窗口提前销毁时忽略。
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
        /** @type {string} */
        let origin = "";
        try {
            origin = new URL(url).origin;
        } catch {
            // 非法 URL 一律拦下。
        }
        if (origin !== ALLOWED_ORIGIN) event.preventDefault();
    });

    const loading = DEV_SERVER !== "" ? win.loadURL(DEV_SERVER) : win.loadURL(APP_ENTRY);
    loading.catch((error) => {
        console.error("[nitro] 页面加载失败", error);
    });
    return win;
}

function registerIpc() {
    ipcMain.handle("nitro:app-info", () => ({
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
    }));
    ipcMain.handle("nitro:toggle-fullscreen", (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return false;
        win.setFullScreen(!win.isFullScreen());
        return win.isFullScreen();
    });
    ipcMain.handle("nitro:quit", () => {
        app.quit();
    });
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    void app.whenReady().then(() => {
        protocol.handle(APP_SCHEME, serveDist);
        buildMenu();
        registerIpc();
        mainWindow = createWindow();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
        });
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
}
