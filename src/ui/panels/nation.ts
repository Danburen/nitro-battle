import type { GameEngine } from "../../game/engine.ts";
import { INFRASTRUCTURE_MAX, NEUTRAL } from "../../game/types.ts";
import { nationDisplayColor, overlordOf, vassalTypeOf, vassalsOf } from "../../game/access.ts";
import { VASSAL_PROFILES } from "../../game/vassal.ts";
import { escapeHtml } from "../text.ts";
import { PanelShell, panelHead } from "../panel.ts";
import type { HelpSpec } from "../panel.ts";
import { nationFlagHtmlFor } from "../flags.ts";
import { tendencyBadge } from "../tendency.ts";
import { vassalStatusHtml } from "../vassal.ts";
import { runSlices } from "../slices.ts";
import type { SliceStep } from "../slices.ts";

/**
 * Standalone nation overview panel.
 *
 * Stats are gathered lazily when the panel is shown (never on every game
 * refresh) and spread over animation frames, so opening a nation never blocks
 * a frame on large maps. Reuse it anywhere a nation summary is needed.
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

export interface NationPanelOptions {
    readonly help: HelpSpec;
    readonly footer?: string;
}

const PROVINCE_CHUNK = 240;

export class NationPanel {
    private readonly engine: GameEngine;
    private readonly shell: PanelShell;
    private readonly options: NationPanelOptions;
    private cancel: (() => void) | null = null;
    private token = 0;
    private nationId: number | null = null;

    constructor(engine: GameEngine, el: HTMLElement, options: NationPanelOptions) {
        this.engine = engine;
        this.shell = new PanelShell(el);
        this.options = options;
    }

    get selected(): number | null {
        return this.nationId;
    }

    /** Open the panel and start gathering this nation's statistics. */
    show(nationId: number): void {
        const nation = this.engine.state.nations[nationId];
        if (!nation) return;
        this.nationId = nationId;
        this.stop();
        this.shell.show();
        const displayColor = nationDisplayColor(this.engine.state, nationId);
        this.shell.el.innerHTML = `${this.head(nation.name, displayColor)}
            <div class="panel-body brief-body">
                <div class="brief-title">${nationFlagHtmlFor(this.engine.state, nation.id, 30)}<span>${escapeHtml(nation.name)}</span></div>
                <p class="micro-hint">正在统计国家概况…</p>
            </div>`;

        const stats: NationStats = {
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
        const token = ++this.token;
        this.cancel = runSlices(this.statSteps(stats), () => {
            if (token !== this.token) return;
            this.renderStats(stats);
        });
    }

    showNeutral(): void {
        this.stop();
        this.nationId = null;
        this.shell.show();
        this.shell.el.innerHTML = `${this.head("中立区域", "#6e7781")}
            <div class="panel-body brief-body">
                <div class="brief-title"><span class="nation-swatch" style="--nc:#6e7781"></span>中立区域</div>
                <p class="micro-hint">这里没有国家控制。点击有颜色的领土查看所属国家。</p>
            </div>`;
    }

    hide(): void {
        this.stop();
        this.shell.hide();
        this.shell.clear();
    }

    destroy(): void {
        this.hide();
        this.nationId = null;
    }

    private stop(): void {
        this.token++;
        this.cancel?.();
        this.cancel = null;
    }

    private head(name: string, color: string): string {
        return panelHead({
            title: "国家详情",
            help: this.options.help,
            extras: `<span class="owner-pill" style="--pc:${escapeHtml(color)}">${escapeHtml(name)}</span>`,
        });
    }

    private diplomacyStatus(nationId: number): string {
        const state = this.engine.state;
        const overlord = overlordOf(state, nationId);
        if (overlord >= 0) {
            const type = vassalTypeOf(state, nationId);
            return `附属于 ${state.nations[overlord].name}（${type ? VASSAL_PROFILES[type].name : "附庸"}）`;
        }
        const vassals = vassalsOf(state, nationId);
        return vassals.length ? `独立 · 宗主国（${vassals.length} 个附庸）` : "独立国家";
    }

    /** Statistics split into small chunks so each frame stays inside its budget. */
    private statSteps(stats: NationStats): SliceStep[] {
        const state = this.engine.state;
        const steps: SliceStep[] = [];
        for (let start = 0; start < state.provinces.length; start += PROVINCE_CHUNK) {
            const end = Math.min(state.provinces.length, start + PROVINCE_CHUNK);
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
            for (const region of state.states) {
                if (state.provinces[region.center].owner !== stats.nationId) continue;
                stats.controlledStates++;
                stats.factories += region.factories;
                stats.farms += region.buildings.filter((building) => building === "farm").length;
                stats.infrastructure += region.infrastructure;
            }
            // One pass for the scale used by the industry bar.
            const byOwner = new Map<number, number>();
            for (const region of state.states) {
                const owner = state.provinces[region.center].owner;
                if (owner === NEUTRAL) continue;
                byOwner.set(owner, (byOwner.get(owner) ?? 0) + region.factories);
            }
            stats.maxFactories = Math.max(0, ...byOwner.values());
        });
        return steps;
    }

    private renderStats(stats: NationStats): void {
        const nation = this.engine.state.nations[stats.nationId];
        if (!nation) return;
        const displayColor = nationDisplayColor(this.engine.state, stats.nationId);
        const capital = this.engine.state.provinces[nation.capital]?.name ?? "未知";
        const ratio = stats.maxFactories > 0 ? stats.factories / stats.maxFactories : 0;
        // Infrastructure coverage: total levels over controlled states, against a fully built 8.
        const infrastructureAverage = stats.controlledStates > 0 ? stats.infrastructure / stats.controlledStates : 0;
        const coverage = Math.round(infrastructureAverage / INFRASTRUCTURE_MAX * 100);
        this.shell.render({
            head: this.head(nation.name, displayColor),
            body: `
                <div class="brief-title">${nationFlagHtmlFor(this.engine.state, nation.id, 30)}<span>${escapeHtml(nation.name)}</span></div>
                <dl class="kv">
                    <div class="kv-row"><dt>控制省份</dt><dd>${stats.provinces} 省 · ${stats.states} 州</dd></div>
                    <div class="kv-row"><dt>首都</dt><dd>${escapeHtml(capital)}</dd></div>
                    <div class="kv-row"><dt>城市</dt><dd>${stats.cities} 座</dd></div>
                    <div class="kv-row"><dt>工业水平</dt><dd>
                        <span class="industry-line">
                            <span class="industry-meter"><i style="width:${Math.round(Math.max(0.04, ratio) * 100)}%"></i></span>
                            <b>${stats.factories}</b> 座工厂
                        </span>
                    </dd></div>
                    <div class="kv-row"><dt>农场</dt><dd>${stats.farms} 座</dd></div>
                    <div class="kv-row"><dt>基础设施</dt><dd>${coverage}% <span class="kv-note">平均 ${infrastructureAverage.toFixed(1)} / ${INFRASTRUCTURE_MAX} 级</span></dd></div>
                    <div class="kv-row"><dt>军团</dt><dd>${stats.armies} 支 · ${stats.regiments} 团</dd></div>
                    <div class="kv-row"><dt>外交倾向</dt><dd>${tendencyBadge(nation, this.engine.state)}</dd></div>
                    ${vassalStatusHtml(this.engine.state, nation.id)}
                    <div class="kv-row"><dt>外交地位</dt><dd>${escapeHtml(this.diplomacyStatus(stats.nationId))}</dd></div>
                </dl>
                ${this.options.footer ? `<p class="micro-hint">${escapeHtml(this.options.footer)}</p>` : ""}`,
        });
    }
}
