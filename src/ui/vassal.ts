import { nationDisplayColor, overlordOf, vassalTypeOf, vassalsOf } from "../game/access.ts";
import {
    VASSAL_HELP_BODY, VASSAL_PROFILES, VASSAL_UPGRADE_COST, canRequestUpgrade, independenceOf,
    subservienceOf, subservienceTone, tributeRateOf, upgradeTargetOf,
} from "../game/vassal.ts";
import type { GameState } from "../game/types.ts";
import { chipToken, escapeHtml, renderGameText } from "./text.ts";
import { helpButton } from "./panel.ts";

/**
 * Shared nation-card fragment for vassal status. The tooltip and the card use
 * the same words so the player never has to learn two vocabularies.
 */

const ATTITUDE_TEXT: Readonly<Record<"pos" | "note" | "neg", string>> = {
    pos: "主动配合宗主战争，缴纳稳定",
    note: "按契约行事，既不特别积极也不急于脱离",
    neg: "缴纳敷衍，较少响应宗主召唤，独立倾向强",
};

function tributeText(type: "cooperative" | "autonomous" | "oppressive", rate: number): string {
    if (type === "cooperative") return `上缴资源 ${Math.round(rate * 100)}%`;
    if (type === "autonomous") return `每日上缴 ${VASSAL_PROFILES.autonomous.tributePP} 政治点`;
    return `固定 ${Math.round(VASSAL_PROFILES.oppressive.resourceShare * 100)}% 资源 · 每日 ${VASSAL_PROFILES.oppressive.tributePP} 政治点`;
}

/** One-line "附属于" text without markup, used by the war/diplomacy summaries. */
export function vassalStatusText(state: GameState, nationId: number): string {
    const overlord = overlordOf(state, nationId);
    if (overlord >= 0) {
        const type = vassalTypeOf(state, nationId);
        return `附属于：${state.nations[overlord]?.name ?? "?"}（${type ? VASSAL_PROFILES[type].name : "附庸"}）`;
    }
    const vassals = vassalsOf(state, nationId);
    return vassals.length ? `宗主国 · ${vassals.length} 个附庸` : "独立国家";
}

/**
 * Plain-text tooltip body appended after the tendency description. Values stay
 * readable (no axis scores or thresholds), matching the v1 observation format.
 */
export function vassalTooltipBody(state: GameState, nationId: number): string {
    const nation = state.nations[nationId];
    if (!nation) return "";
    const overlord = overlordOf(state, nationId);
    if (overlord < 0) {
        const vassals = vassalsOf(state, nationId);
        return vassals.length
            ? `\n\n宗主国：拥有 ${vassals.length} 个附庸；对所有附庸拥有通行权，并在其遭攻击时履行保护义务。`
            : "";
    }
    const type = vassalTypeOf(state, nationId);
    if (!type) return "";
    const profile = VASSAL_PROFILES[type];
    const independence = Math.round(independenceOf(state, nationId));
    const attitude = subservienceTone(subservienceOf(nation));
    const lines = [
        `附属于：${chipToken(nationDisplayColor(state, overlord), state.nations[overlord].name)}（${profile.name}）`,
        `独立性 ${independence} / 100 · ${tributeText(type, tributeRateOf(state, nationId))}`,
        `[[${attitude.tone}:${attitude.label}：${ATTITUDE_TEXT[attitude.tone]}]]`,
    ];
    if (type === "oppressive") lines.push("[[neg:独立性不可主动提升，只能被动增长]]");
    const target = upgradeTargetOf(type);
    if (target && canRequestUpgrade(state, nationId)) {
        lines.push(`[[note:可花费 ${VASSAL_UPGRADE_COST} 政治点请求改善为${VASSAL_PROFILES[target].name}]]`);
    }
    return `\n\n${lines.join("\n")}`;
}

/** `<div class="kv-row">` blocks inserted after the tendency row in a nation card. */
export function vassalStatusHtml(state: GameState, nationId: number): string {
    const nation = state.nations[nationId];
    if (!nation) return "";
    const overlord = overlordOf(state, nationId);
    if (overlord < 0) {
        const vassals = vassalsOf(state, nationId);
        if (vassals.length === 0) return "";
        return `<div class="kv-row"><dt>附庸</dt><dd>宗主国 · ${vassals.length} 个附庸 ${helpButton({ title: "附庸制度", body: VASSAL_HELP_BODY })}</dd></div>`;
    }
    const type = vassalTypeOf(state, nationId);
    if (!type) return "";
    const profile = VASSAL_PROFILES[type];
    const independence = Math.round(independenceOf(state, nationId));
    const attitude = subservienceTone(subservienceOf(nation));
    const status = `[[${attitude.tone}:${attitude.label}]] · 独立性 ${independence} / 100 · ${tributeText(type, tributeRateOf(state, nationId))}`;
    return `<div class="kv-row"><dt>附属于</dt><dd>${renderGameText(chipToken(nationDisplayColor(state, overlord), state.nations[overlord].name))}（${profile.name}）</dd></div>
        <div class="kv-row"><dt>附庸状态</dt><dd>${renderGameText(status)} ${helpButton({ title: "附庸制度", body: VASSAL_HELP_BODY })}</dd></div>
        <div class="kv-row"><dt>独立性</dt><dd><span class="independence-meter"><i style="width:${independence}%"></i></span> ${escapeHtml(`${independence} / 100`)}</dd></div>`;
}
