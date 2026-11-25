import { tendencyHelpBody, tendencyProfileOf } from "../game/ai/tendencies.ts";
import type { AITendencyId } from "../game/ai/types.ts";
import { nationDisplayColor, overlordOf } from "../game/access.ts";
import { resourceRates } from "../game/economy.ts";
import { resourceVisibility, tradeResourceRate } from "../game/resourceVisibility.ts";
import type { ResourceVisibilityMode } from "../game/resourceVisibility.ts";
import type { GameState } from "../game/types/state.ts";
import type { Nation } from "../game/types/entities.ts";
import type { TradeResource } from "../game/types/trade.ts";
import { helpButton } from "./panel.ts";
import { chipToken, escapeHtml, TEXT_TERMS } from "./text.ts";

/** Temperaments that would trade a weak overlord for a strong attacker. */
const OPPORTUNIST_TENDENCIES: ReadonlySet<AITendencyId> = new Set([
    "bully", "opportunist", "hegemon", "militarist",
]);

/**
 * Vassal loyalty reads as one stance derived from temperament. Printing both
 * "stays loyal" and "seeks independence" would contradict itself, so an
 * opportunistic nation gets only the flip line and everyone else only the
 * united-front line. Contract mechanics stay on the contract badge instead.
 */
function vassalBehaviorLine(nation: Nation, state?: GameState): string {
    if (!state || overlordOf(state, nation.id) < 0) return "";
    return !!nation.tendency && OPPORTUNIST_TENDENCIES.has(nation.tendency)
        ? "该国家会在宗主弱小、进攻方强大时向进攻方求援独立。"
        : "该国家倾向于与宗主国保持统一战线。";
}

const INTEL_RESOURCES: readonly TradeResource[] = ["funds", "manpower", "industry", "raw", "food", "strategic"];

/** Short, grouped version of the trade panel's resource-intel rules. */
function resourceIntelLine(state: GameState, nation: Nation): string {
    const rates = resourceRates(state, nation.id);
    const groups = new Map<ResourceVisibilityMode, string[]>();
    for (const resource of INTEL_RESOURCES) {
        const visibility = resourceVisibility(state, 0, nation.id, resource, tradeResourceRate(rates, resource));
        const names = groups.get(visibility.mode) ?? [];
        names.push(TEXT_TERMS[resource].label);
        groups.set(visibility.mode, names);
    }
    if (groups.size === 1 && groups.has("exact")) return "资源情报：具体库存与净变化可见。";
    const labels: Readonly<Record<ResourceVisibilityMode, string>> = {
        exact: "可见具体数据", surplus: "有盈余", shortage: "短缺", unknown: "未知",
    };
    const parts = [...groups].map(([mode, names]) => `${names.join("、")}${labels[mode]}`);
    return `资源情报：${parts.join("；")}。`;
}

/**
 * Name plus a (i) tooltip: the nation card first, then a plain-language blurb
 * and the strongest traits as green `+` / red `-` lines. Vassals append one
 * loyalty line, and the nation card shares the trade panel's resource-intel rules.
 */
export function tendencyBadge(nation: Nation | undefined, state?: GameState): string {
    if (!nation) return "";
    const profile = tendencyProfileOf(nation.tendency);
    const behavior = vassalBehaviorLine(nation, state);
    const intel = state ? resourceIntelLine(state, nation) : "";
    const color = state ? nationDisplayColor(state, nation.id) : nation.color;
    const body = `${chipToken(color, nation.name)}\n\n${tendencyHelpBody(profile)}${
        behavior ? `\n\n${behavior}` : ""
    }${intel ? `\n\n${intel}` : ""}`;
    return `<span class="tendency-name">${escapeHtml(profile.name)}</span>${
        helpButton({
            title: `外交倾向 · ${profile.name}`,
            body,
            label: "外交倾向说明",
        })
    }`;
}
