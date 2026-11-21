// @ts-check
/**
 * 桌面端开发模式：起 Vite dev server，等端口就绪后再拉起 Electron。
 *   npm run electron:dev
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_URL = "http://127.0.0.1:5173";
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

/** @type {string} */
const electronPath = require("electron");
const viteBin = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

/** @param {number} ms */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(DEV_URL, { method: "HEAD" });
            if (response.ok) return true;
        } catch {
            // dev server 还没起来，继续等。
        }
        await sleep(POLL_INTERVAL_MS);
    }
    return false;
}

const vite = spawn(process.execPath, [viteBin], { cwd: ROOT, stdio: "inherit" });
/** @type {import("node:child_process").ChildProcess | null} */
let electron = null;
let shuttingDown = false;

/** @param {number} code */
function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (electron && electron.exitCode === null) electron.kill();
    if (vite.exitCode === null) vite.kill();
    process.exit(code);
}

vite.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
        console.error(`[electron:dev] vite 退出，code=${code}`);
        shutdown(code ?? 1);
    }
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (!(await waitForServer())) {
    console.error(`[electron:dev] 等待 ${DEV_URL} 超时`);
    shutdown(1);
}

electron = spawn(electronPath, [ROOT], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, NITRO_DEV_SERVER: DEV_URL },
});
electron.on("exit", (code) => shutdown(code ?? 0));
