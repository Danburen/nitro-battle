import { setGameHtml, setGameText } from "../ui/text.ts";
import type { DebugBridge } from "./types.ts";

const LOG_CAP = 300;

/** Quake-style in-page console. A thin view over the shared command bridge. */
export function mountTerminal(bridge: DebugBridge, open = false): () => void {
    const root = document.createElement("div");
    root.id = "debug-terminal";
    root.className = open ? "" : "hidden";
    setGameHtml(root, `
        <div class="debug-term-head"><b>调试终端</b><span>\` 开关 · ↑↓ 历史 · Esc 收起</span></div>
        <div class="debug-term-log" aria-live="polite"></div>
        <form class="debug-term-form" autocomplete="off">
            <span aria-hidden="true">›</span>
            <input type="text" placeholder="输入 help 查看命令" spellcheck="false" aria-label="调试命令" />
        </form>`);
    document.body.appendChild(root);

    const log = root.querySelector<HTMLElement>(".debug-term-log");
    const input = root.querySelector<HTMLInputElement>("input");
    const form = root.querySelector<HTMLFormElement>("form");
    if (!log || !input || !form) return () => root.remove();

    const print = (text: string, tone: "cmd" | "ok" | "err"): void => {
        const line = document.createElement("div");
        line.className = `debug-term-line ${tone}`;
        setGameText(line, text, "plain");
        log.appendChild(line);
        while (log.childElementCount > LOG_CAP) log.firstElementChild?.remove();
        log.scrollTop = log.scrollHeight;
    };

    const setOpen = (visible: boolean): void => {
        root.classList.toggle("hidden", !visible);
        if (visible) input.focus();
    };

    let historyIndex = bridge.history().length;
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const line = input.value;
        if (!line.trim()) return;
        print(`› ${line}`, "cmd");
        const result = bridge.run(line);
        for (const output of result.output) print(output, result.ok ? "ok" : "err");
        input.value = "";
        historyIndex = bridge.history().length;
    });

    input.addEventListener("keydown", (event) => {
        const history = bridge.history();
        if (event.key === "ArrowUp") {
            event.preventDefault();
            historyIndex = Math.max(0, historyIndex - 1);
            input.value = history[historyIndex] ?? "";
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            historyIndex = Math.min(history.length, historyIndex + 1);
            input.value = history[historyIndex] ?? "";
        } else if (event.key === "Escape") {
            setOpen(false);
        }
    });

    const handleGlobalKey = (event: KeyboardEvent): void => {
        if (event.key !== "`") return;
        const target = event.target;
        // Other editors keep their backtick; the terminal input uses it as a toggle.
        if (target instanceof HTMLElement && target.matches("input, textarea, select") && !root.contains(target)) return;
        event.preventDefault();
        setOpen(root.classList.contains("hidden"));
    };
    document.addEventListener("keydown", handleGlobalKey);

    print("调试终端已就绪 · 输入 help 查看命令", "ok");
    if (open) input.focus();
    return () => {
        document.removeEventListener("keydown", handleGlobalKey);
        root.remove();
    };
}
