import type { GameEngine } from "../../game/engine.ts";
import { categoryModifiers, conscriptionProfile, policyTransitionProgress } from "../../game/policy.ts";
import { CONSCRIPTION_POLICIES, ECONOMY_POLICIES, OCCUPATION_POLICIES, POLICY_SWITCH_COST, POLICY_SWITCH_DAYS, POLICY_SWITCH_UPKEEP } from "../../game/types/policy.ts";
import type { PolicyCategory, PolicyModifiers, PolicyTransition } from "../../game/types/policy.ts";
import { escapeHtml, gameText, game } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, renderPanel } from "../panel.ts";
import { t } from "../../i18n/index.ts";

const POLICY_TIP = {
    get body(): string {
        return t("panels.policy.help", {
            cost: POLICY_SWITCH_COST, upkeep: POLICY_SWITCH_UPKEEP, days: POLICY_SWITCH_DAYS,
        });
    },
};

const CLOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.4 2"/></svg>`;

interface PolicyGroup {
    readonly category: PolicyCategory;
    readonly label: string;
    readonly options: Readonly<Record<string, { name: string; desc: string } & PolicyModifiers>>;
}

const GROUPS: readonly PolicyGroup[] = [
    { category: "economy", get label() { return t("panels.policy.category.economy"); }, options: ECONOMY_POLICIES },
    { category: "conscription", get label() { return t("panels.policy.category.conscription"); }, options: CONSCRIPTION_POLICIES },
    { category: "occupation", get label() { return t("panels.policy.category.occupation"); }, options: OCCUPATION_POLICIES },
];

interface LiveMetric {
    readonly label: string;
    readonly value: string;
    readonly tone: "" | "pos" | "neg";
}

function liveMetrics(
    category: PolicyCategory, mods: PolicyModifiers, conscription?: { share: number; stabilityTarget: number },
): LiveMetric[] {
    const bonus = (label: string, value: number): LiveMetric => {
        const percent = Math.round((value - 1) * 100);
        return {
            label, value: `${percent > 0 ? "+" : ""}${percent}%`,
            tone: percent === 0 ? "" : percent > 0 ? "pos" : "neg",
        };
    };
    if (category === "economy") return [bonus(t("panels.policy.metric.funds"), mods.fundsMult), bonus(t("panels.policy.metric.industry"), mods.industryMult)];
    if (category === "conscription" && conscription) {
        return [
            { label: t("panels.policy.metric.recruitable"), value: `${Math.round(conscription.share * 1000) / 10}%`, tone: "" },
            {
                label: t("panels.policy.metric.stability"), value: `${conscription.stabilityTarget > 0 ? "+" : ""}${Math.round(conscription.stabilityTarget)}`,
                tone: conscription.stabilityTarget === 0 ? "" : conscription.stabilityTarget > 0 ? "pos" : "neg",
            },
            bonus(t("panels.policy.metric.funds"), mods.fundsMult),
        ];
    }
    return [
        bonus(t("panels.policy.metric.occupiedIncome"), mods.occupiedIncomeMult),
        bonus(t("panels.policy.metric.growth"), mods.growthMult),
        {
            label: t("panels.policy.metric.politics"), value: `${mods.ppModifier >= 0 ? "+" : ""}${mods.ppModifier.toFixed(0)}`,
            tone: mods.ppModifier === 0 ? "" : mods.ppModifier > 0 ? "pos" : "neg",
        },
    ];
}

function optionName(group: PolicyGroup, value: string): string {
    return group.options[value]?.name ?? value;
}

/** Policy switches (dock tab 3): per-category live gains, ramping switches and cancel-in-place. */
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
        const finished = state.winner !== null;

        const groups = GROUPS.map((group) => {
            const current = player.policies[group.category];
            const transition = player.policyTransitions?.[group.category];
            const mods = categoryModifiers(player, group.category, state.day);
            const cons = group.category === "conscription" ? conscriptionProfile(player, state.day) : undefined;
            const label = transition
                ? `${optionName(group, transition.from)} → ${optionName(group, transition.to)}`
                : optionName(group, current);
            const live = liveMetrics(group.category, mods, cons)
                .map((metric) => `<span class="${metric.tone}">${metric.label} ${metric.value}</span>`)
                .join("");
            const chips = Object.entries(group.options).map(([value, profile]) => (
                this.chipHtml(group, value, profile, current, transition, player.politicalPower, finished, state.day)
            )).join("");
            return `<section class="policy-group${transition ? " switching" : ""}" data-category="${group.category}">
                <div class="policy-group-head">
                    <span class="policy-group-label">${group.label} <b>${escapeHtml(label)}</b></span>
                    <span class="policy-live" aria-label="${t("panels.policy.liveGains", { category: group.label })}">${live}</span>
                </div>
                <div class="policy-opts">${chips}</div>
            </section>`;
        }).join("");

        renderPanel(this.el, {
            head: panelHead({
                title: t("panels.policy.title"),
                help: { title: t("panels.policy.helpTitle"), body: POLICY_TIP.body },
                status: gameText(game`[[politics:${Math.floor(player.politicalPower)}]]`),
            }),
            body: `${groups}<p class="micro-hint">${t("panels.policy.hint", { days: POLICY_SWITCH_DAYS })}</p>`,
        });
    }

    private chipHtml(
        group: PolicyGroup, value: string, profile: { name: string; desc: string },
        current: string, transition: PolicyTransition | undefined,
        politicalPower: number, finished: boolean, day: number,
    ): string {
        const active = current === value;
        const pending = transition?.to === value;
        const blocked = !active && !pending && transition !== undefined;
        const unaffordable = !active && !pending && politicalPower < POLICY_SWITCH_COST;
        const locked = finished || blocked || unaffordable;
        let tip: string;
        if (active) {
            tip = `${profile.desc}\n${t("panels.policy.tip.active")}`;
        } else if (pending && transition) {
            const remaining = Math.max(0, transition.readyDay - day);
            const from = optionName(group, transition.from);
            const progress = Math.round(policyTransitionProgress(transition, day) * 100);
            tip = `${profile.desc}\n${t("panels.policy.tip.switching", { from, to: profile.name, progress, remaining })}`;
        } else if (blocked) {
            tip = `${profile.desc}\n${t("panels.policy.tip.blocked")}`;
        } else {
            tip = `${profile.desc}\n${t("panels.policy.tip.start", { cost: POLICY_SWITCH_COST, upkeep: POLICY_SWITCH_UPKEEP, days: POLICY_SWITCH_DAYS })}`;
        }
        const classes = `policy-chip${active ? " active" : ""}${pending ? " pending" : ""}${locked ? " locked" : ""}`;
        return `<button class="${classes}" data-action="policy" data-category="${group.category}" data-value="${value}" aria-pressed="${active}"${locked ? ' aria-disabled="true"' : ""} ${tooltipAttrs(profile.name, tip)}>${
            pending ? `<span class="policy-clock" aria-hidden="true">${CLOCK_ICON}</span>` : ""
        }${escapeHtml(profile.name)}</button>`;
    }
}