import type { TradeCadence, TradeKind, TradeResource, TradeTransfer } from "../game/types/trade.ts";
import type { DiplomaticDecision } from "../game/types/decision.ts";
import type { ResourceVisibility, ResourceVisibilityMode } from "../game/resourceVisibility.ts";
import { t } from "../i18n/index.ts";
import type { MessageKey } from "../i18n/index.ts";
import { escapeHtml, iconMaskStyle, gameText, signedCompact, TEXT_TERMS, game, html, rawHtml, termLabel } from "./text.ts";
import { rawTooltipAttrs, tooltipAttrs } from "./tooltip.ts";

export const TRADE_KIND_LABEL: Readonly<Record<TradeKind, string>> = {
    get exchange() { return t("ui.trade.kind.exchange"); },
    get purchase() { return t("ui.trade.kind.purchase"); },
    get mercenary() { return t("ui.trade.kind.mercenary"); },
    get aid() { return t("ui.trade.kind.aid"); },
};

const VISIBILITY_LABEL_KEY: Readonly<Record<ResourceVisibilityMode, MessageKey>> = {
    exact: "common.exact",
    surplus: "terms.surplus",
    shortage: "terms.shortage",
    unknown: "terms.unknown",
};

/** Stock and net context passed from the panel after visibility has been resolved. */
export interface TradeStockContext {
    readonly value: number;
    readonly net: number;
    readonly visibility: ResourceVisibility;
}

/** Shared resource glyph so token colour and icon always travel together. */
export function tradeResourceIcon(resource: TradeResource | "politics"): string {
    const icon = TEXT_TERMS[resource].icon;
    return icon ? `<span class="resource-icon" aria-hidden="true" ${iconMaskStyle(icon)}></span>` : "";
}

/** Trade-resource label with the same colour and external icon used everywhere else. */
export function tradeResourceLabel(resource: TradeResource): string {
    const term = TEXT_TERMS[resource];
    return `<span class="game-text game-text--${term.tone}">${escapeHtml(termLabel(resource))}</span>${tradeResourceIcon(resource)}`;
}

/** Qualitative intel as a coloured text token, with no extra resource icon. */
export function visibilityToken(mode: ResourceVisibilityMode): string {
    return mode === "exact" ? "" : gameText(game`[[${mode}]]`);
}

/** Plain form for buttons, options and tooltips. */
export function cadenceLabel(cadence: TradeCadence): string {
    return cadence === "monthly" ? t("ui.trade.cadence.monthly") : t("ui.trade.cadence.fixed");
}

/** Rich form: the turn token carries its own icon and colour. */
export function cadenceToken(cadence: TradeCadence): string {
    return t(cadence === "monthly" ? "ui.trade.cadence.monthlyToken" : "ui.trade.cadence.fixedToken");
}

/** Fuzzy replacement for a hidden stock/net pair, reusing the shared intel rule. */
export function stockContextHtml(resource: TradeResource, stock: TradeStockContext): string {
    const { visibility } = stock;
    const label = t(VISIBILITY_LABEL_KEY[visibility.mode]);
    const tip = tooltipAttrs(t("ui.trade.intel", { label }), visibility.reason);
    if (visibility.mode !== "exact") {
        return html`<span class="trade-row-stock trade-vis trade-vis--${visibility.mode}" ${rawHtml(tip)}>${rawHtml(visibilityToken(visibility.mode))}</span>`;
    }
    return html`<span class="trade-row-stock" ${rawHtml(tip)}>${t("ui.trade.stock", {
        resource,
        value: stock.value,
        net: signedCompact(stock.net),
    })}</span>`;
}

/** One transfer as a coloured token plus its cadence and visible stock context. */
export function transferRow(
    transfer: TradeTransfer, direction: "in" | "out", stock?: TradeStockContext,
): string {
    const amount = direction === "out" ? -transfer.amount : transfer.amount;
    const stockText = stock ? stockContextHtml(transfer.resource, stock) : "";
    return html`<span class="trade-transfer">
        <span class="trade-transfer-token">${game`[[${transfer.resource}:${amount}]]`}</span>
        <span class="trade-cadence">${cadenceToken(transfer.cadence)}</span>
        ${rawHtml(stockText)}
    </span>`;
}

/** Multi-resource list for treaty details and request cards. */
export function transferList(
    transfers: readonly TradeTransfer[], direction: "in" | "out", cadence?: TradeCadence,
): string {
    const list = transfers.filter((transfer) => cadence === undefined || transfer.cadence === cadence);
    if (!list.length) return "";
    return list.map((transfer) => transferRow(transfer, direction)).join("");
}

export function resourceNames(resources: readonly TradeResource[]): string {
    return resources.map(termLabel).join(t("common.listSeparator"));
}

/** Native options cannot embed SVG; tint the label and prefix a token glyph. */
export function tradeResourceOption(resource: TradeResource): string {
    const term = TEXT_TERMS[resource];
    return html`<option value="${resource}" style="color:var(--resource-${term.tone})">◆ ${t(`terms.${resource}` as MessageKey)}</option>`;
}

/** Hover text after a rejection: the turn icon is supplied by the game-text token. */
export function proposalCooldownTip(days: number): string {
    return t("ui.trade.cooldown", { days });
}

/** Coloured willingness line used by trade tooltips; wording follows the verdict. */
export function willingnessHtml(decision: DiplomaticDecision): string {
    if (decision.accepts) {
        const key = decision.verdict === "sure" ? "ui.trade.willingness.sure" : "ui.trade.willingness.maybe";
        return html`<div class="tip-verdict game-text--pos">${t(key)}</div>`;
    }
    return html`<div class="tip-verdict game-text--neg">${t("ui.trade.willingness.no")}</div>`;
}

/** Rich trade tooltip: relationship, tendency and the willingness hint share one card. */
export function tradeStatusTooltipHtml(
    treaty: boolean, tendency: string, decision: DiplomaticDecision, note = "",
): string {
    const lines = [
        escapeHtml(t(treaty ? "ui.trade.treaty" : "ui.trade.noTreaty")),
        escapeHtml(t("ui.trade.tendency", { tendency })),
    ];
    if (note) lines.push(escapeHtml(note));
    const desc = lines.join("<br>");
    return html`<div class="tip-reason"><p class="tip-desc">${rawHtml(desc)}</p>${rawHtml(willingnessHtml(decision))}</div>`;
}

export function tradeStatusTooltipAttrs(
    treaty: boolean, tendency: string, decision: DiplomaticDecision, note = "",
): string {
    return rawTooltipAttrs(tradeStatusTooltipHtml(treaty, tendency, decision, note));
}
