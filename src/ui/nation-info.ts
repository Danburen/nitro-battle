import { INFRASTRUCTURE_MAX, NEUTRAL } from "../game/types.ts";
import type { GameState } from "../game/types.ts";
import { ALLIANCE_HELP_BODY, allianceOf } from "../game/alliance.ts";
import { escapeHtml } from "./text.ts";
import { helpButton } from "./panel.ts";
import { tendencyBadge } from "./tendency.ts";
import { vassalStatusHtml } from "./vassal.ts";

/**
 * One nation-overview implementation shared by every surface: the nation
 * detail panel, the diplomacy nation card and the topbar hover. Stats are
 * accumulated the same way everywhere; callers may spread the work over frames
 * (`nationStatSteps`) or take it in one pass (`nationStats`).
 */

export interface NationStats {
    nationId: number;
    provinces: number;
    states: number;
    /** States whose center this nation controls; matches the infrastructure denominator. */
    controlledStates: number;
    cities: number;
    armies: number;
    regiments: number;
    factories: number;
    maxFactories: number;
    farms: number;
    /** Sum of infrastructure levels over controlled states (0–8 each). */
    infrastructure: number;
    readonly stateIds: Set<number>;
}

export function emptyNationStats(nationId: number): NationStats {
    return {
        nationId,
        provinces: 0,
        states: 0,
        controlledStates: 0,
        cities: 0,
        armies: 0,
        regiments: 0,
        factories: 0,
        maxFactories: 0,
        farms: 0,
        infrastructure: 0,
        stateIds: new Set(),
    };
}

/** Chunked collection steps; each closure is safe to run in its own frame. */
export function nationStatSteps(state: GameState, stats: NationStats, chunk = 240): (() => void)[] {
    const steps: (() => void)[] = [];
    for (let start = 0; start < state.provinces.length; start += chunk) {
        const end = Math.min(state.provinces.length, start + chunk);
        steps.push(() => {
            for (let i = start; i < end; i++) {
                const province = state.provinces[i];
                if (province.owner !== stats.nationId) continue;
                stats.provinces++;
                if (province.isCity) stats.cities++;
                if (province.stateId >= 0) stats.stateIds.add(province.stateId);
            }
        });
    }
    steps.push(() => {
        for (const army of state.armies.values()) {
            if (army.nation !== stats.nationId) continue;
            stats.armies++;
            stats.regiments += army.regiments.length;
        }
    });
    steps.push(() => {
        stats.states = stats.stateIds.size;
        const byOwner = new Map<number, number>();
        for (const region of state.states) {
            const owner = state.provinces[region.center]?.owner ?? NEUTRAL;
            if (owner === NEUTRAL) continue;
            byOwner.set(owner, (byOwner.get(owner) ?? 0) + region.factories);
            if (owner !== stats.nationId) continue;
            stats.controlledStates++;
            stats.factories += region.factories;
            stats.farms += region.buildings.filter((building) => building === "farm").length;
            stats.infrastructure += region.infrastructure;
        }
        stats.maxFactories = Math.max(0, ...byOwner.values());
    });
    return steps;
}

/** Synchronous variant for small, on-demand surfaces such as hover text. */
export function nationStats(state: GameState, nationId: number): NationStats {
    const stats = emptyNationStats(nationId);
    for (const step of nationStatSteps(state, stats)) step();
    return stats;
}

export interface NationFigures {
    readonly infrastructureAverage: number;
    readonly coverage: number;
    readonly industryRatio: number;
}

export function nationFigures(stats: NationStats): NationFigures {
    const infrastructureAverage = stats.controlledStates > 0 ? stats.infrastructure / stats.controlledStates : 0;
    return {
        infrastructureAverage,
        coverage: Math.round(infrastructureAverage / INFRASTRUCTURE_MAX * 100),
        industryRatio: stats.maxFactories > 0 ? stats.factories / stats.maxFactories : 0,
    };
}

/** Shared stat rows (everything before vassal/alliance/vendor extras). */
export function nationInfoRows(state: GameState, stats: NationStats): string {
    const nation = state.nations[stats.nationId];
    const capital = nation ? state.provinces[nation.capital]?.name ?? "未知" : "未知";
    const figures = nationFigures(stats);
    const industryWidth = Math.round(Math.max(0.04, figures.industryRatio) * 100);
    return `<div class="kv-row"><dt>控制省份</dt><dd><span class="game-text game-text--construction">${stats.provinces} 省 · ${stats.states} 州</span></dd></div>
        <div class="kv-row"><dt>首都</dt><dd><span class="game-text game-text--keyword">${escapeHtml(capital)}</span></dd></div>
        <div class="kv-row"><dt>城市</dt><dd><span class="game-text game-text--construction">${stats.cities} 座</span></dd></div>
        <div class="kv-row"><dt>工业水平</dt><dd>
            <span class="industry-line">
                <span class="industry-meter"><i style="width:${industryWidth}%"></i></span>
                <b class="game-text--industry">${stats.factories}</b> 座工厂<span class="kv-note">相对最强 ${Math.round(figures.industryRatio * 100)}%</span>
            </span>
        </dd></div>
        <div class="kv-row"><dt>农场</dt><dd><span class="game-text game-text--funds">${stats.farms} 座</span></dd></div>
        <div class="kv-row"><dt>基础设施</dt><dd><span class="game-text game-text--construction">${figures.coverage}%</span><span class="kv-note">平均 ${figures.infrastructureAverage.toFixed(1)} / ${INFRASTRUCTURE_MAX} 级</span></dd></div>
        <div class="kv-row"><dt>军团</dt><dd><span class="game-text game-text--manpower">${stats.armies} 支 · ${stats.regiments} 团</span></dd></div>
        <div class="kv-row"><dt>外交倾向</dt><dd>${nation ? tendencyBadge(nation, state) : "—"}</dd></div>`;
}

/**
 * The one nation-overview body used by the nation detail panel, the diplomacy
 * card and the topbar hover. All three render this exact markup, so colours,
 * vassal icons and every figure stay in sync by construction.
 */
export function nationOverviewBody(state: GameState, stats: NationStats, extraClass = ""): string {
    const nationId = stats.nationId;
    const targetAlliance = allianceOf(state, nationId);
    const allianceText = targetAlliance
        ? `${state.nations[targetAlliance.leader]?.name ?? "?"} 的联盟 · ${targetAlliance.members.length} 国`
        : "无";
    return `<dl class="kv${extraClass}">
        ${nationInfoRows(state, stats)}
        ${vassalStatusHtml(state, nationId)}
        <div class="kv-row"><dt>联盟</dt><dd>${escapeHtml(allianceText)} ${helpButton({ title: "联盟制度", body: ALLIANCE_HELP_BODY })}</dd></div>
    </dl>`;
}
