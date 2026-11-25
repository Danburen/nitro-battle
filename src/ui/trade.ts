import type { TradeCadence, TradeKind, TradeResource, TradeTransfer } from "../game/types/trade.ts";
import type { DiplomaticDecision } from "../game/types/decision.ts";
import type { ResourceVisibility, ResourceVisibilityMode } from "../game/resourceVisibility.ts";
import { escapeHtml, iconMaskStyle, renderGameText, signedCompact, TEXT_TERMS, textToken } from "./text.ts";
import { rawTooltipAttrs, tooltipAttrs } from "./tooltip.ts";

export const TRADE_KIND_LABEL: Readonly<Record<TradeKind, string>> = {
    exchange: "资源交换条约",
    purchase: "资源购买条约",
    mercenary: "雇佣兵条约",
    aid: "请求资源援助",
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
    return `<span class="game-text game-text--${term.tone}">${term.label}</span>${tradeResourceIcon(resource)}`;
}

/** Qualitative intel as a coloured text token, with no extra resource icon. */
export function visibilityToken(mode: ResourceVisibilityMode): string {
    return mode === "exact" ? "" : renderGameText(textToken(mode));
}

/** Plain form for buttons, options and tooltips. */
export function cadenceLabel(cadence: TradeCadence): string {
    return cadence === "monthly" ? "每回合" : "固定";
}

/** Rich form: the turn token carries its own icon and colour. */
export function cadenceToken(cadence: TradeCadence): string {
    return cadence === "monthly" ? `每${renderGameText("[[turn]]")}` : "固定";
}

/** Fuzzy replacement for a hidden stock/net pair, reusing the shared intel rule. */
export function stockContextHtml(resource: TradeResource, stock: TradeStockContext): string {
    const { visibility } = stock;
    const tip = tooltipAttrs(`资源情报 · ${visibility.label}`, visibility.reason);
    if (visibility.mode !== "exact") {
        return `<span class="trade-row-stock trade-vis trade-vis--${visibility.mode}" ${tip}>${visibilityToken(visibility.mode)}</span>`;
    }
    return `<span class="trade-row-stock" ${tip}>库存 ${renderGameText(textToken(resource, stock.value))} · 净 ${
        renderGameText(textToken(resource, signedCompact(stock.net)))
    }</span>`;
}

/** One transfer as a coloured token plus its cadence and visible stock context. */
export function transferRow(
    transfer: TradeTransfer, direction: "in" | "out", stock?: TradeStockContext,
): string {
    const amount = direction === "out" ? -transfer.amount : transfer.amount;
    const stockText = stock ? stockContextHtml(transfer.resource, stock) : "";
    return `<span class="trade-transfer">
        <span class="trade-transfer-token">${renderGameText(textToken(transfer.resource, amount))}</span>
        <span class="trade-cadence">${cadenceToken(transfer.cadence)}</span>
        ${stockText}
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
    return resources.map((resource) => TEXT_TERMS[resource].label).join("、");
}

/** Native options cannot embed SVG; tint the label and prefix a token glyph. */
export function tradeResourceOption(resource: TradeResource): string {
    const term = TEXT_TERMS[resource];
    return `<option value="${resource}" style="color:var(--resource-${term.tone})">◆ ${term.label}</option>`;
}

/** Hover text after a rejection: the turn icon is supplied by the game-text token. */
export function proposalCooldownTip(days: number): string {
    return `向该国家发送请求太频繁，请 ${textToken("turn", days)}回合 后再尝试`;
}

/** Coloured willingness line used by trade tooltips; wording follows the verdict. */
export function willingnessHtml(decision: DiplomaticDecision): string {
    if (decision.accepts) {
        const text = decision.verdict === "sure" ? "这个国家很乐意与你做贸易" : "这个国家可能会跟你贸易";
        return `<div class="tip-verdict game-text--pos">${text}</div>`;
    }
    return `<div class="tip-verdict game-text--neg">这个国家不太乐意与你做贸易</div>`;
}

/** Rich trade tooltip: relationship, tendency and the willingness hint share one card. */
export function tradeStatusTooltipHtml(
    treaty: boolean, tendency: string, decision: DiplomaticDecision, note = "",
): string {
    const lines = [
        treaty ? "有贸易条约" : "可贸易",
        `国家倾向：${escapeHtml(tendency)}`,
    ];
    if (note) lines.push(escapeHtml(note));
    return `<div class="tip-reason"><p class="tip-desc">${lines.join("<br>")}</p>${willingnessHtml(decision)}</div>`;
}

export function tradeStatusTooltipAttrs(
    treaty: boolean, tendency: string, decision: DiplomaticDecision, note = "",
): string {
    return rawTooltipAttrs(tradeStatusTooltipHtml(treaty, tendency, decision, note));
}
