import type { GameEngine } from "../../game/engine.ts";
import { nationDisplayColor } from "../../game/access.ts";
import { NEUTRAL, SEASONS } from "../../game/types/world.ts";
import type { LogEntry } from "../../game/types/log.ts";
import { chipToken, escapeHtml, renderGameText } from "../text.ts";
import { buildReportDigest, OUTCOME_LABEL } from "./digest.ts";
import type { DayBlock, ProductionAgg } from "./digest.ts";

const PLACE_LIMIT = 3;

/**
 * Battle report UI. The floating area only shows headline events; expanding it
 * reveals the day-by-day detail, grouped by nation as before.
 */
export class BattleReport {
    private readonly engine: GameEngine;
    private expanded = false;
    private readonly openKeys = new Set<string>();
    private readonly live = document.querySelector<HTMLElement>("#feed-live") as HTMLElement;
    private readonly history = document.querySelector<HTMLElement>("#feed-history") as HTMLElement;
    private readonly toggleBtn = document.querySelector<HTMLButtonElement>("#feed-toggle") as HTMLButtonElement;

    constructor(engine: GameEngine) {
        this.engine = engine;
        this.live.addEventListener("toggle", this.rememberOpen, true);
    }

    toggle(): void {
        this.expanded = !this.expanded;
        this.history.classList.toggle("hidden", !this.expanded);
        this.toggleBtn.textContent = this.expanded ? "▴" : "▾";
        this.toggleBtn.setAttribute("aria-label", this.expanded ? "收起战场直播明细" : "展开战场直播明细");
        if (this.expanded) this.renderDetail();
    }

    render(): void {
        const { highlights } = buildReportDigest(this.engine.state);
        const season = SEASONS[this.engine.state.seasonIndex]?.name ?? "";
        const header = `
            <div class="feed-global">
                <span class="feed-season">D${this.engine.state.day} · ${escapeHtml(season)}</span>
            </div>`;
        const items = highlights.map((entry) => this.highlightHtml(entry)).join("");
        this.live.innerHTML = items ? header + `<div class="feed-highlights">${items}</div>` : header;
        if (this.expanded) this.renderDetail();
    }

    destroy(): void {
        this.live.removeEventListener("toggle", this.rememberOpen, true);
        this.live.innerHTML = "";
        this.history.innerHTML = "";
        this.history.classList.add("hidden");
        this.expanded = false;
        this.toggleBtn.textContent = "▾";
        this.openKeys.clear();
    }

    private readonly rememberOpen = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof HTMLDetailsElement) || !target.dataset.key) return;
        if (target.open) this.openKeys.add(target.dataset.key);
        else this.openKeys.delete(target.dataset.key);
    };

    private highlightHtml(entry: LogEntry): string {
        const event = entry.event;
        const own = event?.kind === "capture" && Boolean(event.stateFlipped);
        const lost = own && event?.previousOwner === 0 && event?.nation !== 0;
        const mark = own ? (lost ? "▼" : "▲")
            : event?.kind === "claim" ? "!"
                : event?.kind === "season" ? "◈"
                    : event?.kind === "peace" ? "✓" : "★";
        return `<div class="feed-highlight tone-${entry.tone}${lost ? " feed-highlight--lost" : ""}">
            <span class="feed-highlight-mark">${mark}</span>
            <span class="feed-highlight-text">${renderGameText(entry.text)}</span>
            <span class="feed-highlight-day">D${entry.day}</span>
        </div>`;
    }

    private renderDetail(): void {
        const { days, globals } = buildReportDigest(this.engine.state);
        const pinned = globals.length
            ? `<div class="feed-global">${globals.map((entry) => `<span class="feed-global-item">${renderGameText(entry.text)}</span>`).join("")}</div>`
            : "";
        this.history.innerHTML = pinned + (days.length
            ? days.map((block) => this.dayHtml(block)).join("")
            : '<p class="feed-empty">最近 3 [[turn]]没有可展开的战况。</p>');
        for (const el of this.history.querySelectorAll<HTMLDetailsElement>("details[data-key]")) {
            el.open = this.openKeys.has(el.dataset.key!);
        }
    }

    private dayHtml(block: DayBlock): string {
        const latest = this.engine.state.day;
        const season = latest === block.day ? SEASONS[this.engine.state.seasonIndex]?.name ?? "" : "";
        const body = [
            ...block.stars.map((entry) => this.starHtml(entry)),
            ...this.captureGroups(block),
            ...this.battleGroup(block),
            ...this.productionGroups(block),
            ...block.other.map((entry) => `<div class="feed-other">${renderGameText(entry.text)}</div>`),
        ].join("");
        return `<section class="feed-day">
            <div class="feed-day-head"><span>D${block.day}</span>${season ? `<span>${escapeHtml(season)}</span>` : ""}</div>
            ${body}
        </section>`;
    }

    private starHtml(entry: LogEntry): string {
        return `<div class="feed-star tone-${entry.tone}"><span class="feed-star-mark">★</span>${renderGameText(entry.text)}</div>`;
    }

    private captureGroups(block: DayBlock): string[] {
        const groups = new Map<number, LogEntry[]>();
        for (const entry of block.captures) {
            const nation = entry.event?.nation ?? NEUTRAL;
            groups.set(nation, [...(groups.get(nation) ?? []), entry]);
        }
        return [...groups.entries()].map(([nation, entries]) => {
            const key = `cap:${block.day}:${nation}`;
            const states = [...new Set(entries.map((entry) => entry.event?.stateName).filter((name): name is string => Boolean(name)))];
            const tail = states.length ? ` · ${states.slice(0, 2).map((name) => escapeHtml(name)).join("、")}${states.length > 2 ? "等" : ""}` : "";
            const rows = entries.map((entry) => `<li>${renderGameText(entry.text)}</li>`).join("");
            return `<details class="feed-fold" data-key="${key}"${this.openKeys.has(key) ? " open" : ""}>
                <summary>${this.nationChip(nation)} 占领 ${entries.length} 省${tail}</summary>
                <ul class="feed-list">${rows}</ul>
            </details>`;
        });
    }

    private battleGroup(block: DayBlock): string[] {
        if (!block.battles.length) return [];
        const groups = new Map<number, typeof block.battles>();
        for (const battle of block.battles) {
            const list = groups.get(battle.nation) ?? [];
            list.push(battle);
            groups.set(battle.nation, list);
        }
        return [...groups.entries()].map(([nation, battles]) => {
            const key = `battle:${block.day}:${nation}`;
            const rows = battles.map((battle) => {
                const multi = battle.roundsSeen > 1 ? "累计" : "";
                const outcome = battle.breach && battle.outcome !== "captured"
                    ? `${OUTCOME_LABEL[battle.outcome]} · 防线崩溃`
                    : OUTCOME_LABEL[battle.outcome];
                return `<li class="feed-battle-line">
                    <span>${escapeHtml(battle.province)}会战 D${battle.rounds}</span>
                    <span class="feed-loss-text">${multi}攻损<span class="feed-loss">${battle.attackLoss}</span> / 守损<span class="feed-loss">${battle.defenseLoss}</span></span>
                    <span class="feed-outcome">${outcome}</span>
                </li>`;
            }).join("");
            return `<details class="feed-fold" data-key="${key}"${this.openKeys.has(key) ? " open" : ""}>
                <summary>${this.nationChip(nation)} 会战 ${battles.length} 场</summary>
                <ul class="feed-list">${rows}</ul>
            </details>`;
        });
    }

    private productionGroups(block: DayBlock): string[] {
        return block.production.map((group) => this.productionHtml(block.day, group));
    }

    private productionHtml(day: number, group: ProductionAgg): string {
        const key = `prod:${day}:${group.nation}`;
        const parts: string[] = [];
        if (group.train.size) parts.push(`训练 ${this.countText(group.train)}`);
        if (group.buildStart.size) parts.push(`建造 ${this.countText(group.buildStart)}${this.placesText(group.buildStartPlaces)}`);
        if (group.buildDone.size) parts.push(`建成 ${this.countText(group.buildDone)}${this.placesText(group.buildDonePlaces)}`);
        if (group.deploy.size) parts.push(`部署 ${this.countText(group.deploy)}${this.placesText(group.deployPlaces)}`);
        const rows = group.entries.map((entry) => `<li>${renderGameText(entry.text)}</li>`).join("");
        return `<details class="feed-prod" data-key="${key}"${this.openKeys.has(key) ? " open" : ""}>
            <summary>${this.nationChip(group.nation)}：${parts.join("；")}</summary>
            <ul class="feed-list">${rows}</ul>
        </details>`;
    }

    private countText(counts: Map<string, number>): string {
        return [...counts.entries()].map(([label, count]) => `${escapeHtml(label)}×${count}`).join("、");
    }

    private placesText(places: readonly string[]): string {
        if (!places.length) return "";
        const shown = places.slice(0, PLACE_LIMIT).map((place) => escapeHtml(place)).join("、");
        return `（${shown}${places.length > PLACE_LIMIT ? "等" : ""}）`;
    }

    private nationChip(id: number | undefined): string {
        if (id === undefined || id === NEUTRAL) return "中立守军";
        const nation = this.engine.state.nations[id];
        if (!nation) return "未知国家";
        return renderGameText(chipToken(nationDisplayColor(this.engine.state, id), nation.name));
    }
}
