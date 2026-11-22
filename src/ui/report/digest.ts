import { NEUTRAL } from "../../game/types.ts";
import type { BattleOutcome, GameState, LogEntry } from "../../game/types.ts";

/**
 * Pure report digest. The floating summary only keeps headline events
 * (war / peace / season + state flips involving the player); the expanded
 * view keeps the per-day, per-nation detail.
 */

const VISIBLE_DAYS = 3;
const GLOBAL_LIMIT = 3;
const HIGHLIGHT_LIMIT = 4;

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

export const OUTCOME_LABEL: Record<BattleOutcome, string> = {
    ongoing: "进行中",
    repelled: "进攻击退",
    captured: "防线崩溃",
};

export interface ReportDigest {
    /** Floating summary: headline events only, newest first. */
    readonly highlights: LogEntry[];
    /** Expanded report: last three days of detail. */
    readonly days: DayBlock[];
    /** Pinned global events for the expanded header. */
    readonly globals: LogEntry[];
}

/** Pure digest: headline highlights plus the last three days of structured log events. */
export function buildReportDigest(state: Pick<GameState, "day" | "log">): ReportDigest {
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
        highlights: highlightEntries(state),
        days: [...days.values()]
            .filter((block) => block.stars.length || block.captures.length || block.battles.length ||
                block.production.length || block.other.length)
            .sort((a, b) => b.day - a.day),
        globals: globalEntries(state),
    };
}

/** Headline stream: declarations, peace, seasons, and state flips touching the player. */
export function highlightEntries(state: Pick<GameState, "day" | "log">): LogEntry[] {
    const earliest = Math.max(1, state.day - VISIBLE_DAYS + 1);
    const seen = new Set<string>();
    const entries: LogEntry[] = [];
    for (let i = state.log.length - 1; i >= 0 && entries.length < HIGHLIGHT_LIMIT; i--) {
        const entry = state.log[i];
        if (entry.day < earliest) continue;
        const event = entry.event;
        const kind = event?.kind;
        const headline = kind === "war" || kind === "peace" || kind === "season"
            || (kind === "capture" && Boolean(event?.stateFlipped) && (event?.nation === 0 || event?.previousOwner === 0));
        if (!headline || seen.has(entry.text)) continue;
        seen.add(entry.text);
        entries.push(entry);
    }
    return entries;
}

export function globalEntries(state: Pick<GameState, "day" | "log">): LogEntry[] {
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
