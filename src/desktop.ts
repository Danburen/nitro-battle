/**
 * 桌面端桥接：Electron preload 注入的 `window.nitro`。
 * 浏览器里 `desktop` 为 `null`，调用方一律用可选链，保证网页版行为不变。
 */
export type DesktopAppInfo = {
    name: string;
    version: string;
    platform: string;
    arch: string;
    electron: string;
    chrome: string;
};

export type DesktopBridge = {
    isDesktop: true;
    platform: string;
    versions: { electron: string; chrome: string; node: string };
    getAppInfo(): Promise<DesktopAppInfo>;
    toggleFullscreen(): Promise<boolean>;
    quit(): Promise<void>;
};

declare global {
    interface Window {
        nitro?: DesktopBridge;
    }
}

export const desktop: DesktopBridge | null = typeof window === "undefined" ? null : window.nitro ?? null;
export const isDesktop = desktop !== null;
