import type { GameEngine } from "../game/engine.ts";
import type { LogEntry } from "../game/types.ts";
import { renderGameText } from "./text.ts";

const FEED_HOLD_MS = 6000;
const FEED_FADE_MS = 450;
const FEED_MAX_VISIBLE = 5;

/** Live battle feed above the map: fade in, hold, fade out; arrow expands history. */
export class BattleFeed {
    private readonly engine: GameEngine;
    private readonly timers = new Set<number>();
    private lastEntry: LogEntry | null = null;
    private expanded = false;
    private readonly live = document.querySelector<HTMLElement>("#feed-live") as HTMLElement;
    private readonly history = document.querySelector<HTMLElement>("#feed-history") as HTMLElement;
    private readonly toggleBtn = document.querySelector<HTMLButtonElement>("#feed-toggle") as HTMLButtonElement;

    constructor(engine: GameEngine) {
        this.engine = engine;
        const log = engine.state.log;
        this.lastEntry = log[log.length - 1] ?? null;
    }

    toggle(): void {
        this.expanded = !this.expanded;
        this.history.classList.toggle("hidden", !this.expanded);
        this.toggleBtn.textContent = this.expanded ? "▴" : "▾";
        this.toggleBtn.setAttribute("aria-label", this.expanded ? "收起历史战报" : "展开历史战报");
        if (this.expanded) this.renderHistory();
    }

    render(): void {
        const log = this.engine.state.log;
        const last = log[log.length - 1] ?? null;
        if (!last) return;
        const index = this.lastEntry ? log.indexOf(this.lastEntry) : log.length - 1;
        const fresh = index >= 0 ? log.slice(index + 1) : log.slice(-1);
        this.lastEntry = last;
        for (const entry of fresh) {
            if (entry.tone !== "econ") this.push(entry);
        }
        if (this.expanded) this.renderHistory();
    }

    destroy(): void {
        for (const timer of this.timers) window.clearTimeout(timer);
        this.timers.clear();
        this.live.innerHTML = "";
        this.history.innerHTML = "";
        this.history.classList.add("hidden");
        this.expanded = false;
        this.toggleBtn.textContent = "▾";
    }

    private push(entry: LogEntry): void {
        const el = document.createElement("div");
        el.className = `feed-msg tone-${entry.tone}`;
        el.innerHTML = `<span class="feed-day">D${entry.day}</span>${renderGameText(entry.text)}`;
        this.live.appendChild(el);
        while (this.live.children.length > FEED_MAX_VISIBLE) {
            this.live.firstElementChild?.remove();
        }
        const hold = window.setTimeout(() => {
            this.timers.delete(hold);
            el.classList.add("out");
            const fade = window.setTimeout(() => {
                this.timers.delete(fade);
                el.remove();
            }, FEED_FADE_MS);
            this.timers.add(fade);
        }, FEED_HOLD_MS);
        this.timers.add(hold);
    }

    private renderHistory(): void {
        const entries = [...this.engine.state.log].reverse().map((entry) => `
            <li class="log-entry tone-${entry.tone}">
                <span class="log-day">D${entry.day}</span>
                <span class="log-text">${renderGameText(entry.text)}</span>
            </li>`).join("");
        this.history.innerHTML = `<ul class="log-list">${entries}</ul>`;
    }
}