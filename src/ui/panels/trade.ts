import type { GameEngine } from "../../game/engine.ts";
import type { SoundManager } from "../../audio/index.ts";
import type { GameState } from "../../game/types/state.ts";
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
    compactNumber, escapeGameText, escapeHtml, game, gameText, html, iconMaskStyle,
    rawHtml, setGameHtml, signedCompact,
} from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import type { UIDispatchData } from "../context.ts";
import { panelHead, PanelShell, richHelpButton } from "../panel.ts";
import type { PanelView } from "../panel.ts";
import { nationFlagHtmlFor } from "../flags.ts";
import { gameHtml, scopedTexts } from "../view.ts";
import {
    TRADE_KIND_LABEL, cadenceLabel, cadenceToken, proposalCooldownTip,
    resourceNames, tradeResourceLabel, tradeResourceOption, tradeStatusTooltipAttrs,
    tradeStatusTooltipHtml, transferList, visibilityToken,
} from "../trade.ts";
import { t } from "../../i18n/index.ts";

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

const KIND_ICON: Readonly<Record<TradeKind, string>> = {
    exchange: "trade",
    purchase: "funds",
    mercenary: "manpower",
    aid: "trade",
};

const RESOURCE_ORDER: readonly TradeResource[] = ["funds", "manpower", "industry", "raw", "food", "strategic"];
const CADENCES: readonly TradeCadence[] = ["monthly", "fixed"];
const KINDS: readonly TradeKind[] = ["exchange", "purchase", "mercenary", "aid"];

function tradeTexts() {
    const s = scopedTexts("panels.trade.", {
        title: ["title"],
        helpTitle: ["helpTitle"],
        targetsLabel: ["targetsLabel"],
        noPartners: ["noPartners"],
        treatiesEmpty: ["treatiesEmpty"],
        treatiesTitle: ["treaties.title"],
        sideGive: ["side.give"],
        sideReceive: ["side.receive"],
        statusDead: ["status.dead"],
        statusWar: ["status.war"],
        statusOpen: ["status.open"],
        statusWarTip: ["status.warTip"],
        statusAtWar: ["status.atWar"],
        statusTruce: ["status.truce"],
        statusPeace: ["status.peace"],
        blockedDead: ["blocked.dead"],
        blockedWar: ["blocked.war"],
        blockedEnded: ["blocked.ended"],
        unavailable: ["unavailable"],
        actionsTitle: ["actions.title"],
        colResource: ["resource.col.resource"],
        colStock: ["resource.col.stock"],
        colNet: ["resource.col.net"],
        resourcePolitics: ["resource.politics"],
        resourceNotTradable: ["resource.notTradable"],
        kindTipExchange: ["kindTip.exchange"],
        kindTipPurchase: ["kindTip.purchase"],
        kindTipMercenary: ["kindTip.mercenary"],
        kindTipAid: ["kindTip.aid"],
    });
    return {
        ...s,
        statusAtWar: (days: number) => t("panels.trade.status.atWar", { days }),
        statusTruce: (days: number) => t("panels.trade.status.truce", { days }),
        treatyRemaining: (remaining: number) => t("panels.trade.treaty.remaining", { remaining }),
        treatyNote: () => t("panels.trade.treaty.note", { cadence: cadenceToken("monthly") }),
        swatchStatus: (status: string) => t("panels.trade.swatch.status", { status }),
        resourceIntel: (label: string) => t("panels.trade.resource.intel", { label }),
        nationNote: (tendency: string) => t("panels.trade.nation.note", { tendency, days: TRADE_AGREEMENT_DAYS }),
    };
}
type TradeTexts = ReturnType<typeof tradeTexts>;

function kindTip(kind: TradeKind, text: TradeTexts): string {
    if (kind === "exchange") return text.kindTipExchange;
    if (kind === "purchase") return text.kindTipPurchase;
    if (kind === "mercenary") return text.kindTipMercenary;
    return text.kindTipAid;
}

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

function hasTreaty(state: GameState, nationId: number): boolean {
    return state.tradeAgreements.some((agreement) =>
        (agreement.from === 0 && agreement.to === nationId) || (agreement.from === nationId && agreement.to === 0));
}

function canTrade(state: GameState, nationId: number | null): boolean {
    if (nationId === null) return false;
    const nation = state.nations[nationId];
    return state.winner === null && nation?.alive === true && !isAtWar(state, 0, nationId);
}

/** Representative offer used only for the qualitative willingness tooltip. */
function hintDecision(state: GameState, nationId: number): DiplomaticDecision {
    const transfer: TradeTransfer = { resource: "industry", amount: 0.5, cadence: "monthly" };
    return decideTrade(state, nationId, 0, {
        kind: "exchange", give: [transfer], receive: [transfer],
    });
}

/** Header chips: only panel resources that this treaty kind allows on that side. */
function routeSideHtml(
    state: GameState, nationId: number, side: "give" | "receive", kind: TradeKind,
    reverse: boolean,
): string {
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
            ? gameText(game`[[${resource}:${nation[resource]}]]`)
            : game`[[${resource}]] ${visibilityToken(visibility.mode)}`;
        // Fuzzy mode produces two sibling text spans; collapse them into one
        // accessible node so a11y/DOM-tree readers keep the pair on one line.
        const accessible = visibility.mode === "exact"
            ? ""
            : `role="img" aria-label="${escapeHtml(`${resourceLabel} · ${visibility.label}`)}"`;
        const tip = tooltipAttrs(`${resourceLabel} · ${visibility.label}`, visibility.reason);
        return html`<span class="trade-route-token" ${rawHtml(accessible)} ${rawHtml(tip)}>${rawHtml(value)}</span>`;
    }).join("");
    const flag = nationFlagHtmlFor(state, nationId, 18);
    const name = html`<span class="trade-route-name">${nation.name}</span>`;
    const head = isSelf ? `${flag}${name}${tokens}` : `${tokens}${name}${flag}`;
    const sideClass = isSelf ? "trade-route-side--self" : "trade-route-side--target";
    return html`<span class="trade-route-side ${sideClass}">${rawHtml(head)}</span>`;
}

function treatiesHtml(state: GameState, text: TradeTexts): string {
    const agreements = state.tradeAgreements
        .filter((agreement) => agreement.from === 0 || agreement.to === 0)
        .sort((a, b) => a.expiresDay - b.expiresDay || a.id - b.id);
    if (!agreements.length) return html`<p class="trade-empty-note">${text.treatiesEmpty}</p>`;
    const rows = agreements.map((agreement) => {
        const partnerId = agreement.from === 0 ? agreement.to : agreement.from;
        const partner = state.nations[partnerId];
        if (!partner) return "";
        const outgoing = agreement.from === 0 ? agreement.give : agreement.receive;
        const incoming = agreement.from === 0 ? agreement.receive : agreement.give;
        const remaining = tradeRemainingDays(state, agreement);
        const giveSide = outgoing.length
            ? html`<div class="trade-treaty-side"><span class="trade-side-label">${text.sideGive}</span>${rawHtml(transferList(outgoing, "out"))}</div>`
            : "";
        const receiveSide = incoming.length
            ? html`<div class="trade-treaty-side"><span class="trade-side-label">${text.sideReceive}</span>${rawHtml(transferList(incoming, "in"))}</div>`
            : "";
        return html`<details class="trade-treaty">
            <summary>
                ${rawHtml(nationFlagHtmlFor(state, partnerId, 20))}
                <span class="trade-treaty-name">${partner.name}</span>
                <span class="trade-treaty-kind">${TRADE_KIND_LABEL[agreement.kind]}</span>
                <span class="trade-treaty-days">${text.treatyRemaining(remaining)}</span>
            </summary>
            <div class="trade-treaty-body">
                ${rawHtml(giveSide)}${rawHtml(receiveSide)}
                <p class="trade-treaty-note">${text.treatyNote()}</p>
            </div>
        </details>`;
    }).join("");
    return html`<div class="trade-treaties"><div class="trade-section-head">${text.treatiesTitle}</div>${rawHtml(rows)}</div>`;
}

function swatchesHtml(state: GameState, target: number | null, text: TradeTexts): string {
    return state.nations.filter((nation) => !nation.isPlayer).map((nation) => {
        const selected = target === nation.id;
        const war = nation.alive && isAtWar(state, 0, nation.id);
        const truce = nation.alive && !war && truceDays(state, 0, nation.id) > 0;
        const treaty = nation.alive && hasTreaty(state, nation.id);
        const status = !nation.alive ? text.statusDead : war ? text.statusWar : text.statusOpen;
        const tip = tradeStatusTooltipAttrs(
            treaty, tendencyProfileOf(nation.tendency).name, hintDecision(state, nation.id),
            war ? text.statusWarTip : status,
        );
        const color = nationDisplayColor(state, nation.id);
        return html`<button type="button" class="diplo-swatch trade-swatch${selected ? " selected" : ""}${nation.alive ? "" : " dead"}${war ? " war" : ""}${truce ? " truce" : ""}${treaty ? " treaty" : ""}" role="tab" aria-selected="${selected}"
            aria-label="${`${nation.name}${text.swatchStatus(status)}`}" style="--pc:${color}"
            data-action="trade-target" data-nation="${nation.id}"
            ${rawHtml(tooltipAttrs(escapeGameText(nation.name), ""))} ${rawHtml(tip)}>${rawHtml(nationFlagHtmlFor(state, nation.id, 22))}</button>`;
    }).join("");
}

function resourceTableHtml(state: GameState, nationId: number, text: TradeTexts): string {
    const nation = state.nations[nationId];
    const rates = resourceRates(state, nationId);
    const politicsVisibility = resourceVisibility(state, 0, nationId, "politics");
    const politicsTip = tooltipAttrs(text.resourceIntel(politicsVisibility.label), politicsVisibility.reason);
    const rows = RESOURCE_ORDER.map((resource) => {
        const cap = capOf(rates, resource);
        const net = tradeResourceRate(rates, resource);
        const visibility = resourceVisibility(state, 0, nationId, resource, net);
        const tip = tooltipAttrs(text.resourceIntel(visibility.label), visibility.reason);
        if (visibility.mode !== "exact") {
            return html`<div class="trade-res-row">
                <span class="trade-res-name">${rawHtml(tradeResourceLabel(resource))}</span>
                <span class="trade-res-stock" ${rawHtml(tip)}>—</span>
                <span class="trade-res-net trade-res-net--${visibility.mode}" ${rawHtml(tip)}>${rawHtml(visibilityToken(visibility.mode))}</span>
            </div>`;
        }
        const tone = net > 0.05 ? " pos" : net < -0.05 ? " neg" : "";
        return html`<div class="trade-res-row" ${rawHtml(tip)}>
            <span class="trade-res-name">${rawHtml(tradeResourceLabel(resource))}</span>
            <span class="trade-res-stock">${rawHtml(game`[[${resource}:${nation[resource]}]]`)}${cap === null ? "" : ` / ${compactNumber(cap)}`}</span>
            <span class="trade-res-net${tone}">${rawHtml(game`[[${resource}:${signedCompact(net)}]]`)}</span>
        </div>`;
    }).join("");
    return html`<div class="trade-res-table">
        <div class="trade-res-row trade-res-head"><span>${text.colResource}</span><span>${text.colStock}</span><span>${text.colNet}</span></div>
        ${rawHtml(rows)}
        <div class="trade-res-row trade-res-politics">
            <span class="trade-res-name"><span class="game-text game-text--politics">${text.resourcePolitics}</span><span class="resource-icon" aria-hidden="true" ${rawHtml(iconMaskStyle("politics"))}></span></span>
            <span class="trade-res-stock" ${rawHtml(politicsTip)}>${politicsVisibility.mode === "exact"
                ? rawHtml(gameText(`[[politics:${nation.politicalPower}]]`)) : "—"}</span>
            <span class="trade-res-note${politicsVisibility.mode === "exact" ? "" : ` trade-res-net--${politicsVisibility.mode}`}" ${rawHtml(politicsTip)}>${politicsVisibility.mode === "exact"
                ? text.resourceNotTradable : rawHtml(visibilityToken(politicsVisibility.mode))}</span>
        </div>
    </div>`;
}

function nationHtml(state: GameState, nationId: number, text: TradeTexts): string {
    const nation = state.nations[nationId];
    const atWar = isAtWar(state, 0, nationId);
    const truce = truceDays(state, 0, nationId);
    const status = !nation.alive ? text.statusDead : atWar
        ? text.statusAtWar(warDuration(state, 0, nationId))
        : truce > 0 ? text.statusTruce(truce) : text.statusPeace;
    const blocked = !nation.alive ? text.blockedDead : atWar ? text.blockedWar : state.winner !== null ? text.blockedEnded : "";
    const cooldown = requestCooldownDays(state, "trade", nationId);
    const blockedAttr = cooldown > 0 && !blocked ? 'aria-disabled="true"' : blocked ? "disabled" : "";
    const actions = KINDS.map((kind) => {
        const reason = cooldown > 0 ? proposalCooldownTip(cooldown) : blocked || kindTip(kind, text);
        return html`<button type="button" class="btn btn-outline trade-action${cooldown > 0 ? " cooldown" : ""}" data-action="trade-open" data-kind="${kind}" ${rawHtml(blockedAttr)}
            ${rawHtml(tooltipAttrs(`${TRADE_KIND_LABEL[kind]}${blockedAttr ? text.unavailable : ""}`, reason))}>
            <span class="icon-glyph" aria-hidden="true" ${rawHtml(iconMaskStyle(KIND_ICON[kind]))}></span>${TRADE_KIND_LABEL[kind]}</button>`;
    }).join("");
    return html`<div class="diplo-row trade-card" data-trade-card="${nationId}">
        <div class="diplo-head">${rawHtml(nationFlagHtmlFor(state, nationId, 26))}
            <span class="diplo-name">${nation.name}</span>
            <span class="status-pill ${!nation.alive ? "dead" : atWar ? "war" : "idle"}">${status}</span></div>
        ${rawHtml(resourceTableHtml(state, nationId, text))}
        <p class="diplo-note">${text.nationNote(tendencyProfileOf(nation.tendency).name)}</p>
        <div class="diplo-actions-head">${text.actionsTitle}</div>
        <div class="trade-actions">${rawHtml(actions)}</div>
    </div>`;
}

export interface TradeViewContext {
    readonly state: GameState;
    readonly target: number | null;
}

/** Pure view builder: treaty list, nation tabs and selected nation card. */
export function tradeView(ctx: TradeViewContext): PanelView {
    const { state, target } = ctx;
    const text = tradeTexts();
    const player = state.nations[0];
    return {
        head: panelHead({
            title: text.title,
            help: { title: text.helpTitle, body: TRADE_HELP_BODY },
            status: gameHtml(game`[[funds:${Math.floor(player.funds)}]]`),
        }),
        bodyClass: "trade-body",
        body: html`${rawHtml(treatiesHtml(state, text))}
            <div class="diplo-swatches" role="tablist" aria-label="${text.targetsLabel}">${rawHtml(swatchesHtml(state, target, text))}</div>
            ${target !== null ? rawHtml(nationHtml(state, target, text)) : html`<p class="diplo-note">${text.noPartners}</p>`}`,
    };
}

/** Trade tab: signed treaties, nation resource totals and a shared offer builder. */
export class TradePanel {
    private readonly engine: GameEngine;
    private readonly hooks: TradeHooks;
    private readonly shell = new PanelShell(document.querySelector<HTMLElement>("#trade-panel") as HTMLElement);
    private readonly el = this.shell.el;
    private readonly hud = this.el.closest<HTMLElement>("#hud") as HTMLElement;
    private target: number | null = null;
    private viewSignature = "";
    private draft: TradeDraft | null = null;
    private scrim: HTMLElement | null = null;

    constructor(engine: GameEngine, hooks: TradeHooks) {
        this.engine = engine;
        this.hooks = hooks;
        this.el.addEventListener("keydown", this.onTargetKey);
    }

    setTarget(nationId: number): void {
        const nation = this.engine.state.nations[nationId];
        if (!nation || nation.isPlayer) return;
        this.closeBuilder();
        this.target = nationId;
        this.render();
    }

    setHidden(hidden: boolean): void {
        if (hidden) this.closeBuilder();
        if (hidden) this.shell.hide();
        else this.shell.show();
    }

    destroy(): void {
        this.closeBuilder();
    }

    handleAction(action: string, data: UIDispatchData): boolean {
        if (action === "trade-target") {
            const nationId = Number(data.nation);
            if (Number.isInteger(nationId)) {
                this.setTarget(nationId);
                this.hooks.sound.play("select");
            }
            return true;
        }
        if (action === "trade-open") {
            const kind = data.kind as TradeKind | undefined;
            if (kind === "exchange" || kind === "purchase" || kind === "mercenary" || kind === "aid") {
                this.openBuilder(kind);
            }
            return true;
        }
        return false;
    }

    render(): void {
        const state = this.engine.state;
        const others = state.nations.filter((nation) => !nation.isPlayer);
        if (this.target === null || !others.some((nation) => nation.id === this.target)) {
            this.target = others.find((nation) => nation.alive && hasTreaty(state, nation.id))?.id
                ?? others.find((nation) => nation.alive && !isAtWar(state, 0, nation.id))?.id
                ?? others.find((nation) => nation.alive)?.id ?? others[0]?.id ?? null;
        }
        if (this.draft && !canTrade(state, this.target)) this.closeBuilder();

        const signature = `${this.target}`;
        const resetScroll = signature !== this.viewSignature;
        this.viewSignature = signature;
        this.shell.render(tradeView({ state, target: this.target }));
        if (resetScroll) {
            const body = this.el.querySelector<HTMLElement>(".trade-body");
            if (body) body.scrollTop = 0;
        }
        if (this.draft) this.fillBuilder();
    }

    private readonly onTargetKey = (event: KeyboardEvent): void => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const tab = (event.target as HTMLElement).closest<HTMLElement>("[data-action='trade-target']");
        if (!tab) return;
        event.preventDefault();
        event.stopPropagation();
        this.setTarget(Number(tab.dataset.nation));
    };

    /* ---- offer builder ---- */

    openBuilder(kind: TradeKind): void {
        const cooldown = this.target === null ? 0 : requestCooldownDays(this.engine.state, "trade", this.target);
        if (cooldown > 0) {
            this.hooks.sound.play("error");
            this.hooks.toast(proposalCooldownTip(cooldown));
            return;
        }
        if (!canTrade(this.engine.state, this.target)) {
            this.hooks.sound.play("error");
            this.hooks.toast(t("panels.trade.toast.cannotTrade"));
            return;
        }
        this.closeBuilder();
        this.draft = { kind, give: [], receive: [], days: TRADE_AGREEMENT_DAYS };
        const scrim = document.createElement("div");
        scrim.className = "diplo-menu-scrim";
        setGameHtml(scrim, `<div class="diplo-menu trade-menu" role="dialog" aria-label="${TRADE_KIND_LABEL[kind]}" tabindex="-1"></div>`);
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
        if (!target || !canTrade(state, targetId)) {
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
        const treaty = hasTreaty(state, targetId);
        const tendency = tendencyProfileOf(target.tendency).name;
        const statusTip = tradeStatusTooltipHtml(treaty, tendency, decision, t("panels.trade.confirmHint"));
        const builderText = {
            cannotSubmit: t("panels.trade.cannotSubmit"),
            durationTitle: t("panels.trade.duration.title"),
            durationTip: t("panels.trade.duration.tipBody", { cadence: cadenceLabel("monthly"), days }),
            durationLabel: t("panels.trade.duration.label"),
            durationDecrease: t("panels.trade.duration.decrease"),
            durationDecreaseTip: t("panels.trade.duration.decreaseTip", { step: TRADE_AGREEMENT_DAY_STEP }),
            durationValue: t("panels.trade.duration.value", { days }),
            durationIncrease: t("panels.trade.duration.increase"),
            durationIncreaseTip: t("panels.trade.duration.increaseTip", { step: TRADE_AGREEMENT_DAY_STEP }),
            kindHelp: t("panels.trade.kind.help", { kind: TRADE_KIND_LABEL[draft.kind] }),
            treatyHelpTitle: t("panels.trade.treaty.helpTitle"),
            builderClose: t("panels.trade.builder.close"),
            cancel: t("panels.trade.cancel"),
            cancelTip: t("panels.trade.cancelTip"),
            confirmTip: t("panels.trade.confirmTip", { target: targetName, kind: TRADE_KIND_LABEL[draft.kind] }),
            confirm: t("panels.trade.confirm"),
        };

        const duration = issue
            ? `<span class="trade-builder-issue bad" ${tooltipAttrs(builderText.cannotSubmit, issue)}>${escapeHtml(issue)}</span>`
            : game`<div class="trade-duration-control" ${tooltipAttrs(builderText.durationTitle, builderText.durationTip)}>
                <span>${builderText.durationLabel}</span>
                <button type="button" data-days-step="-1" aria-label="${builderText.durationDecrease}" ${tooltipAttrs(builderText.durationDecrease, builderText.durationDecreaseTip)}>−</button>
                <b>${builderText.durationValue}</b>
                <button type="button" data-days-step="1" aria-label="${builderText.durationIncrease}" ${tooltipAttrs(builderText.durationIncrease, builderText.durationIncreaseTip)}>+</button>
            </div>`;

        const header = `<div class="diplo-menu-head">
            <span class="trade-menu-title">${TRADE_KIND_LABEL[draft.kind]} · ${escapeHtml(target.name)}${
                richHelpButton(builderText.kindHelp, statusTip, builderText.treatyHelpTitle)
            }</span>
            <button type="button" class="diplo-menu-x" data-builder-close aria-label="${builderText.builderClose}">×</button>
        </div>
        <div class="trade-builder-route">
            ${routeSideHtml(state, 0, "give", draft.kind, false)}
            ${routeSideHtml(state, targetId, "receive", draft.kind, true)}
        </div>
        <div class="trade-builder-sides${gives ? "" : " single"}">
            ${gives ? this.sideHtml("give") : ""}
            ${gives ? '<span class="trade-builder-link" aria-hidden="true">⇄</span>' : ""}
            ${this.sideHtml("receive")}
        </div>`;
        const confirmBlocked = issue ? (cooldown > 0 ? 'aria-disabled="true"' : "disabled") : "";
        const confirmTip = issue
            ? tooltipAttrs(builderText.cannotSubmit, issue)
            : tradeStatusTooltipAttrs(treaty, tendency, decision, builderText.confirmTip);
        const foot = `<div class="diplo-menu-foot trade-builder-foot">
            <div class="trade-builder-status">${duration}</div>
            <div class="trade-builder-actions">
                <button type="button" class="btn" data-builder-close ${tooltipAttrs(builderText.cancel, builderText.cancelTip)}>${builderText.cancel}</button>
                <button type="button" class="btn btn-primary${cooldown > 0 ? " cooldown" : ""}" data-builder-confirm ${confirmBlocked} ${confirmTip}>${builderText.confirm}</button>
            </div>
        </div>`;
        setGameHtml(card, `${header}${foot}`);
    }

    private sideHtml(side: "give" | "receive"): string {
        const draft = this.draft;
        if (!draft || this.target === null) return "";
        const entries = side === "give" ? draft.give : draft.receive;
        const text = scopedTexts("panels.trade.", {
            sideGive: ["side.give"],
            sideReceive: ["side.receive"],
            pick: ["builder.pick"],
            noResources: ["builder.noResources"],
            add: ["builder.add"],
            empty: ["builder.empty"],
            decrease: ["stepper.decrease"],
            increase: ["stepper.increase"],
            remove: ["stepper.remove"],
            removeTip: ["stepper.removeTip"],
        });
        const label = side === "give" ? text.sideGive : text.sideReceive;
        const blocks = CADENCES.map((cadence) => {
            const rows = entries.filter((entry) => entry.cadence === cadence);
            const available = tradeResourcesFor(draft.kind, side)
                .filter((resource) => !rows.some((entry) => entry.resource === resource));
            const options = available.map(tradeResourceOption).join("");
            const addTip = t("panels.trade.builder.addTip", { label, cadence: cadenceLabel(cadence) });
            const controls = `<span class="trade-cadence-add">
                <select data-trade-pick data-side="${side}" data-cadence="${cadence}" aria-label="${text.pick}" ${available.length ? "" : "disabled"}>${options || `<option value="">${text.noResources}</option>`}</select>
                <button type="button" class="btn btn-sm" data-builder-add data-side="${side}" data-cadence="${cadence}" ${available.length ? "" : "disabled"}
                    ${tooltipAttrs(text.add, addTip)}>+</button>
            </span>`;
            const rowHtml = rows.length ? rows.map((entry) => {
                const step = stepOf(entry.resource);
                const amount = compactNumber(step);
                const decreaseTip = t("panels.trade.stepper.decreaseTip", { amount });
                const increaseTip = t("panels.trade.stepper.increaseTip", { amount });
                return game`<div class="trade-builder-row">
                    <span class="trade-builder-token">[[${entry.resource}:${entry.amount}]]</span>
                    <span class="trade-stepper">
                        <button type="button" data-builder-step data-side="${side}" data-cadence="${cadence}" data-resource="${entry.resource}" data-delta="-1"
                            aria-label="${text.decrease}" ${tooltipAttrs(text.decrease, decreaseTip)}>−</button>
                        <b>${compactNumber(entry.amount)}</b>
                        <button type="button" data-builder-step data-side="${side}" data-cadence="${cadence}" data-resource="${entry.resource}" data-delta="1"
                            aria-label="${text.increase}" ${tooltipAttrs(text.increase, increaseTip)}>+</button>
                    </span>
                    <button type="button" class="trade-remove" data-builder-remove data-side="${side}" data-cadence="${cadence}" data-resource="${entry.resource}"
                        aria-label="${text.remove}" ${tooltipAttrs(text.remove, text.removeTip)}>×</button>
                </div>`;
            }).join("") : html`<p class="trade-builder-empty">${text.empty}</p>`;
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
            this.hooks.toast(t("panels.trade.toast.sent"));
            this.closeBuilder();
            this.render();
        } else {
            this.hooks.sound.play("error");
            this.hooks.toast(t("panels.trade.toast.failed"));
            this.fillBuilder();
            this.render();
        }
    }
}
