import type { GameEngine } from "../../game/engine.ts";
import type { GameState } from "../../game/types/state.ts";
import { categoryModifiers, conscriptionProfile, policyTransitionProgress } from "../../game/policy.ts";
import { CONSCRIPTION_POLICIES, ECONOMY_POLICIES, OCCUPATION_POLICIES, POLICY_SWITCH_COST, POLICY_SWITCH_DAYS, POLICY_SWITCH_UPKEEP } from "../../game/types/policy.ts";
import type { PolicyCategory, PolicyModifiers, PolicyTransition } from "../../game/types/policy.ts";
import { t } from "../../i18n/index.ts";
import { game, html, rawHtml } from "../text.ts";
import { panelHead, renderPanel } from "../panel.ts";
import type { PanelView } from "../panel.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { gameHtml, scopedTexts } from "../view.ts";

const CLOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.4 2"/></svg>`;

function policyTexts() {
    return scopedTexts("panels.policy.", {
        title: ["title"],
        helpTitle: ["helpTitle"],
        help: ["help", { cost: POLICY_SWITCH_COST, upkeep: POLICY_SWITCH_UPKEEP, days: POLICY_SWITCH_DAYS }],
        hint: ["hint", { days: POLICY_SWITCH_DAYS }],
        liveGains: ["liveGains"],
        categoryEconomy: ["category.economy"],
        categoryConscription: ["category.conscription"],
        categoryOccupation: ["category.occupation"],
        metricFunds: ["metric.funds"],
        metricIndustry: ["metric.industry"],
        metricRecruitable: ["metric.recruitable"],
        metricStability: ["metric.stability"],
        metricOccupiedIncome: ["metric.occupiedIncome"],
        metricGrowth: ["metric.growth"],
        metricPolitics: ["metric.politics"],
        tipActive: ["tip.active"],
        tipBlocked: ["tip.blocked"],
        tipStart: ["tip.start", { cost: POLICY_SWITCH_COST, upkeep: POLICY_SWITCH_UPKEEP, days: POLICY_SWITCH_DAYS }],
    });
}
type PolicyTexts = ReturnType<typeof policyTexts>;

interface PolicyGroup {
    readonly category: PolicyCategory;
    readonly options: Readonly<Record<string, { name: string; desc: string } & PolicyModifiers>>;
}

const GROUPS: readonly PolicyGroup[] = [
    { category: "economy", options: ECONOMY_POLICIES },
    { category: "conscription", options: CONSCRIPTION_POLICIES },
    { category: "occupation", options: OCCUPATION_POLICIES },
];

function groupLabel(group: PolicyGroup, texts: PolicyTexts): string {
    if (group.category === "economy") return texts.categoryEconomy;
    if (group.category === "conscription") return texts.categoryConscription;
    return texts.categoryOccupation;
}

interface LiveMetric {
    readonly label: string;
    readonly value: string;
    readonly tone: "" | "pos" | "neg";
}

function liveMetrics(
    category: PolicyCategory, mods: PolicyModifiers, conscription: { share: number; stabilityTarget: number } | undefined, texts: PolicyTexts,
): LiveMetric[] {
    const bonus = (label: string, value: number): LiveMetric => {
        const percent = Math.round((value - 1) * 100);
        return {
            label, value: `${percent > 0 ? "+" : ""}${percent}%`,
            tone: percent === 0 ? "" : percent > 0 ? "pos" : "neg",
        };
    };
    if (category === "economy") return [bonus(texts.metricFunds, mods.fundsMult), bonus(texts.metricIndustry, mods.industryMult)];
    if (category === "conscription" && conscription) {
        return [
            { label: texts.metricRecruitable, value: `${Math.round(conscription.share * 1000) / 10}%`, tone: "" },
            {
                label: texts.metricStability,
                value: `${conscription.stabilityTarget > 0 ? "+" : ""}${Math.round(conscription.stabilityTarget)}`,
                tone: conscription.stabilityTarget === 0 ? "" : conscription.stabilityTarget > 0 ? "pos" : "neg",
            },
            bonus(texts.metricFunds, mods.fundsMult),
        ];
    }
    return [
        bonus(texts.metricOccupiedIncome, mods.occupiedIncomeMult),
        bonus(texts.metricGrowth, mods.growthMult),
        {
            label: texts.metricPolitics,
            value: `${mods.ppModifier >= 0 ? "+" : ""}${mods.ppModifier.toFixed(0)}`,
            tone: mods.ppModifier === 0 ? "" : mods.ppModifier > 0 ? "pos" : "neg",
        },
    ];
}

function optionName(group: PolicyGroup, value: string): string {
    return group.options[value]?.name ?? value;
}

function chipHtml(
    group: PolicyGroup, value: string, profile: { name: string; desc: string },
    current: string, transition: PolicyTransition | undefined,
    politicalPower: number, finished: boolean, day: number, texts: PolicyTexts,
): string {
    const active = current === value;
    const pending = transition?.to === value;
    const blocked = !active && !pending && transition !== undefined;
    const unaffordable = !active && !pending && politicalPower < POLICY_SWITCH_COST;
    const locked = finished || blocked || unaffordable;
    let tip: string;
    if (active) {
        tip = `${profile.desc}\n${texts.tipActive}`;
    } else if (pending && transition) {
        const remaining = Math.max(0, transition.readyDay - day);
        const from = optionName(group, transition.from);
        const progress = Math.round(policyTransitionProgress(transition, day) * 100);
        const switching = t("panels.policy.tip.switching", { from, to: profile.name, progress, remaining });
        tip = `${profile.desc}\n${switching}`;
    } else if (blocked) {
        tip = `${profile.desc}\n${texts.tipBlocked}`;
    } else {
        tip = `${profile.desc}\n${texts.tipStart}`;
    }
    const classes = `policy-chip${active ? " active" : ""}${pending ? " pending" : ""}${locked ? " locked" : ""}`;
    const clock = pending ? `<span class="policy-clock" aria-hidden="true">${CLOCK_ICON}</span>` : "";
    const disabled = locked ? ` aria-disabled="true"` : "";
    return html`<button class="${classes}" data-action="policy" data-category="${group.category}" data-value="${value}" aria-pressed="${active}"${rawHtml(disabled)} ${rawHtml(tooltipAttrs(profile.name, tip))}>${rawHtml(clock)}${profile.name}</button>`;
}

/** Pure view builder: all locale and token assembly happens before the DOM write. */
export function policyView(state: GameState): PanelView {
    const texts = policyTexts();
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
        const groupLabelText = groupLabel(group, texts);
        const liveLabel = t("panels.policy.liveGains", { category: groupLabelText });
        const live = liveMetrics(group.category, mods, cons, texts)
            .map((metric) => html`<span class="${metric.tone}">${metric.label} ${metric.value}</span>`)
            .join("");
        const chips = Object.entries(group.options).map(([value, profile]) => (
            chipHtml(group, value, profile, current, transition, player.politicalPower, finished, state.day, texts)
        )).join("");
        return html`<section class="policy-group${transition ? " switching" : ""}" data-category="${group.category}">
            <div class="policy-group-head">
                <span class="policy-group-label">${groupLabelText} <b>${label}</b></span>
                <span class="policy-live" aria-label="${liveLabel}">${rawHtml(live)}</span>
            </div>
            <div class="policy-opts">${rawHtml(chips)}</div>
        </section>`;
    }).join("");

    return {
        head: panelHead({
            title: texts.title,
            help: { title: texts.helpTitle, body: texts.help },
            status: gameHtml(game`[[politics:${Math.floor(player.politicalPower)}]]`),
        }),
        body: html`${rawHtml(groups)}<p class="micro-hint">${texts.hint}</p>`,
    };
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
        renderPanel(this.el, policyView(this.engine.state));
    }
}
