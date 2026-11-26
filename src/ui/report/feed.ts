import type { GameEngine } from "../../game/engine.ts";
import { nationDisplayColor } from "../../game/access.ts";
import { NEUTRAL, SEASONS } from "../../game/types/world.ts";
import type { LogEntry } from "../../game/types/log.ts";
import { t } from "../../i18n/index.ts";
import { chipToken, escapeHtml, gameText, setGameHtml, setGameText } from "../text.ts";
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
        setGameText(this.toggleBtn, this.expanded ? "▴" : "▾", "plain");
        this.toggleBtn.setAttribute("aria-label", this.expanded ? t("misc.feed.toggle.collapse") : t("misc.feed.toggle.expand"));
        if (this.expanded) this.renderDetail();
    }

    render(): void {
        const { highlights } = buildReportDigest(this.engine.state);
        const items = highlights.map((entry) => this.highlightHtml(entry)).join("");
        setGameHtml(this.live, items ? `<div class="feed-highlights">${items}</div>` : "");
        if (this.expanded) this.renderDetail();
    }

    destroy(): void {
        this.live.removeEventListener("toggle", this.rememberOpen, true);
        setGameHtml(this.live, "");
        setGameHtml(this.history, "");
        this.history.classList.add("hidden");
        this.expanded = false;
        setGameText(this.toggleBtn, "▾", "plain");
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
            <span class="feed-highlight-text">${entry.text}</span>
            <span class="feed-highlight-day">D${entry.day}</span>
        </div>`;
    }

    private renderDetail(): void {
        const { days, globals } = buildReportDigest(this.engine.state);
        const pinned = globals.length
            ? `<div class="feed-global">${globals.map((entry) => `<span class="feed-global-item">${entry.text}</span>`).join("")}</div>`
            : "";
        setGameHtml(this.history, pinned + (days.length
            ? days.map((block) => this.dayHtml(block)).join("")
            : `<p class="feed-empty">${t("misc.feed.empty")}</p>`));
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
            ...block.other.map((entry) => `<div class="feed-other">${entry.text}</div>`),
        ].join("");
        return `<section class="feed-day">
            <div class="feed-day-head"><span>D${block.day}</span>${season ? `<span>${escapeHtml(season)}</span>` : ""}</div>
            ${body}
        </section>`;
    }

    private starHtml(entry: LogEntry): string {
        return `<div class="feed-star tone-${entry.tone}"><span class="feed-star-mark">★</span>${entry.text}</div>`;
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
            const tail = states.length
                ? ` · ${states.slice(0, 2).map((name) => escapeHtml(name)).join(t("misc.feed.listSeparator"))}${states.length > 2 ? t("misc.feed.etc") : ""}`
                : "";
            const rows = entries.map((entry) => `<li>${entry.text}</li>`).join("");
            return `<details class="feed-fold" data-key="${key}"${this.openKeys.has(key) ? " open" : ""}>
                <summary>${t("misc.feed.captureSummary", { nation: this.nationChip(nation), count: entries.length, tail })}</summary>
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
                const multi = battle.roundsSeen > 1 ? t("misc.feed.cumulative") : "";
                const outcome = battle.breach && battle.outcome !== "captured"
                    ? `${OUTCOME_LABEL[battle.outcome]} · ${t("misc.feed.breach")}`
                    : OUTCOME_LABEL[battle.outcome];
                return `<li class="feed-battle-line">
                    <span>${t("misc.feed.battleLine", { province: escapeHtml(battle.province), round: battle.rounds })}</span>
                    <span class="feed-loss-text">${multi}${t("misc.feed.attackLoss")}<span class="feed-loss">${battle.attackLoss}</span> / ${t("misc.feed.defenseLoss")}<span class="feed-loss">${battle.defenseLoss}</span></span>
                    <span class="feed-outcome">${outcome}</span>
                </li>`;
            }).join("");
            return `<details class="feed-fold" data-key="${key}"${this.openKeys.has(key) ? " open" : ""}>
                <summary>${t("misc.feed.battleSummary", { nation: this.nationChip(nation), count: battles.length })}</summary>
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
        if (group.train.size) parts.push(t("misc.feed.production.train", { count: this.countText(group.train) }));
        if (group.buildStart.size) parts.push(t("misc.feed.production.buildStart", { count: this.countText(group.buildStart), places: this.placesText(group.buildStartPlaces) }));
        if (group.buildDone.size) parts.push(t("misc.feed.production.buildDone", { count: this.countText(group.buildDone), places: this.placesText(group.buildDonePlaces) }));
        if (group.deploy.size) parts.push(t("misc.feed.production.deploy", { count: this.countText(group.deploy), places: this.placesText(group.deployPlaces) }));
        const rows = group.entries.map((entry) => `<li>${entry.text}</li>`).join("");
        return `<details class="feed-prod" data-key="${key}"${this.openKeys.has(key) ? " open" : ""}>
            <summary>${this.nationChip(group.nation)}：${parts.join("；")}</summary>
            <ul class="feed-list">${rows}</ul>
        </details>`;
    }

    private countText(counts: Map<string, number>): string {
        return [...counts.entries()].map(([label, count]) => `${escapeHtml(label)}×${count}`).join(t("misc.feed.listSeparator"));
    }

    private placesText(places: readonly string[]): string {
        if (!places.length) return "";
        const shown = places.slice(0, PLACE_LIMIT).map((place) => escapeHtml(place)).join(t("misc.feed.listSeparator"));
        return t("misc.feed.places", { places: shown, etc: places.length > PLACE_LIMIT ? t("misc.feed.etc") : "" });
    }

    private nationChip(id: number | undefined): string {
        if (id === undefined || id === NEUTRAL) return t("misc.feed.neutralGarrison");
        const nation = this.engine.state.nations[id];
        if (!nation) return t("misc.feed.unknownNation");
        return gameText(chipToken(nationDisplayColor(this.engine.state, id), nation.name));
    }
}
