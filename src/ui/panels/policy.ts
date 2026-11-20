import type { GameEngine } from "../../game/engine.ts";
import {
    CONSCRIPTION_POLICIES,
    ECONOMY_POLICIES,
    OCCUPATION_POLICIES,
    POLICY_SWITCH_COST,
} from "../../game/types.ts";
import { escapeHtml, renderGameText, textToken } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";

/** Policy switches (dock tab 3). */
export class PolicyPanel {
    private readonly engine: GameEngine;
    private readonly el = document.querySelector<HTMLElement>("#policy-panel") as HTMLElement;

    constructor(engine: GameEngine) {
        this.engine = engine;
    }

    setHidden(hidden: boolean): void {
        this.el.classList.toggle("hidden", hidden);
    }

    render(): void {
        const state = this.engine.state;
        const player = state.nations[0];
        const groups: {
            category: "economy" | "conscription" | "occupation";
            label: string;
            current: string;
            options: Readonly<Record<string, { name: string; desc: string }>>;
        }[] = [
            { category: "economy", label: "经济政策", current: player.policies.economy, options: ECONOMY_POLICIES },
            { category: "conscription", label: "兵役政策", current: player.policies.conscription, options: CONSCRIPTION_POLICIES },
            { category: "occupation", label: "占领政策", current: player.policies.occupation, options: OCCUPATION_POLICIES },
        ];

        const html = groups.map((group) => {
            const options = Object.entries(group.options).map(([value, profile]) => {
                const active = group.current === value;
                const locked = !active && (player.politicalPower < POLICY_SWITCH_COST || state.winner !== null);
                const tip = `${profile.desc}\n${active ? "当前政策" : `切换消耗 [[politics:${POLICY_SWITCH_COST}]]`}`;
                return `<button class="policy-chip${active ? " active" : ""}${locked ? " locked" : ""}" data-action="policy" data-category="${group.category}" data-value="${value}" aria-pressed="${active}" ${locked ? 'aria-disabled="true"' : ""} ${tooltipAttrs(profile.name, tip)}>${escapeHtml(profile.name)}</button>`;
            }).join("");
            return `
                <div class="policy-row">
                    <span class="policy-label">${escapeHtml(group.label.replace("政策", ""))}</span>
                    <div class="policy-opts">${options}</div>
                </div>`;
        }).join("");

        this.el.innerHTML = `
            <div class="panel-head"><h2>政策</h2><span class="objective">${renderGameText(textToken("politics", Math.floor(player.politicalPower)))}</span></div>
            <div class="panel-body">
                ${html}
                <p class="micro-hint">${renderGameText(`切换政策消耗 ${textToken("politics", POLICY_SWITCH_COST)}（每日 +2，[[admin]]额外 +1）。政策立即作用于全国产出与[[occupation]]。`)}</p>
            </div>`;
    }
}