import type { GameEngine } from "../../game/engine.ts";
import { nationDisplayColor } from "../../game/access.ts";
import { NEUTRAL, SEASONS } from "../../game/types/world.ts";
import type { GameState } from "../../game/types/state.ts";
import type { LogEntry } from "../../game/types/log.ts";
import { t } from "../../i18n/index.ts";
import { chipToken, escapeHtml, html, rawHtml, setGameText } from "../text.ts";
import { gameHtml, renderUiView, scopedTexts } from "../view.ts";
import type { UiPart, UiView } from "../view.ts";
import { buildReportDigest, OUTCOME_LABEL } from "./digest.ts";
import type { DayBlock, ProductionAgg } from "./digest.ts";

const PLACE_LIMIT = 3;

/** All feed copy resolved before any `html` template; no `t()` inside markup. */
function feedTexts() {
    const s = scopedTexts("misc.feed.", {
        empty: ["empty"],
        etc: ["etc"],
        listSeparator: ["listSeparator"],
        cumulative: ["cumulative"],
        breach: ["breach"],
        attackLoss: ["attackLoss"],
        defenseLoss: ["defenseLoss"],
        neutralGarrison: ["neutralGarrison"],
        unknownNation: ["unknownNation"],
    });
    return {
        ...s,
        captureSummary: (nation: string, count: number, tail: string): string =>
            t("misc.feed.captureSummary", { nation, count, tail }),
        battleSummary: (nation: string, count: number): string =>
            t("misc.feed.battleSummary", { nation, count }),
        battleLine: (province: string, round: number): string =>
            t("misc.feed.battleLine", { province, round }),
        train: (count: string): string => t("misc.feed.production.train", { count }),
        buildStart: (count: string, places: string): string => t("misc.feed.production.buildStart", { count, places }),
        buildDone: (count: string, places: string): string => t("misc.feed.production.buildDone", { count, places }),
        deploy: (count: string, places: string): string => t("misc.feed.production.deploy", { count, places }),
        places: (places: string, etc: string): string => t("misc.feed.places", { places, etc }),
    };
}
type FeedTexts = ReturnType<typeof feedTexts>;

interface FeedRenderContext {
    readonly state: GameState;
    readonly day: number;
    readonly seasonIndex: number;
    readonly openKeys: ReadonlySet<string>;
    readonly text: FeedTexts;
}

/** Nation chip as a plain HTML string, ready for `rawHtml()` at the template edge. */
function nationChip(state: GameState, id: number | undefined, text: FeedTexts): string {
    if (id === undefined || id === NEUTRAL) return text.neutralGarrison;
    const nation = state.nations[id];
    if (!nation) return text.unknownNation;
    return gameHtml(chipToken(nationDisplayColor(state, id), nation.name));
}

function highlightHtml(entry: LogEntry): UiPart {
    const event = entry.event;
    const own = event?.kind === "capture" && Boolean(event.stateFlipped);
    const lost = own && event?.previousOwner === 0 && event?.nation !== 0;
    const mark = own ? (lost ? "▼" : "▲")
        : event?.kind === "claim" ? "!"
            : event?.kind === "season" ? "◈"
                : event?.kind === "peace" ? "✓" : "★";
    return html`<div class="feed-highlight tone-${entry.tone}${lost ? " feed-highlight--lost" : ""}">
        <span class="feed-highlight-mark">${mark}</span>
        <span class="feed-highlight-text">${rawHtml(entry.text)}</span>
        <span class="feed-highlight-day">D${entry.day}</span>
    </div>`;
}

function starHtml(entry: LogEntry): UiPart {
    return html`<div class="feed-star tone-${entry.tone}"><span class="feed-star-mark">★</span>${rawHtml(entry.text)}</div>`;
}

function countText(counts: Map<string, number>, text: FeedTexts): string {
    return [...counts.entries()].map(([label, count]) => escapeHtml(label) + "×" + count).join(text.listSeparator);
}

function placesText(places: readonly string[], text: FeedTexts): string {
    if (!places.length) return "";
    const shown = places.slice(0, PLACE_LIMIT).map((place) => escapeHtml(place)).join(text.listSeparator);
    return text.places(shown, places.length > PLACE_LIMIT ? text.etc : "");
}

function captureGroups(block: DayBlock, ctx: FeedRenderContext): UiPart[] {
    const groups = new Map<number, LogEntry[]>();
    for (const entry of block.captures) {
        const nation = entry.event?.nation ?? NEUTRAL;
        groups.set(nation, [...(groups.get(nation) ?? []), entry]);
    }
    return [...groups.entries()].map(([nation, entries]) => {
        const key = "cap:" + block.day + ":" + nation;
        const states = [...new Set(entries.map((entry) => entry.event?.stateName).filter((name): name is string => Boolean(name)))];
        const tail = states.length
            ? " · " + states.slice(0, 2).map((name) => escapeHtml(name)).join(ctx.text.listSeparator) +
                (states.length > 2 ? ctx.text.etc : "")
            : "";
        const rows = entries.map((entry) => html`<li>${rawHtml(entry.text)}</li>`).join("");
        const summary = ctx.text.captureSummary(nationChip(ctx.state, nation, ctx.text), entries.length, tail);
        return html`<details class="feed-fold" data-key="${key}"${rawHtml(ctx.openKeys.has(key) ? " open" : "")}>
            <summary>${rawHtml(summary)}</summary>
            <ul class="feed-list">${rawHtml(rows)}</ul>
        </details>`;
    });
}

function battleGroup(block: DayBlock, ctx: FeedRenderContext): UiPart[] {
    if (!block.battles.length) return [];
    const groups = new Map<number, typeof block.battles>();
    for (const battle of block.battles) {
        const list = groups.get(battle.nation) ?? [];
        list.push(battle);
        groups.set(battle.nation, list);
    }
    return [...groups.entries()].map(([nation, battles]) => {
        const key = "battle:" + block.day + ":" + nation;
        const rows = battles.map((battle) => {
            const multi = battle.roundsSeen > 1 ? ctx.text.cumulative : "";
            const outcome = battle.breach && battle.outcome !== "captured"
                ? OUTCOME_LABEL[battle.outcome] + " · " + ctx.text.breach
                : OUTCOME_LABEL[battle.outcome];
            const line = ctx.text.battleLine(escapeHtml(battle.province), battle.rounds);
            return html`<li class="feed-battle-line">
                <span>${rawHtml(line)}</span>
                <span class="feed-loss-text">${multi}${ctx.text.attackLoss}<span class="feed-loss">${battle.attackLoss}</span> / ${ctx.text.defenseLoss}<span class="feed-loss">${battle.defenseLoss}</span></span>
                <span class="feed-outcome">${outcome}</span>
            </li>`;
        }).join("");
        const summary = ctx.text.battleSummary(nationChip(ctx.state, nation, ctx.text), battles.length);
        return html`<details class="feed-fold" data-key="${key}"${rawHtml(ctx.openKeys.has(key) ? " open" : "")}>
            <summary>${rawHtml(summary)}</summary>
            <ul class="feed-list">${rawHtml(rows)}</ul>
        </details>`;
    });
}

function productionHtml(day: number, group: ProductionAgg, ctx: FeedRenderContext): UiPart {
    const key = "prod:" + day + ":" + group.nation;
    const parts: string[] = [];
    if (group.train.size) parts.push(ctx.text.train(countText(group.train, ctx.text)));
    if (group.buildStart.size) parts.push(ctx.text.buildStart(countText(group.buildStart, ctx.text), placesText(group.buildStartPlaces, ctx.text)));
    if (group.buildDone.size) parts.push(ctx.text.buildDone(countText(group.buildDone, ctx.text), placesText(group.buildDonePlaces, ctx.text)));
    if (group.deploy.size) parts.push(ctx.text.deploy(countText(group.deploy, ctx.text), placesText(group.deployPlaces, ctx.text)));
    const rows = group.entries.map((entry) => html`<li>${rawHtml(entry.text)}</li>`).join("");
    const chip = nationChip(ctx.state, group.nation, ctx.text);
    return html`<details class="feed-prod" data-key="${key}"${rawHtml(ctx.openKeys.has(key) ? " open" : "")}>
        <summary>${rawHtml(chip)}：${rawHtml(parts.join("；"))}</summary>
        <ul class="feed-list">${rawHtml(rows)}</ul>
    </details>`;
}

function productionGroups(block: DayBlock, ctx: FeedRenderContext): UiPart[] {
    return block.production.map((group) => productionHtml(block.day, group, ctx));
}

function dayHtml(block: DayBlock, ctx: FeedRenderContext): UiPart {
    const season = ctx.day === block.day ? SEASONS[ctx.seasonIndex]?.name ?? "" : "";
    const seasonPart = season ? rawHtml(html`<span>${season}</span>`) : "";
    const body = [
        ...block.stars.map((entry) => starHtml(entry)),
        ...captureGroups(block, ctx),
        ...battleGroup(block, ctx),
        ...productionGroups(block, ctx),
        ...block.other.map((entry) => html`<div class="feed-other">${rawHtml(entry.text)}</div>`),
    ].join("");
    return html`<section class="feed-day">
        <div class="feed-day-head"><span>D${block.day}</span>${seasonPart}</div>
        ${rawHtml(body)}
    </section>`;
}

/** Floating headline strip. Pure builder: explicit inputs, no DOM access. */
export function feedLiveView(highlights: readonly LogEntry[]): UiView {
    const items = highlights.map(highlightHtml).join("");
    if (!items) return { html: "" };
    return { html: html`<div class="feed-highlights">${rawHtml(items)}</div>` };
}

export interface FeedDetailViewContext {
    readonly state: GameState;
    readonly days: readonly DayBlock[];
    readonly globals: readonly LogEntry[];
    readonly day: number;
    readonly seasonIndex: number;
    readonly openKeys: ReadonlySet<string>;
}

/** Expanded day-by-day report. Pure builder: all text and grouping resolved up front. */
export function feedDetailView(ctx: FeedDetailViewContext): UiView {
    const text = feedTexts();
    const renderCtx: FeedRenderContext = {
        state: ctx.state, day: ctx.day, seasonIndex: ctx.seasonIndex, openKeys: ctx.openKeys, text,
    };
    const pinned = ctx.globals.length
        ? html`<div class="feed-global">${rawHtml(ctx.globals.map((entry) => html`<span class="feed-global-item">${rawHtml(entry.text)}</span>`).join(""))}</div>`
        : "";
    const body = ctx.days.length
        ? ctx.days.map((block) => dayHtml(block, renderCtx)).join("")
        : html`<p class="feed-empty">${text.empty}</p>`;
    return { html: html`${rawHtml(pinned)}${rawHtml(body)}` };
}

/**
 * Battle report UI. The floating area only shows headline events; expanding it
 * reveals the day-by-day detail, grouped by nation as before. The class owns
 * DOM writes, events and `details.open` restoration only.
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
        renderUiView(this.live, feedLiveView(highlights));
        if (this.expanded) this.renderDetail();
    }

    destroy(): void {
        this.live.removeEventListener("toggle", this.rememberOpen, true);
        renderUiView(this.live, { html: "" });
        renderUiView(this.history, { html: "" });
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

    private renderDetail(): void {
        const state = this.engine.state;
        const { days, globals } = buildReportDigest(state);
        renderUiView(this.history, feedDetailView({
            state, days, globals, day: state.day, seasonIndex: state.seasonIndex, openKeys: this.openKeys,
        }));
        for (const el of this.history.querySelectorAll<HTMLDetailsElement>("details[data-key]")) {
            el.open = this.openKeys.has(el.dataset.key!);
        }
    }
}
