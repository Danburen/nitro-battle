import { tendencyHelpBody, tendencyProfileOf } from "../game/ai/tendencies.ts";
import type { AITendencyId } from "../game/ai/types.ts";
import { nationDisplayColor, overlordOf } from "../game/access.ts";
import type { GameState, Nation } from "../game/types.ts";
import { helpButton } from "./panel.ts";
import { chipToken, escapeHtml } from "./text.ts";

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

/**
 * Name plus a (i) tooltip: the nation card first, then a plain-language blurb
 * and the strongest traits as green `+` / red `-` lines. Vassals append one
 * loyalty line to the same tooltip.
 */
export function tendencyBadge(nation: Nation | undefined, state?: GameState): string {
    if (!nation) return "";
    const profile = tendencyProfileOf(nation.tendency);
    const behavior = vassalBehaviorLine(nation, state);
    const color = state ? nationDisplayColor(state, nation.id) : nation.color;
    const body = `${chipToken(color, nation.name)}\n\n${tendencyHelpBody(profile)}${
        behavior ? `\n\n${behavior}` : ""
    }`;
    return `<span class="tendency-name">${escapeHtml(profile.name)}</span>${
        helpButton({
            title: `外交倾向 · ${profile.name}`,
            body,
            label: "外交倾向说明",
        })
    }`;
}
