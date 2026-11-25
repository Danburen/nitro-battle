import type { GameEngine } from "../../game/engine.ts";
import { categoryModifiers, conscriptionProfile, policyTransitionProgress } from "../../game/policy.ts";
import { CONSCRIPTION_POLICIES, ECONOMY_POLICIES, OCCUPATION_POLICIES, POLICY_SWITCH_COST, POLICY_SWITCH_DAYS, POLICY_SWITCH_UPKEEP } from "../../game/types/policy.ts";
import type { PolicyCategory, PolicyModifiers, PolicyTransition } from "../../game/types/policy.ts";
import { escapeHtml, renderGameText, textToken } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, renderPanel } from "../panel.ts";

const POLICY_TIP = `切换政策需要时间与政治点：\n· 开始时支付 [[politics:${POLICY_SWITCH_COST}]]，切换期间每日维护 [[politics:-${POLICY_SWITCH_UPKEEP}]]；\n· 需 ${textToken("turn", POLICY_SWITCH_DAYS)} 完成，财政、工业、人力、[[occupation]]等增益按进度逐回合逼近新政策；\n· 切换中的目标政策带时钟标记，悬停可看剩余回合；\n· 再次点击目标可取消切换并回到原政策；已付政治点与维护不返还，重新切换仍需时间。\n\n政策始终作用于全国产出、[[occupation]]整合与[[politics]]收入。`;

const CLOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.4 2"/></svg>`;

interface PolicyGroup {
    readonly category: PolicyCategory;
    readonly label: string;
    readonly options: Readonly<Record<string, { name: string; desc: string } & PolicyModifiers>>;
}

const GROUPS: readonly PolicyGroup[] = [
    { category: "economy", label: "经济", options: ECONOMY_POLICIES },
    { category: "conscription", label: "兵役", options: CONSCRIPTION_POLICIES },
    { category: "occupation", label: "占领", options: OCCUPATION_POLICIES },
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
    if (category === "economy") return [bonus("财政", mods.fundsMult), bonus("工业", mods.industryMult)];
    if (category === "conscription" && conscription) {
        return [
            { label: "可招募", value: `${Math.round(conscription.share * 1000) / 10}%`, tone: "" },
            {
                label: "稳定", value: `${conscription.stabilityTarget > 0 ? "+" : ""}${Math.round(conscription.stabilityTarget)}`,
                tone: conscription.stabilityTarget === 0 ? "" : conscription.stabilityTarget > 0 ? "pos" : "neg",
            },
            bonus("财政", mods.fundsMult),
        ];
    }
    return [
        bonus("占领收入", mods.occupiedIncomeMult),
        bonus("增长", mods.growthMult),
        {
            label: "政治", value: `${mods.ppModifier >= 0 ? "+" : ""}${mods.ppModifier.toFixed(0)}`,
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
                    <span class="policy-live" aria-label="${group.label}实时增益">${live}</span>
                </div>
                <div class="policy-opts">${chips}</div>
            </section>`;
        }).join("");

        renderPanel(this.el, {
            head: panelHead({
                title: "政策",
                help: { title: "政策切换规则", body: POLICY_TIP },
                status: renderGameText(textToken("politics", Math.floor(player.politicalPower))),
            }),
            body: `${groups}<p class="micro-hint">${renderGameText(`切换需 ${textToken("turn", POLICY_SWITCH_DAYS)}，增益逐回合生效；取消不返还已花费的[[politics]]。`)}</p>`,
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
            tip = `${profile.desc}\n当前政策：增益已完全生效。`;
        } else if (pending && transition) {
            const remaining = Math.max(0, transition.readyDay - day);
            const from = optionName(group, transition.from);
            const progress = Math.round(policyTransitionProgress(transition, day) * 100);
            tip = `${profile.desc}\n切换中：${from} → ${profile.name}，进度 ${progress}%，还需 ${textToken("turn", remaining)}。\n增益随进度逐回合逼近新政策。\n再次点击取消切换并回到「${from}」；已付政治点与维护不返还，重新切换仍需时间。`;
        } else if (blocked) {
            tip = `${profile.desc}\n该组切换进行中：先点击带时钟的目标取消，才能改选其他政策。`;
        } else {
            tip = `${profile.desc}\n开始切换：支付 [[politics:${POLICY_SWITCH_COST}]]，每日维护 [[politics:-${POLICY_SWITCH_UPKEEP}]]，需 ${textToken("turn", POLICY_SWITCH_DAYS)}。\n增益随进度逐步生效。`;
        }
        const classes = `policy-chip${active ? " active" : ""}${pending ? " pending" : ""}${locked ? " locked" : ""}`;
        return `<button class="${classes}" data-action="policy" data-category="${group.category}" data-value="${value}" aria-pressed="${active}"${locked ? ' aria-disabled="true"' : ""} ${tooltipAttrs(profile.name, tip)}>${
            pending ? `<span class="policy-clock" aria-hidden="true">${CLOCK_ICON}</span>` : ""
        }${escapeHtml(profile.name)}</button>`;
    }
}