import { nationDisplayColor, overlordOf, vassalsOf, vassalTypeOf } from "../game/access.ts";
import {
    VASSAL_HELP_BODY, VASSAL_PROFILES, HIGH_INDEPENDENCE_RATIO, independenceCapOf, independenceOf,
    independenceRatioOf, tributeRateOf,
} from "../game/vassal.ts";
import type { GameState } from "../game/types/state.ts";
import type { VassalType } from "../game/types/diplomacy.ts";
import { chipToken, escapeHtml, iconMaskStyle, textToken } from "./text.ts";
import { helpButton } from "./panel.ts";
import { nationFlagHtmlFor } from "./flags.ts";
import { tooltipAttrs } from "./tooltip.ts";

/**
 * Shared nation-card fragment for vassal status. The row stays compact —
 * "附庸于 [flag] [name] [type icon] [independence icon] ⓘ" — and each icon's
 * hover carries the full contract, independence and tribute explanation.
 */

/** One external SVG per contract, tinted by the surrounding mark's colour. */
const VASSAL_TYPE_ICON: Record<VassalType, string> = {
    cooperative: "vassal-cooperative",
    autonomous: "vassal-autonomous",
    oppressive: "vassal-oppressive",
};

/** Rising bars plus a dashed threshold: independence read at a glance. */
const INDEPENDENCE_ICON = "vassal-independence";

/** "独立性 X / cap（NN%）" — one format used on every vassal surface. */
function independenceText(state: GameState, nationId: number): string {
    const value = Math.round(independenceOf(state, nationId));
    const cap = independenceCapOf(state, nationId);
    return `独立性 ${value} / ${cap}（${Math.round(independenceRatioOf(state, nationId) * 100)}%）`;
}

/** Tribute as colour-coded, negative resource tokens (plus PP where applicable). */
export function vassalTributeTokens(state: GameState, nationId: number): string {
    const type = vassalTypeOf(state, nationId);
    if (!type) return "";
    const profile = VASSAL_PROFILES[type];
    const share = tributeRateOf(state, nationId);
    const parts: string[] = [];
    if (share > 0) {
        const percent = `-${Math.round(share * 100)}%`;
        parts.push(textToken("funds", percent), textToken("manpower", percent), textToken("industry", percent));
    }
    if (profile.tributePP > 0) parts.push(textToken("politics", -profile.tributePP));
    return parts.join(" · ");
}

/** Hover body shared by the icon and the named badge: who, what, how restless, what it costs. */
function vassalContractBody(state: GameState, nationId: number): string {
    const type = vassalTypeOf(state, nationId)!;
    const overlord = overlordOf(state, nationId);
    const lord = chipToken(nationDisplayColor(state, overlord), state.nations[overlord]?.name ?? "?");
    return [
        `这个国家是 ${lord} 的${VASSAL_PROFILES[type].name}附庸。`,
        VASSAL_PROFILES[type].blurb,
        independenceText(state, nationId),
        `贡赋 ${vassalTributeTokens(state, nationId)}`,
    ].join("\n");
}

/** Compact contract icon: hover explains the vassal's overlord, type, independence and tribute. */
export function vassalTypeIcon(state: GameState, nationId: number): string {
    const type = vassalTypeOf(state, nationId);
    if (!type) return "";
    return `<span class="vassal-type-mark vassal-type-mark--${type}" aria-label="${VASSAL_PROFILES[type].name}附庸" ${tooltipAttrs(`${VASSAL_PROFILES[type].name}附庸`, vassalContractBody(state, nationId))}>
        <span class="icon-glyph" aria-hidden="true" ${iconMaskStyle(VASSAL_TYPE_ICON[type])}></span>
    </span>`;
}

/** Named variant used where the label still fits (e.g. the vassal-action note). */
export function vassalTypeBadge(state: GameState, nationId: number): string {
    const type = vassalTypeOf(state, nationId);
    if (!type) return "";
    return `<span class="vassal-type vassal-type--${type}" ${tooltipAttrs(`${VASSAL_PROFILES[type].name}附庸`, vassalContractBody(state, nationId))}>
        <span class="vassal-type-icon icon-glyph" aria-hidden="true" ${iconMaskStyle(VASSAL_TYPE_ICON[type])}></span>
        <span>${VASSAL_PROFILES[type].name}</span>
    </span>`;
}

/** Orange independence marker with its value; red once past the 80% threshold. */
export function vassalIndependenceIcon(state: GameState, nationId: number): string {
    const value = Math.round(independenceOf(state, nationId));
    const cap = independenceCapOf(state, nationId);
    const high = independenceRatioOf(state, nationId) >= HIGH_INDEPENDENCE_RATIO ? " vassal-independence-icon--high" : "";
    return `<span class="vassal-independence-icon${high}" aria-label="独立性 ${value} / ${cap}" ${tooltipAttrs("独立性", `${independenceText(state, nationId)}。高位（80%）时更易倒戈或起义。`)}>
        <span class="icon-glyph" aria-hidden="true" ${iconMaskStyle(INDEPENDENCE_ICON)}></span>
        <b>${value}/${cap}</b>
    </span>`;
}

/** `<div class="kv-row">` block inserted after the tendency row in a nation card. */
export function vassalStatusHtml(state: GameState, nationId: number): string {
    const nation = state.nations[nationId];
    if (!nation) return "";
    const overlord = overlordOf(state, nationId);
    if (overlord < 0) {
        const vassals = vassalsOf(state, nationId);
        if (vassals.length === 0) return "";
        return `<div class="kv-row"><dt>附庸</dt><dd>宗主国 · ${vassals.length} 个附庸 ${helpButton({ title: "附庸制度", body: VASSAL_HELP_BODY })}</dd></div>`;
    }
    if (!vassalTypeOf(state, nationId)) return "";
    return `<div class="kv-row vassal-row"><dt>附庸于</dt><dd>
        <span class="vassal-head">${nationFlagHtmlFor(state, overlord, 20)}${escapeHtml(state.nations[overlord].name)}${vassalTypeIcon(state, nationId)}${vassalIndependenceIcon(state, nationId)}${helpButton({ title: "附庸制度", body: VASSAL_HELP_BODY })}</span>
    </dd></div>`;
}
