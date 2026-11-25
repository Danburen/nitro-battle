import type { GameEngine } from "../../game/engine.ts";
import type { SoundManager } from "../../audio/index.ts";
import { isAtWar, truceDays, warDuration } from "../../game/diplomacy.ts";
import { tendencyProfileOf } from "../../game/ai/tendencies.ts";
import { nationDisplayColor } from "../../game/access.ts";
import { resourceRates } from "../../game/economy.ts";
import { RESOURCE_CAPS } from "../../game/types/economy.ts";
import {
    TRADE_AGREEMENT_DAYS, TRADE_AGREEMENT_DAY_STEP,
    TRADE_HELP_BODY, decideTrade, normalizeTradeDays, tradeOfferIssue, tradeRemainingDays, tradeResourcesFor,
} from "../../game/trade.ts";
import { resourceVisibility, tradeResourceRate } from "../../game/resourceVisibility.ts";
import { requestCooldownDays } from "../../game/requests.ts";
import type { DiplomaticDecision } from "../../game/types/decision.ts";
import type { TradeCadence, TradeKind, TradeOffer, TradeResource, TradeTransfer } from "../../game/types/trade.ts";
import {
    compactNumber, escapeGameText, escapeHtml, iconMaskStyle, renderGameText, signedCompact, textToken,
} from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, richHelpButton } from "../panel.ts";
import { nationFlagHtmlFor } from "../flags.ts";
import {
    TRADE_KIND_LABEL, cadenceLabel, cadenceToken, proposalCooldownTip,
    resourceNames, tradeResourceLabel, tradeResourceOption, tradeStatusTooltipAttrs,
    tradeStatusTooltipHtml, transferList, visibilityToken,
} from "../trade.ts";

export interface TradeHooks {
    toast(message: string): void;
    sound: SoundManager;
}

interface DraftEntry {
    resource: TradeResource;
    amount: number;
    cadence: TradeCadence;
}

interface TradeDraft {
    kind: TradeKind;
    give: DraftEntry[];
    receive: DraftEntry[];
    days: number;
}

const KIND_TIP: Readonly<Record<TradeKind, string>> = {
    exchange: "双方各出[[industry]]、[[raw]]、[[food]]或[[strategic]]，不得使用[[funds]]、[[manpower]]或[[politics]]。可分别设置每月交割与一次性交付。",
    purchase: "我方只支付[[funds]]，由对方提供工业、原料、粮食或战略资源。",
    mercenary: "我方只支付[[funds]]，对方只提供[[manpower]]。",
    aid: "我方不提供对价，仅请求对方提供工业、原料、粮食或战略资源；不能索要[[funds]]、[[manpower]]或[[politics]]。",
};

const KIND_ICON: Readonly<Record<TradeKind, string>> = {
    exchange: "trade",
    purchase: "funds",
    mercenary: "manpower",
    aid: "trade",
};

const RESOURCE_ORDER: readonly TradeResource[] = ["funds", "manpower", "industry", "raw", "food", "strategic"];
const CADENCES: readonly TradeCadence[] = ["monthly", "fixed"];

function stepOf(resource: TradeResource): number {
    if (resource === "funds") return 10;
    if (resource === "manpower") return 5;
    return 0.5;
}

function defaultAmountOf(resource: TradeResource): number {
    if (resource === "funds") return 50;
    if (resource === "manpower") return 20;
    return 0.5;
}

function maxOf(resource: TradeResource): number {
    if (resource === "raw" || resource === "food" || resource === "strategic") return RESOURCE_CAPS[resource];
    return 9999;
}

function capOf(rates: ReturnType<typeof resourceRates>, resource: TradeResource): number | null {
    if (resource === "funds") return null;
    if (resource === "manpower") return rates.manpowerCap;
    if (resource === "industry") return rates.industryCap;
    return RESOURCE_CAPS[resource];
}

/** Trade tab: signed treaties, nation resource totals and a shared offer builder. */
export class TradePanel {
    private readonly engine: GameEngine;
    private readonly hooks: TradeHooks;
    private readonly el = document.querySelector<HTMLElement>("#trade-panel") as HTMLElement;
    private readonly hud = this.el.closest<HTMLElement>("#hud") as HTMLElement;
    private scrollTop = 0;
    private target: number | null = null;
    private viewSignature = "";
    private draft: TradeDraft | null = null;
    private scrim: HTMLElement | null = null;

    constructor(engine: GameEngine, hooks: TradeHooks) {
        this.engine = engine;
        this.hooks = hooks;
    }

    setTarget(nationId: number): void {
        const nation = this.engine.state.nations[nationId];
        if (!nation || nation.isPlayer) return;
        this.closeBuilder();
        this.target = nationId;
        this.render();
    }

    setHidden(hidden: boolean): void {
        const body = this.el.querySelector<HTMLElement>(".trade-body");
        if (hidden && body && body.clientHeight > 0) this.scrollTop = body.scrollTop;
        if (hidden) this.closeBuilder();
        this.el.classList.toggle("hidden", hidden);
        if (!hidden && body) body.scrollTop = this.scrollTop;
    }

    destroy(): void {
        this.closeBuilder();
    }

    handleAction(action: string, target: HTMLElement): boolean {
        if (action === "trade-target") {
            const nationId = Number(target.dataset.nation);
            if (Number.isInteger(nationId)) {
                this.setTarget(nationId);
                this.hooks.sound.play("select");
            }
            return true;
        }
        if (action === "trade-open") {
            const kind = target.dataset.kind as TradeKind | undefined;
            if (kind === "exchange" || kind === "purchase" || kind === "mercenary" || kind === "aid") {
                this.openBuilder(kind);
            }
            return true;
        }
        return false;
    }

    render(): void {
        const oldBody = this.el.querySelector<HTMLElement>(".trade-body");
        if (oldBody && oldBody.clientHeight > 0) this.scrollTop = oldBody.scrollTop;

        const state = this.engine.state;
        const player = state.nations[0];
        const others = state.nations.filter((nation) => !nation.isPlayer);
        if (this.target === null || !others.some((nation) => nation.id === this.target)) {
            this.target = others.find((nation) => nation.alive && this.hasTreaty(nation.id))?.id
                ?? others.find((nation) => nation.alive && !isAtWar(state, 0, nation.id))?.id
                ?? others.find((nation) => nation.alive)?.id ?? others[0]?.id ?? null;
        }
        if (this.draft && !this.canTrade(this.target)) this.closeBuilder();

        const signature = `${this.target}`;
        if (signature !== this.viewSignature) this.scrollTop = 0;
        this.viewSignature = signature;

        this.el.innerHTML = `
            ${panelHead({
                title: "贸易",
                help: { title: "贸易规则", body: TRADE_HELP_BODY },
                status: renderGameText(textToken("funds", Math.floor(player.funds))),
            })}
            <div class="panel-body trade-body">
                ${this.treatiesHtml()}
                <div class="diplo-swatches" role="tablist" aria-label="贸易对象">${this.swatchesHtml()}</div>
                ${this.target !== null ? this.nationHtml(this.target) : '<p class="diplo-note">没有可交易的国家。</p>'}
            </div>`;

        for (const tab of this.el.querySelectorAll<HTMLElement>("[data-action='trade-target']")) {
            tab.onkeydown = (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                this.setTarget(Number(tab.dataset.nation));
            };
        }
        const body = this.el.querySelector<HTMLElement>(".trade-body");
        if (body) body.scrollTop = this.scrollTop;
        if (this.draft) this.fillBuilder();
    }

    private hasTreaty(nationId: number): boolean {
        return this.engine.state.tradeAgreements.some((agreement) =>
            (agreement.from === 0 && agreement.to === nationId) || (agreement.from === nationId && agreement.to === 0));
    }

    private canTrade(nationId: number | null): boolean {
        if (nationId === null) return false;
        const state = this.engine.state;
        const nation = state.nations[nationId];
        return state.winner === null && nation?.alive === true && !isAtWar(state, 0, nationId);
    }

    /** Header chips: only panel resources that this treaty kind allows on that side. */
    private routeSideHtml(nationId: number, side: "give" | "receive", kind: TradeKind, reverse = false): string {
        const state = this.engine.state;
        const nation = state.nations[nationId];
        const rates = resourceRates(state, nationId);
        const allowed = tradeResourcesFor(kind, side);
        const isSelf = nationId === 0;
        const resources = RESOURCE_ORDER.filter((resource) => allowed.includes(resource));
        if (reverse) resources.reverse();
        const tokens = resources.map((resource) => {
            const visibility = resourceVisibility(state, 0, nationId, resource, tradeResourceRate(rates, resource));
            const resourceLabel = resourceNames([resource]);
            const value = visibility.mode === "exact"
                ? renderGameText(textToken(resource, nation[resource]))
                : `${renderGameText(textToken(resource))} ${visibilityToken(visibility.mode)}`;
            // Fuzzy mode produces two sibling text spans; collapse them into one
            // accessible node so a11y/DOM-tree readers keep the pair on one line.
            const accessible = visibility.mode === "exact"
                ? ""
                : `role="img" aria-label="${escapeHtml(`${resourceLabel} · ${visibility.label}`)}"`;
            const tip = tooltipAttrs(`${resourceLabel} · ${visibility.label}`, visibility.reason);
            return `<span class="trade-route-token" ${accessible} ${tip}>${value}</span>`;
        }).join("");
        const flag = nationFlagHtmlFor(state, nationId, 18);
        const name = `<span class="trade-route-name">${escapeHtml(nation.name)}</span>`;
        const head = isSelf ? `${flag}${name}${tokens}` : `${tokens}${name}${flag}`;
        const sideClass = isSelf ? "trade-route-side--self" : "trade-route-side--target";
        return `<span class="trade-route-side ${sideClass}">${head}</span>`;
    }

    /** Representative offer used only for the qualitative willingness tooltip. */
    private hintDecision(nationId: number): DiplomaticDecision {
        const transfer: TradeTransfer = { resource: "industry", amount: 0.5, cadence: "monthly" };
        return decideTrade(this.engine.state, nationId, 0, {
            kind: "exchange", give: [transfer], receive: [transfer],
        });
    }

    private treatiesHtml(): string {
        const state = this.engine.state;
        const agreements = state.tradeAgreements
            .filter((agreement) => agreement.from === 0 || agreement.to === 0)
            .sort((a, b) => a.expiresDay - b.expiresDay || a.id - b.id);
        if (!agreements.length) {
            return `<p class="trade-empty-note">尚未签署贸易条约。选择国家后可发起交换、购买、雇佣兵或援助。</p>`;
        }
        const rows = agreements.map((agreement) => {
            const partnerId = agreement.from === 0 ? agreement.to : agreement.from;
            const partner = state.nations[partnerId];
            if (!partner) return "";
            const outgoing = agreement.from === 0 ? agreement.give : agreement.receive;
            const incoming = agreement.from === 0 ? agreement.receive : agreement.give;
            const remaining = tradeRemainingDays(state, agreement);
            return `<details class="trade-treaty">
                <summary>
                    ${nationFlagHtmlFor(state, partnerId, 20)}
                    <span class="trade-treaty-name">${escapeHtml(partner.name)}</span>
                    <span class="trade-treaty-kind">${TRADE_KIND_LABEL[agreement.kind]}</span>
                    <span class="trade-treaty-days">还剩 ${renderGameText(textToken("turn", remaining))}</span>
                </summary>
                <div class="trade-treaty-body">
                    ${outgoing.length ? `<div class="trade-treaty-side"><span class="trade-side-label">我方提供</span>${transferList(outgoing, "out")}</div>` : ""}
                    ${incoming.length ? `<div class="trade-treaty-side"><span class="trade-side-label">对方提供</span>${transferList(incoming, "in")}</div>` : ""}
                    <p class="trade-treaty-note">每月部分${cadenceToken("monthly")}自动交割；固定部分已在签署时交付。</p>
                </div>
            </details>`;
        }).join("");
        return `<div class="trade-treaties"><div class="trade-section-head">已签条约</div>${rows}</div>`;
    }

    private swatchesHtml(): string {
        const state = this.engine.state;
        return state.nations.filter((nation) => !nation.isPlayer).map((nation) => {
            const selected = this.target === nation.id;
            const war = nation.alive && isAtWar(state, 0, nation.id);
            const truce = nation.alive && !war && truceDays(state, 0, nation.id) > 0;
            const treaty = nation.alive && this.hasTreaty(nation.id);
            const status = !nation.alive ? "已灭亡" : war ? "交战中" : "可贸易";
            const tip = tradeStatusTooltipAttrs(
                treaty, tendencyProfileOf(nation.tendency).name, this.hintDecision(nation.id),
                war ? "交战中：无法签署任何贸易条约。" : status,
            );
            const color = nationDisplayColor(state, nation.id);
            return `<button type="button" class="diplo-swatch trade-swatch${selected ? " selected" : ""}${nation.alive ? "" : " dead"}${war ? " war" : ""}${truce ? " truce" : ""}${treaty ? " treaty" : ""}" role="tab" aria-selected="${selected}"
                aria-label="${escapeHtml(`${nation.name}（${status}）`)}" style="--pc:${escapeHtml(color)}"
                data-action="trade-target" data-nation="${nation.id}"
                ${tooltipAttrs(escapeGameText(nation.name), "")} ${tip}>${nationFlagHtmlFor(state, nation.id, 22)}</button>`;
        }).join("");
    }

    private resourceTableHtml(nationId: number): string {
        const state = this.engine.state;
        const nation = state.nations[nationId];
        const rates = resourceRates(state, nationId);
        const politicsVisibility = resourceVisibility(state, 0, nationId, "politics");
        const politicsTip = tooltipAttrs(`资源情报 · ${politicsVisibility.label}`, politicsVisibility.reason);
        const rows = RESOURCE_ORDER.map((resource) => {
            const cap = capOf(rates, resource);
            const net = tradeResourceRate(rates, resource);
            const visibility = resourceVisibility(state, 0, nationId, resource, net);
            const tip = tooltipAttrs(`资源情报 · ${visibility.label}`, visibility.reason);
            if (visibility.mode !== "exact") {
                return `<div class="trade-res-row">
                    <span class="trade-res-name">${tradeResourceLabel(resource)}</span>
                    <span class="trade-res-stock" ${tip}>—</span>
                    <span class="trade-res-net trade-res-net--${visibility.mode}" ${tip}>${visibilityToken(visibility.mode)}</span>
                </div>`;
            }
            const tone = net > 0.05 ? " pos" : net < -0.05 ? " neg" : "";
            return `<div class="trade-res-row" ${tip}>
                <span class="trade-res-name">${tradeResourceLabel(resource)}</span>
                <span class="trade-res-stock">${renderGameText(textToken(resource, nation[resource]))}${cap === null ? "" : ` / ${compactNumber(cap)}`}</span>
                <span class="trade-res-net${tone}">${renderGameText(textToken(resource, signedCompact(net)))}</span>
            </div>`;
        }).join("");
        return `<div class="trade-res-table">
            <div class="trade-res-row trade-res-head"><span>资源</span><span>库存</span><span>净变化</span></div>
            ${rows}
            <div class="trade-res-row trade-res-politics">
                <span class="trade-res-name"><span class="game-text game-text--politics">政治点</span><span class="resource-icon" aria-hidden="true" ${iconMaskStyle("politics")}></span></span>
                <span class="trade-res-stock" ${politicsTip}>${politicsVisibility.mode === "exact"
                    ? renderGameText(textToken("politics", nation.politicalPower)) : "—"}</span>
                <span class="trade-res-note${politicsVisibility.mode === "exact" ? "" : ` trade-res-net--${politicsVisibility.mode}`}" ${politicsTip}>${politicsVisibility.mode === "exact"
                    ? "不可交易" : visibilityToken(politicsVisibility.mode)}</span>
            </div>
        </div>`;
    }

    private nationHtml(nationId: number): string {
        const state = this.engine.state;
        const nation = state.nations[nationId];
        const atWar = isAtWar(state, 0, nationId);
        const truce = truceDays(state, 0, nationId);
        const status = !nation.alive ? "已灭亡" : atWar
            ? `交战 ${renderGameText(textToken("turn", warDuration(state, 0, nationId)))}`
            : truce > 0 ? `停战 ${renderGameText(textToken("turn", truce))}` : "和平";
        const blocked = !nation.alive ? "该国已灭亡" : atWar ? "交战中无法贸易" : state.winner !== null ? "战役已结束" : "";
        const cooldown = requestCooldownDays(state, "trade", nationId);
        const blockedAttr = cooldown > 0 && !blocked ? 'aria-disabled="true"' : blocked ? "disabled" : "";
        const head = `<div class="diplo-head">${nationFlagHtmlFor(state, nationId, 26)}
            <span class="diplo-name">${escapeHtml(nation.name)}</span>
            <span class="status-pill ${!nation.alive ? "dead" : atWar ? "war" : "idle"}">${status}</span></div>`;
        const actions = ([...Object.keys(KIND_TIP) as TradeKind[]]).map((kind) => {
            const reason = cooldown > 0 ? proposalCooldownTip(cooldown) : blocked || KIND_TIP[kind];
            return `<button type="button" class="btn btn-outline trade-action${cooldown > 0 ? " cooldown" : ""}" data-action="trade-open" data-kind="${kind}" ${blockedAttr}
                ${tooltipAttrs(`${TRADE_KIND_LABEL[kind]}${blockedAttr ? " · 不可用" : ""}`, reason)}>
                <span class="icon-glyph" aria-hidden="true" ${iconMaskStyle(KIND_ICON[kind])}></span>${TRADE_KIND_LABEL[kind]}</button>`;
        }).join("");
        const notes = `<p class="diplo-note">贸易倾向：${escapeHtml(tendencyProfileOf(nation.tendency).name)} · 资源按情报可见性显示；仅贸易型国家、盟友、附庸／宗主与贸易伙伴可见具体数值。条约默认持续 ${renderGameText(textToken("turn", TRADE_AGREEMENT_DAYS))}，提议时可调。</p>`;
        return `<div class="diplo-row trade-card" data-trade-card="${nationId}">
            ${head}
            ${this.resourceTableHtml(nationId)}
            ${notes}
            <div class="diplo-actions-head">贸易行动</div>
            <div class="trade-actions">${actions}</div>
        </div>`;
    }

    /* ---- offer builder ---- */

    openBuilder(kind: TradeKind): void {
        const cooldown = this.target === null ? 0 : requestCooldownDays(this.engine.state, "trade", this.target);
        if (cooldown > 0) {
            this.hooks.sound.play("error");
            this.hooks.toast(proposalCooldownTip(cooldown));
            return;
        }
        if (!this.canTrade(this.target)) {
            this.hooks.sound.play("error");
            this.hooks.toast("当前无法与该国贸易：交战中、已灭亡或战役已结束");
            return;
        }
        this.closeBuilder();
        this.draft = { kind, give: [], receive: [], days: TRADE_AGREEMENT_DAYS };
        const scrim = document.createElement("div");
        scrim.className = "diplo-menu-scrim";
        scrim.innerHTML = `<div class="diplo-menu trade-menu" role="dialog" aria-label="${TRADE_KIND_LABEL[kind]}" tabindex="-1"></div>`;
        this.hud.appendChild(scrim);
        this.scrim = scrim;
        scrim.addEventListener("click", this.onBuilderClick);
        document.addEventListener("keydown", this.onBuilderKey);
        this.fillBuilder();
        scrim.querySelector<HTMLElement>(".trade-menu")?.focus({ preventScroll: true });
        this.hooks.sound.play("select");
    }

    closeBuilder(): boolean {
        if (!this.scrim) return false;
        this.scrim.removeEventListener("click", this.onBuilderClick);
        document.removeEventListener("keydown", this.onBuilderKey);
        this.scrim.remove();
        this.scrim = null;
        this.draft = null;
        return true;
    }

    private draftOffer(draft: TradeDraft): TradeOffer {
        const map = (entries: DraftEntry[]): TradeTransfer[] =>
            entries.map((entry) => ({ resource: entry.resource, amount: entry.amount, cadence: entry.cadence }));
        return { kind: draft.kind, give: map(draft.give), receive: map(draft.receive) };
    }

    private fillBuilder(): void {
        if (!this.scrim || !this.draft || this.target === null) return;
        const state = this.engine.state;
        const targetId = this.target;
        const target = state.nations[targetId];
        if (!target || !this.canTrade(targetId)) {
            this.closeBuilder();
            return;
        }
        const draft = this.draft;
        const card = this.scrim.querySelector<HTMLElement>(".trade-menu");
        if (!card) return;
        const offer = this.draftOffer(draft);
        const cooldown = requestCooldownDays(state, "trade", targetId);
        const issue = cooldown > 0 ? proposalCooldownTip(cooldown) : tradeOfferIssue(state, 0, offer, targetId);
        const decision = decideTrade(state, targetId, 0, offer, draft.days);
        const gives = draft.kind !== "aid";
        const targetName = escapeGameText(target.name);
        const days = normalizeTradeDays(draft.days);
        const treaty = this.hasTreaty(targetId);
        const tendency = tendencyProfileOf(target.tendency).name;
        const statusTip = tradeStatusTooltipHtml(treaty, tendency, decision, "确认后送出，下一回合答复。");

        const duration = issue
            ? `<span class="trade-builder-issue bad" ${tooltipAttrs("无法提交", issue)}>${escapeHtml(issue)}</span>`
            : `<div class="trade-duration-control" ${tooltipAttrs("协议持续回合", `每月部分${cadenceLabel("monthly")}自动交割，共 ${days} 回合；固定部分签署时一次交付。`)}>
                <span>持续</span>
                <button type="button" data-days-step="-1" aria-label="减少持续回合" ${tooltipAttrs("减少持续回合", `每次减少 ${TRADE_AGREEMENT_DAY_STEP} 回合。`)}>−</button>
                <b>${renderGameText(textToken("turn", days))} 回合</b>
                <button type="button" data-days-step="1" aria-label="增加持续回合" ${tooltipAttrs("增加持续回合", `每次增加 ${TRADE_AGREEMENT_DAY_STEP} 回合。`)}>+</button>
            </div>`;

        const header = `<div class="diplo-menu-head">
            <span class="trade-menu-title">${TRADE_KIND_LABEL[draft.kind]} · ${escapeHtml(target.name)}${
                richHelpButton(`${TRADE_KIND_LABEL[draft.kind]}说明`, statusTip, "条约说明")
            }</span>
            <button type="button" class="diplo-menu-x" data-builder-close aria-label="关闭贸易对话框">×</button>
        </div>
        <div class="trade-builder-route">
            ${this.routeSideHtml(0, "give", draft.kind)}
            ${this.routeSideHtml(targetId, "receive", draft.kind, true)}
        </div>
        <div class="trade-builder-sides${gives ? "" : " single"}">
            ${gives ? this.sideHtml("give") : ""}
            ${gives ? '<span class="trade-builder-link" aria-hidden="true">⇄</span>' : ""}
            ${this.sideHtml("receive")}
        </div>`;
        const confirmBlocked = issue ? (cooldown > 0 ? 'aria-disabled="true"' : "disabled") : "";
        const confirmTip = issue
            ? tooltipAttrs("无法提交", issue)
            : tradeStatusTooltipAttrs(
                treaty, tendency, decision, `向 ${targetName} 提议${TRADE_KIND_LABEL[draft.kind]}；确认后送出，下一回合答复。`,
            );
        const foot = `<div class="diplo-menu-foot trade-builder-foot">
            <div class="trade-builder-status">${duration}</div>
            <div class="trade-builder-actions">
                <button type="button" class="btn" data-builder-close ${tooltipAttrs("取消", "关闭对话框，不提交任何贸易提议。")}>取消</button>
                <button type="button" class="btn btn-primary${cooldown > 0 ? " cooldown" : ""}" data-builder-confirm ${confirmBlocked} ${confirmTip}>确认</button>
            </div>
        </div>`;
        card.innerHTML = `${header}${foot}`;
    }

    private sideHtml(side: "give" | "receive"): string {
        const draft = this.draft;
        if (!draft || this.target === null) return "";
        const entries = side === "give" ? draft.give : draft.receive;
        const label = side === "give" ? "我方提供" : "对方提供";
        const blocks = CADENCES.map((cadence) => {
            const rows = entries.filter((entry) => entry.cadence === cadence);
            const available = tradeResourcesFor(draft.kind, side)
                .filter((resource) => !rows.some((entry) => entry.resource === resource));
            const options = available.map(tradeResourceOption).join("");
            const controls = `<span class="trade-cadence-add">
                <select data-trade-pick data-side="${side}" data-cadence="${cadence}" aria-label="选择要添加的资源" ${available.length ? "" : "disabled"}>${options || '<option value="">无可用资源</option>'}</select>
                <button type="button" class="btn btn-sm" data-builder-add data-side="${side}" data-cadence="${cadence}" ${available.length ? "" : "disabled"}
                    ${tooltipAttrs("添加资源", `向「${label} · ${cadenceLabel(cadence)}」添加一项资源。`)}>+</button>
            </span>`;
            const rowHtml = rows.length ? rows.map((entry) => {
                const step = stepOf(entry.resource);
                return `<div class="trade-builder-row">
                    <span class="trade-builder-token">${renderGameText(textToken(entry.resource, entry.amount))}</span>
                    <span class="trade-stepper">
                        <button type="button" data-builder-step data-side="${side}" data-cadence="${cadence}" data-resource="${entry.resource}" data-delta="-1"
                            aria-label="减少数量" ${tooltipAttrs("减少", `减少 ${compactNumber(step)}。`)}>−</button>
                        <b>${compactNumber(entry.amount)}</b>
                        <button type="button" data-builder-step data-side="${side}" data-cadence="${cadence}" data-resource="${entry.resource}" data-delta="1"
                            aria-label="增加数量" ${tooltipAttrs("增加", `增加 ${compactNumber(step)}。`)}>+</button>
                    </span>
                    <button type="button" class="trade-remove" data-builder-remove data-side="${side}" data-cadence="${cadence}" data-resource="${entry.resource}"
                        aria-label="移除" ${tooltipAttrs("移除", "从本侧移除这项资源。")}>×</button>
                </div>`;
            }).join("") : `<p class="trade-builder-empty">尚未添加</p>`;
            return `<div class="trade-cadence-block">
                <div class="trade-cadence-head"><span>${cadenceToken(cadence)}</span>${controls}</div>
                ${rowHtml}
            </div>`;
        }).join("");
        return `<div class="trade-builder-side">
            <div class="trade-side-head">${label}</div>
            ${blocks}
        </div>`;
    }

    private readonly onBuilderKey = (event: KeyboardEvent): void => {
        if (event.key !== "Escape" || !this.scrim) return;
        event.preventDefault();
        this.closeBuilder();
    };

    private readonly onBuilderClick = (event: Event): void => {
        const target = event.target as HTMLElement;
        if (target === this.scrim || target.closest("[data-builder-close]")) {
            this.closeBuilder();
            return;
        }
        if (target.closest("[data-builder-confirm]")) {
            this.commitBuilder();
            return;
        }
        if (target.closest("[data-builder-add]")) {
            this.addEntry(target);
            return;
        }
        if (target.closest("[data-builder-step]")) {
            this.stepEntry(target);
            return;
        }
        if (target.closest("[data-builder-remove]")) {
            this.removeEntry(target);
            return;
        }
        const daysButton = target.closest<HTMLElement>("[data-days-step]");
        if (daysButton && this.draft) {
            const delta = Number(daysButton.dataset.daysStep);
            if (Number.isFinite(delta)) {
                this.draft.days = normalizeTradeDays(this.draft.days + delta * TRADE_AGREEMENT_DAY_STEP);
                this.hooks.sound.play("select");
                this.fillBuilder();
            }
        }
    };

    private addEntry(button: HTMLElement): void {
        const draft = this.draft;
        if (!draft) return;
        const side = button.dataset.side === "give" ? "give" : button.dataset.side === "receive" ? "receive" : null;
        const cadence = button.dataset.cadence as TradeCadence | undefined;
        if (!side || (cadence !== "monthly" && cadence !== "fixed")) return;
        const select = this.scrim?.querySelector<HTMLSelectElement>(
            `select[data-trade-pick][data-side="${side}"][data-cadence="${cadence}"]`);
        const resource = select?.value as TradeResource | undefined;
        if (!resource) return;
        const entries = side === "give" ? draft.give : draft.receive;
        entries.push({ resource, amount: defaultAmountOf(resource), cadence });
        this.hooks.sound.play("select");
        this.fillBuilder();
    }

    private stepEntry(button: HTMLElement): void {
        const draft = this.draft;
        if (!draft) return;
        const side = button.dataset.side === "give" ? "give" : button.dataset.side === "receive" ? "receive" : null;
        const cadence = button.dataset.cadence as TradeCadence | undefined;
        const resource = button.dataset.resource as TradeResource | undefined;
        const delta = Number(button.dataset.delta);
        if (!side || (cadence !== "monthly" && cadence !== "fixed") || !resource || !Number.isFinite(delta)) return;
        const entry = (side === "give" ? draft.give : draft.receive)
            .find((item) => item.resource === resource && item.cadence === cadence);
        if (!entry) return;
        const step = stepOf(resource);
        entry.amount = Math.max(step, Math.min(maxOf(resource), Math.round((entry.amount + delta * step) * 10) / 10));
        this.hooks.sound.play("select");
        this.fillBuilder();
    }

    private removeEntry(button: HTMLElement): void {
        const draft = this.draft;
        if (!draft) return;
        const side = button.dataset.side === "give" ? "give" : button.dataset.side === "receive" ? "receive" : null;
        const cadence = button.dataset.cadence as TradeCadence | undefined;
        const resource = button.dataset.resource as TradeResource | undefined;
        if (!side || !resource) return;
        const entries = side === "give" ? draft.give : draft.receive;
        const index = entries.findIndex((item) => item.resource === resource && item.cadence === cadence);
        if (index >= 0) entries.splice(index, 1);
        this.hooks.sound.play("select");
        this.fillBuilder();
    }

    private commitBuilder(): void {
        if (!this.draft || this.target === null) return;
        const state = this.engine.state;
        const targetId = this.target;
        const offer = this.draftOffer(this.draft);
        const cooldown = requestCooldownDays(state, "trade", targetId);
        const issue = cooldown > 0 ? proposalCooldownTip(cooldown) : tradeOfferIssue(state, 0, offer, targetId);
        if (issue) {
            this.hooks.sound.play("error");
            this.hooks.toast(issue);
            this.fillBuilder();
            return;
        }
        const days = normalizeTradeDays(this.draft.days);
        if (this.engine.proposeTrade(targetId, this.draft.kind, offer.give, offer.receive, days)) {
            this.hooks.sound.play("recruit");
            this.hooks.toast("提议已送出，下一回合答复");
            this.closeBuilder();
            this.render();
        } else {
            this.hooks.sound.play("error");
            this.hooks.toast("提议无法送出：条件已发生变化");
            this.fillBuilder();
            this.render();
        }
    }
}

