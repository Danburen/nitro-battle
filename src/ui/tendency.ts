import { tendencyHelpBody, tendencyProfileOf } from "../game/ai/tendencies.ts";
import { nationDisplayColor } from "../game/access.ts";
import { resourceRates } from "../game/economy.ts";
import { resourceVisibility, tradeResourceRate } from "../game/resourceVisibility.ts";
import type { ResourceVisibilityMode } from "../game/resourceVisibility.ts";
import type { GameState } from "../game/types/state.ts";
import type { Nation } from "../game/types/entities.ts";
import type { TradeResource } from "../game/types/trade.ts";
import { t } from "../i18n/index.ts";
import { helpButton } from "./panel.ts";
import { chipToken, escapeHtml, TEXT_TERMS } from "./text.ts";

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
    if (groups.size === 1 && groups.has("exact")) return t("misc.tendency.intelExact");
    const labels: Readonly<Record<ResourceVisibilityMode, string>> = {
        exact: t("misc.tendency.intel.exact"),
        surplus: t("misc.tendency.intel.surplus"),
        shortage: t("misc.tendency.intel.shortage"),
        unknown: t("misc.tendency.intel.unknown"),
    };
    const parts = [...groups].map(([mode, names]) => t("misc.tendency.intel.group", {
        names: names.join(t("misc.common.listSeparator")),
        label: labels[mode],
    }));
    return `${t("misc.tendency.intelPrefix")}${parts.join(t("misc.tendency.intelSeparator"))}${t("misc.tendency.intelSuffix")}`;
}

/**
 * Name plus a (i) tooltip: the nation card first, then a plain-language blurb
 * and the strongest traits as green `+` / red `-` lines. The nation card shares
 * the trade panel's resource-intel rules.
 */
export function tendencyBadge(nation: Nation | undefined, state?: GameState): string {
    if (!nation) return "";
    const profile = tendencyProfileOf(nation.tendency);
    const intel = state ? resourceIntelLine(state, nation) : "";
    const color = state ? nationDisplayColor(state, nation.id) : nation.color;
    const body = `${chipToken(color, nation.name)}\n\n${tendencyHelpBody(profile)}${
        intel ? `\n\n${intel}` : ""
    }`;
    return `<span class="tendency-name">${escapeHtml(profile.name)}</span>${
        helpButton({
            title: t("misc.tendency.badgeTitle", { name: profile.name }),
            body,
            label: t("misc.tendency.badgeLabel"),
        })
    }`;
}
