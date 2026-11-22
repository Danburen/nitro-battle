import { tendencyHelpBody, tendencyProfileOf } from "../game/ai/tendencies.ts";
import { nationDisplayColor } from "../game/access.ts";
import type { GameState, Nation } from "../game/types.ts";
import { helpButton } from "./panel.ts";
import { chipToken, escapeHtml } from "./text.ts";
import { vassalTooltipBody } from "./vassal.ts";

/**
 * Name plus a (i) tooltip: the nation card first, then a plain-language blurb
 * and the strongest traits as green `+` / red `-` lines. Vassals append their
 * contract status to the same tooltip.
 */
export function tendencyBadge(nation: Nation | undefined, state?: GameState): string {
    if (!nation) return "";
    const profile = tendencyProfileOf(nation.tendency);
    const vassal = state ? vassalTooltipBody(state, nation.id) : "";
    const color = state ? nationDisplayColor(state, nation.id) : nation.color;
    return `<span class="tendency-name">${escapeHtml(profile.name)}</span>${
        helpButton({
            title: `外交倾向 · ${profile.name}`,
            body: `${chipToken(color, nation.name)}\n\n${tendencyHelpBody(profile)}${vassal}`,
            label: "外交倾向说明",
        })
    }`;
}
