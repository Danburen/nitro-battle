import { defineConfig } from "vite";

export default defineConfig({
    // 相对路径产物：Electron 的 app:// 外壳与静态托管都能直接加载。
    base: "./",
    server: {
        port: 5173,
        host: "127.0.0.1",
    },
});
