import type { DecisionFactor, DecisionVerdict, DiplomaticDecision } from "../game/types/decision.ts";
import { escapeHtml, renderGameText } from "./text.ts";
import { rawTooltipAttrs } from "./tooltip.ts";

/** Shared verdict wording; the boolean behind it always comes from the game layer. */
const VERDICT_TEXT: Record<DecisionVerdict, string> = {
    sure: "他们会接受",
    likely: "他们大概率会接受",
    maybe: "他们可能会接受",
    unlikely: "他们不太可能接受",
    refuse: "他们大概率会拒绝",
};

export interface TooltipDecision {
    readonly title?: string;
    readonly decision: DiplomaticDecision;
}

function factorHtml(factor: DecisionFactor): string {
    const tone = factor.sign > 0 ? "game-text--pos" : "game-text--neg";
    return `<div class="tip-factor ${tone}"><span>${factor.sign > 0 ? "+" : "−"}</span>${escapeHtml(factor.label)}</div>`;
}

export function decisionBlockHtml(decision: DiplomaticDecision, title?: string): string {
    const factors = decision.factors.map(factorHtml).join("");
    const tone = decision.accepts ? "game-text--pos" : "game-text--neg";
    return `<div class="tip-decision">
        ${title ? `<div class="tip-decision-name">${escapeHtml(title)}</div>` : ""}
        <div class="tip-factors">${factors}</div>
        <div class="tip-verdict ${tone}">${VERDICT_TEXT[decision.verdict]}</div>
    </div>`;
}

/**
 * Rich tooltip driven by the same decision objects the click path consumes.
 * `description` may contain game-text tokens; dynamic nation names must be
 * passed through `escapeGameText` by the caller.
 */
export function decisionTooltipAttrs(description: string, decisions: readonly TooltipDecision[]): string {
    const blocks = decisions.map((entry) => decisionBlockHtml(entry.decision, entry.title)).join("");
    return rawTooltipAttrs(`<div class="tip-reason"><p class="tip-desc">${renderGameText(description)}</p>${blocks}</div>`);
}
