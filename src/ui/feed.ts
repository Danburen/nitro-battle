import type { GameEngine } from "../game/engine.ts";
import { NEUTRAL, SEASONS } from "../game/types.ts";
import type { BattleOutcome, GameState, LogEntry } from "../game/types.ts";
import { chipToken, escapeHtml, renderGameText } from "./text.ts";

const VISIBLE_DAYS = 3;
const GLOBAL_LIMIT = 3;
const PLACE_LIMIT = 3;

export interface BattleAgg {
    readonly key: string;
    readonly nation: number;
    readonly defender: number;
    readonly province: string;
    readonly site: number;
    rounds: number;
    attackLoss: number;
    defenseLoss: number;
    breach: boolean;
    outcome: BattleOutcome;
    day: number;
    roundsSeen: number;
}

export interface ProductionAgg {
    readonly nation: number;
    readonly day: number;
    readonly train: Map<string, number>;
    readonly buildStart: Map<string, number>;
    readonly buildDone: Map<string, number>;
    readonly deploy: Map<string, number>;
    readonly buildStartPlaces: string[];
    readonly buildDonePlaces: string[];
    readonly deployPlaces: string[];
    readonly entries: LogEntry[];
}

export interface DayBlock {
    readonly day: number;
    readonly stars: LogEntry[];
    readonly captures: LogEntry[];
    readonly battles: BattleAgg[];
    readonly production: ProductionAgg[];
    readonly other: LogEntry[];
}

const OUTCOME_LABEL: Record<BattleOutcome, string> = {
    ongoing: "进行中",
    repelled: "进攻击退",
    captured: "防线崩溃",
};

/** Tiered battle feed: state flips surface instantly, fronts aggregate, daily detail folds. */
export interface FeedDigest {
    readonly days: DayBlock[];
    readonly globals: LogEntry[];
}

export class BattleFeed {
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
        this.toggleBtn.setAttribute("aria-label", this.expanded ? "收起历史战报" : "展开历史战报");
        if (this.expanded) this.renderHistory();
    }

    render(): void {
        const { days: blocks, globals } = buildFeedDigest(this.engine.state);
        const season = SEASONS[this.engine.state.seasonIndex]?.name ?? "";
        const header = `
            <div class="feed-global">
                <span class="feed-season">D${this.engine.state.day} · ${escapeHtml(season)}</span>
                ${globals.map((entry) => `<span class="feed-global-item">${renderGameText(entry.text)}</span>`).join("")}
            </div>`;
        this.live.innerHTML = blocks.length || globals.length
            ? header + blocks.map((block) => this.dayHtml(block)).join("")
            : '<p class="feed-empty">战报将在战役推进后出现。</p>';
        for (const el of this.live.querySelectorAll<HTMLDetailsElement>("details[data-key]")) {
            el.open = this.openKeys.has(el.dataset.key!);
        }
        if (this.expanded) this.renderHistory();
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
        const key = `battle:${block.day}`;
        const rows = block.battles.map((battle) => {
            const multi = battle.roundsSeen > 1 ? "累计" : "";
            const outcome = battle.breach && battle.outcome !== "captured"
                ? `${OUTCOME_LABEL[battle.outcome]} · 防线崩溃`
                : OUTCOME_LABEL[battle.outcome];
            return `<li class="feed-battle-line">
                <span>${this.nationChip(battle.nation)} ${escapeHtml(battle.province)}会战 D${battle.rounds}</span>
                <span class="feed-loss-text">${multi}攻损<span class="feed-loss">${battle.attackLoss}</span> / 守损<span class="feed-loss">${battle.defenseLoss}</span></span>
                <span class="feed-outcome">${outcome}</span>
            </li>`;
        }).join("");
        return [`<details class="feed-fold" data-key="${key}"${this.openKeys.has(key) ? " open" : ""}>
            <summary>会战 · ${block.battles.length} 场</summary>
            <ul class="feed-list">${rows}</ul>
        </details>`];
    }

    private productionGroups(block: DayBlock): string[] {
        return block.production.map((group) => {
            const key = `prod:${block.day}:${group.nation}`;
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
        });
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
        return renderGameText(chipToken(nation.color, nation.name));
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

/** Pure digest: collapses the last three days of structured log events into feed blocks. */
export function buildFeedDigest(state: Pick<GameState, "day" | "log">): FeedDigest {
    const latest = state.day;
    const earliest = Math.max(1, latest - VISIBLE_DAYS + 1);
    const days = new Map<number, DayBlock>();
    const battles: BattleAgg[] = [];
    const activeBattles = new Map<string, BattleAgg>();
    const production = new Map<string, ProductionAgg>();
    const captures: LogEntry[] = [];
    const captureDay = new Map<string, number>();

    const dayBlock = (day: number): DayBlock => {
        let block = days.get(day);
        if (!block) {
            block = { day, stars: [], captures: [], battles: [], production: [], other: [] };
            days.set(day, block);
        }
        return block;
    };

    for (const entry of state.log) {
        if (entry.day < earliest || entry.day > latest) continue;
        if (entry.event) {
            const event = entry.event;
            if (event.kind === "capture") {
                captures.push(entry);
                const key = `${event.site}:${event.battle?.attacker ?? event.nation}`;
                captureDay.set(key, Math.max(captureDay.get(key) ?? 0, entry.day));
                continue;
            }
            if (event.kind === "battle-round" && event.battle) {
                const battle = event.battle;
                if (battle.outcome === "captured") continue;
                const base = `${event.site ?? event.province}:${battle.attacker}`;
                let aggregate = activeBattles.get(base);
                if (aggregate && battle.rounds <= aggregate.rounds) aggregate = undefined;
                if (aggregate) {
                    aggregate.rounds = Math.max(aggregate.rounds, battle.rounds);
                    aggregate.attackLoss += battle.attackLoss;
                    aggregate.defenseLoss += battle.defenseLoss;
                    aggregate.breach = aggregate.breach || battle.breach;
                    aggregate.outcome = battle.outcome;
                    aggregate.day = Math.max(aggregate.day, entry.day);
                    aggregate.roundsSeen++;
                } else {
                    aggregate = {
                        key: base,
                        nation: battle.attacker,
                        defender: battle.defender,
                        province: event.province ?? "未知省份",
                        site: event.site ?? -1,
                        rounds: battle.rounds,
                        attackLoss: battle.attackLoss,
                        defenseLoss: battle.defenseLoss,
                        breach: battle.breach,
                        outcome: battle.outcome,
                        day: entry.day,
                        roundsSeen: 1,
                    };
                    battles.push(aggregate);
                    activeBattles.set(base, aggregate);
                }
                continue;
            }
            if (event.kind === "production") {
                const key = `${entry.day}:${event.nation}`;
                let aggregate = production.get(key);
                if (!aggregate) {
                    aggregate = {
                        nation: event.nation ?? NEUTRAL,
                        day: entry.day,
                        train: new Map(),
                        buildStart: new Map(),
                        buildDone: new Map(),
                        deploy: new Map(),
                        buildStartPlaces: [],
                        buildDonePlaces: [],
                        deployPlaces: [],
                        entries: [],
                    };
                    production.set(key, aggregate);
                }
                const bucket = event.action === "train" ? aggregate.train
                    : event.action === "deploy" ? aggregate.deploy
                        : event.stage === "done" ? aggregate.buildDone : aggregate.buildStart;
                for (const item of event.items ?? []) bucket.set(item.label, (bucket.get(item.label) ?? 0) + item.count);
                const places = event.action !== "build" ? aggregate.deployPlaces
                    : event.stage === "done" ? aggregate.buildDonePlaces : aggregate.buildStartPlaces;
                for (const place of event.places ?? []) {
                    if (!places.includes(place)) places.push(place);
                }
                aggregate.entries.push(entry);
                continue;
            }
            continue;
        }
        if (entry.major) dayBlock(entry.day).other.push(entry);
    }

    for (const entry of captures) {
        if (entry.event?.stateFlipped) dayBlock(entry.day).stars.push(entry);
        else dayBlock(entry.day).captures.push(entry);
    }

    // A capture already carries its battle inside the state-flip line; hide the leading rounds.
    const lastBattleAt = new Map<string, BattleAgg>();
    for (const aggregate of battles) lastBattleAt.set(aggregate.key, aggregate);
    for (const aggregate of battles) {
        const captured = captureDay.get(aggregate.key);
        if (captured !== undefined && lastBattleAt.get(aggregate.key) === aggregate && aggregate.day <= captured) continue;
        dayBlock(aggregate.day).battles.push(aggregate);
    }
    for (const aggregate of production.values()) {
        dayBlock(aggregate.day).production.push(aggregate);
    }

    return {
        days: [...days.values()]
            .filter((block) => block.stars.length || block.captures.length || block.battles.length ||
                block.production.length || block.other.length)
            .sort((a, b) => b.day - a.day),
        globals: globalEntries(state),
    };
}

function globalEntries(state: Pick<GameState, "day" | "log">): LogEntry[] {
    const earliest = Math.max(1, state.day - VISIBLE_DAYS + 1);
    const seen = new Set<string>();
    const entries: LogEntry[] = [];
    for (let i = state.log.length - 1; i >= 0 && entries.length < GLOBAL_LIMIT; i--) {
        const entry = state.log[i];
        if (entry.day < earliest) continue;
        const kind = entry.event?.kind;
        if (kind !== "war" && kind !== "peace" && kind !== "annex" && kind !== "global" && kind !== "season") continue;
        if (seen.has(entry.text)) continue;
        seen.add(entry.text);
        entries.push(entry);
    }
    return entries;
}