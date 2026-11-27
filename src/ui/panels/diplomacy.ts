import type { GameEngine } from "../../game/engine.ts";
import type { SoundManager } from "../../audio/index.ts";
import {
    DIPLOMATIC_PROFILES, canDeclareWar, canPrepareDiplomaticAction, cancelRefund,
    decidePeace, isAtWar, truceDays, warDuration,
} from "../../game/diplomacy.ts";
import { nationArmyCount, nationProvinceCount } from "../../game/rules.ts";
import { warGoalProgress } from "../../game/settlement.ts";
import { tendencyProfileOf } from "../../game/ai/tendencies.ts";
import {
    ALLIANCE_CREATE_COST, allianceOf, canCreateAlliance, canInviteToAlliance,
    decideAllianceInvite, decideJoinRequest,
} from "../../game/alliance.ts";
import { VASSAL_PROFILES, VASSAL_UPGRADE_COST } from "../../game/vassal.ts";
import { nationDisplayColor, overlordOf, vassalTypeOf } from "../../game/access.ts";
import { REQUEST_COOLDOWN_DAYS, requestCooldownDays } from "../../game/requests.ts";
import { TRADE_AGREEMENT_DAYS, tradePartners, tradeResourceKinds } from "../../game/trade.ts";
import type { DiplomaticAction, DiplomaticActionKind, DiplomaticRequest, DiplomaticRequestKind } from "../../game/types/diplomacy.ts";
import type { GameState } from "../../game/types/state.ts";
import { escapeGameText, game, html, iconMaskStyle, rawHtml, setGameHtml } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { decisionTooltipAttrs } from "../decision-tip.ts";
import { panelHead, PanelShell } from "../panel.ts";
import type { PanelView } from "../panel.ts";
import { nationOverviewBody, nationStats } from "../nation-info.ts";
import { nationFlagHtmlFor } from "../flags.ts";
import { TRADE_KIND_LABEL, cadenceToken, proposalCooldownTip, resourceNames, transferList } from "../trade.ts";
import { gameHtml, scopedTexts } from "../view.ts";
import { t } from "../../i18n/index.ts";

function diplomacyTexts() {
    const s = scopedTexts("panels.diplomacy.", {
        title: ["title"],
        helpTitle: ["help.title"],
        helpBody: ["help.body"],
        nationFallback: ["nation.fallback"],
        nationTargetFallback: ["nation.targetFallback"],
        enemyFallback: ["enemy.fallback"],
        overlordFallback: ["overlord.fallback"],
        requestDemand: ["request.demand"],
        requestContract: ["request.contract"],
        requestAccept: ["request.accept"],
        requestReject: ["request.reject"],
        requestHead: ["request.head"],
        requestTooFrequent: ["request.tooFrequent"],
        tradeGive: ["trade.request.give"],
        tradeProvides: ["trade.provides"],
        tradeWeProvide: ["trade.weProvide"],
        statusLabel: ["status.label"],
        statusDead: ["status.dead"],
        statusAtWar: ["status.atWar"],
        statusTruce: ["status.truce"],
        statusAi: ["status.ai"],
        vassalGeneric: ["vassal.generic"],
        vassalHelpTitle: ["vassal.help.title"],
        vassalTributeLabel: ["vassal.tributeLabel"],
        vassalExpand: ["vassal.expand"],
        vassalCollapse: ["vassal.collapse"],
        vassalView: ["vassal.view"],
        vassalReleaseLabel: ["vassal.release.label"],
        vassalReleaseTip: ["vassal.release.tip"],
        vassalChangeTypeLabel: ["vassal.changeType.label"],
        vassalChangeTypeTip: ["vassal.changeType.tip"],
        vassalAnnexLabel: ["vassal.annex.label"],
        vassalAnnexTip: ["vassal.annex.tip"],
        vassalOfferLabel: ["vassal.offer.label"],
        vassalOfferButton: ["vassal.offer.button"],
        vassalOfferSubmit: ["vassal.offer.submit"],
        vassalOfferSubmitTip: ["vassal.offer.submitTip"],
        vassalOfferCooperativeNote: ["vassal.offer.cooperativeNote"],
        vassalOfferAutonomousNote: ["vassal.offer.autonomousNote"],
        vassalDemandLabel: ["vassal.demand.label"],
        vassalTypeCooperative: ["vassal.type.cooperative"],
        vassalTypeAutonomous: ["vassal.type.autonomous"],
        allianceLabel: ["alliance.label"],
        allianceNone: ["alliance.none"],
        allianceHelpTitle: ["alliance.help.title"],
        allianceLeave: ["alliance.leave"],
        allianceAllyNote: ["alliance.allyNote"],
        allianceSection: ["alliance.section"],
        allianceInviteLabel: ["alliance.invite.label"],
        allianceJoinLabel: ["alliance.join.label"],
        allianceLeaderFallback: ["alliance.leaderFallback"],
        allianceCreateLabel: ["alliance.create.label"],
        overviewTargets: ["overview.targets"],
        overviewEnded: ["overview.ended"],
        overviewNoTarget: ["overview.noTarget"],
        stateUnspecified: ["state.unspecified"],
        stateInvalid: ["state.invalid"],
        projectAnnex: ["project.annex"],
        projectExpired: ["project.expired"],
        projectTipExpired: ["project.tip.expired"],
        projectTipPreparing: ["project.tip.preparing"],
        projectTipReady: ["project.tip.ready"],
        projectCancelHint: ["project.cancelHint"],
        aidLabel: ["aid.label"],
        declareLabel: ["declare.label"],
        declareTargetFallback: ["declare.targetFallback"],
        declareTipReady: ["declare.tip.ready"],
        declareClose: ["declare.close"],
        declareHint: ["declare.hint"],
        declareConfirm: ["declare.confirm"],
        craftStart: ["craft.start"],
        craftStop: ["craft.stop"],
        craftTipStart: ["craft.tip.start"],
        craftTipStop: ["craft.tip.stop"],
        craftTipAtWar: ["craft.tip.atWar"],
        craftAnnex: ["craft.annex"],
        craftConquest: ["craft.conquest"],
        craftBlockWar: ["craft.block.war"],
        craftBlockEnded: ["craft.block.ended"],
        craftBlockBusy: ["craft.block.busy"],
        goalAnnex: ["goal.annex"],
        goalOurs: ["goal.ours"],
        goalTheirs: ["goal.theirs"],
        goalRequirementAnnex: ["goal.requirement.annex"],
        goalRequirementConquest: ["goal.requirement.conquest"],
        goalEnforceNote: ["goal.enforceNote"],
        goalTitle: ["goal.title"],
        goalEnforceLabel: ["goal.enforce.label"],
        goalEnforceTip: ["goal.enforce.tip"],
        goalEnforceButton: ["goal.enforce.button"],
        goalVassalizeLabel: ["goal.vassalize.label"],
        goalVassalizeTip: ["goal.vassalize.tip"],
        actionsHead: ["actions.head"],
        peaceAcceptLabel: ["peace.accept.label"],
        peaceAcceptTip: ["peace.accept.tip"],
        peaceRejectLabel: ["peace.reject.label"],
        peaceRejectTip: ["peace.reject.tip"],
        peaceRejectButton: ["peace.reject.button"],
        peaceProposeLabel: ["peace.propose.label"],
        peaceProposeDisabledTip: ["peace.propose.disabledTip"],
        refundClear: ["refund.clear"],
        refundAbandon: ["refund.abandon"],
        menuClose: ["menu.close"],
        menuConfirm: ["menu.confirm"],
        menuCancel: ["menu.cancel"],
        menuNote: ["menu.note"],
        menuSectionCurrent: ["menu.section.current"],
        menuSectionNew: ["menu.section.new"],
        menuEmptyCurrent: ["menu.empty.current"],
        menuEmptyClaims: ["menu.empty.claims"],
        toastCrafted: ["toast.crafted"],
        toastNone: ["toast.none"],
        toastSeparator: ["toast.separator"],
        upgradeLabel: ["upgrade.label"],
    });
    return {
        ...s,
        craftConquest: (name: string) => t("panels.diplomacy.craft.conquest", { name }),
        craftAnnex: (name: string) => t("panels.diplomacy.craft.annex", { name }),
        requestTitleDemand: (from: string) => t("panels.diplomacy.request.title.demand", { from }),
        requestTitleOffer: (from: string) => t("panels.diplomacy.request.title.offer", { from }),
        requestTitleAlliance: (from: string) => t("panels.diplomacy.request.title.alliance", { from }),
        requestTitleUpgrade: (from: string) => t("panels.diplomacy.request.title.upgrade", { from }),
        requestTitleCall: (from: string) => t("panels.diplomacy.request.title.call", { from }),
        requestTitleAid: (from: string) => t("panels.diplomacy.request.title.aid", { from }),
        requestTitleTrade: (from: string, kind: string) => t("panels.diplomacy.request.title.trade", { from, kind }),
        requestDetailVassal: (demand: string, profile: string, blurb: string) =>
            t("panels.diplomacy.request.detail.vassal", { demand, profile, blurb }),
        requestDetailAlliance: (leader: string, count: number) =>
            t("panels.diplomacy.request.detail.alliance", { leader, count }),
        requestDetailUpgrade: (profile: string, blurb: string, cost: number) =>
            t("panels.diplomacy.request.detail.upgrade", { profile, blurb, cost }),
        requestDetailCall: (enemy: string) => t("panels.diplomacy.request.detail.call", { enemy }),
        requestDetailAid: (overlordNote: string, contract: string) =>
            t("panels.diplomacy.request.detail.aid", { overlordNote, contract }),
        requestDetailTrade: (kind: string) => t("panels.diplomacy.request.detail.trade", { kind }),
        tradeNote: (cadence: string, days: number) => t("panels.diplomacy.trade.request.note", { cadence, days }),
        statusWarAll: (name: string, enemies: string) => t("panels.diplomacy.status.war.all", { name, enemies }),
        statusWarOne: (name: string, enemy: string) => t("panels.diplomacy.status.war.one", { name, enemy }),
        statusTrade: (name: string, partner: string, count: number, kinds: string) =>
            t("panels.diplomacy.status.trade", { name, partner, count, kinds }),
        statusVassalOf: (name: string, lord: string, type: string) =>
            t("panels.diplomacy.status.vassal.of", { name, lord, type }),
        statusAtWarDays: (days: number) => t("panels.diplomacy.status.atWarDays", { days }),
        statusTruceDays: (days: number) => t("panels.diplomacy.status.truceDays", { days }),
        vassalContract: (name: string) => t("panels.diplomacy.vassal.contract", { name }),
        aidOverlord: (name: string) => t("panels.diplomacy.aid.overlord", { name }),
        aidTip: (nation: string, overlord: string, days: number) =>
            t("panels.diplomacy.aid.tip", { nation, overlord, days }),
        vassalVassalOf: (name: string) => t("panels.diplomacy.vassal.vassalOf", { name }),
        vassalOwned: (count: number) => t("panels.diplomacy.vassal.owned", { count }),
        vassalViewTip: (name: string) => t("panels.diplomacy.vassal.viewTip", { name }),
        vassalOfferTip: (name: string) => t("panels.diplomacy.vassal.offer.tip", { name }),
        vassalDemandTip: (name: string) => t("panels.diplomacy.vassal.demand.tip", { name }),
        upgradeConfirmBody: (lord: string, profile: string, cost: number) =>
            t("panels.diplomacy.upgrade.confirmBody", { lord, profile, cost }),
        upgradeRequirement: (cost: number, profile: string) =>
            t("panels.diplomacy.upgrade.requirement", { cost, profile }),
        allianceMemberCount: (count: number) => t("panels.diplomacy.alliance.memberCount", { count }),
        allianceSummary: (leader: string, members: string) => t("panels.diplomacy.alliance.summary", { leader, members }),
        allianceLeaveTip: (days: number) => t("panels.diplomacy.alliance.leave.tip", { days }),
        allianceCreateNote: (cost: number) => t("panels.diplomacy.alliance.create.note", { cost }),
        allianceCreateTip: (cost: number) => t("panels.diplomacy.alliance.create.tip", { cost }),
        allianceInviteTip: (name: string) => t("panels.diplomacy.alliance.invite.tip", { name }),
        allianceJoinTip: (leader: string, days: number) => t("panels.diplomacy.alliance.join.tip", { leader, days }),
        nationSwatchLabel: (name: string, status: string) =>
            t("panels.diplomacy.nation.swatchLabel", { name, status }),
        nationTip: (status: string, tendency: string, armies: number, states: number, provinces: number) =>
            t("panels.diplomacy.nation.tip", { status, tendency, armies, states, provinces }),
        overviewAnnexed: (count: number, total: number) => t("panels.diplomacy.overview.annexed", { count, total }),
        overviewWars: (count: number) => t("panels.diplomacy.overview.wars", { count }),
        overviewReady: (count: number) => t("panels.diplomacy.overview.ready", { count }),
        actionFullLabel: (label: string, scope: string) => t("panels.diplomacy.action.fullLabel", { label, scope }),
        projectConquest: (name: string) => t("panels.diplomacy.project.conquest", { name }),
        projectTip: (label: string, status: string, cancelHint: string) =>
            t("panels.diplomacy.project.tip", { label, status, cancelHint }),
        timeRemaining: (days: number) => t("panels.diplomacy.time.remaining", { days }),
        timeReadyRemaining: (days: number) => t("panels.diplomacy.time.readyRemaining", { days }),
        timePreparingRemaining: (days: number) => t("panels.diplomacy.time.preparingRemaining", { days }),
        declareTipTruce: (days: number) => t("panels.diplomacy.declare.tip.truce", { days }),
        declareTipNone: (count: number) => t("panels.diplomacy.declare.tip.none", { count }),
        declareAriaLabel: (name: string) => t("panels.diplomacy.declare.ariaLabel", { name }),
        declareValid: (days: number) => t("panels.diplomacy.declare.valid", { days }),
        declareTitle: (name: string) => t("panels.diplomacy.declare.title", { name }),
        craftCost: (cost: number, days: number, upkeep: number) =>
            t("panels.diplomacy.craft.cost", { cost, days, upkeep }),
        craftCostAnnex: (cost: number, days: number, upkeep: number) =>
            t("panels.diplomacy.craft.costAnnex", { cost, days, upkeep }),
        goalConquest: (name: string) => t("panels.diplomacy.goal.conquest", { name }),
        goalSummary: (side: string, goal: string, held: number, total: number, enforceNote: string) =>
            t("panels.diplomacy.goal.summary", { side, goal, held, total, enforceNote }),
        peaceProposeWhite: (name: string) => t("panels.diplomacy.peace.propose.white", { name }),
        actionsDialogLabel: (name: string) => t("panels.diplomacy.actions.dialogLabel", { name }),
        menuDelta: (sign: string, amount: number) => t("panels.diplomacy.menu.delta", { sign, amount }),
        refundCancel: (refund: number, spent: number) => t("panels.diplomacy.refund.cancel", { refund, spent }),
        toastCancelled: (count: number) => t("panels.diplomacy.toast.cancelled", { count }),
    };
}
type DiplomacyTexts = ReturnType<typeof diplomacyTexts>;

/** Pending-request copy: one row per kind, so a new request never means a new branch. */
const REQUEST_TITLE: Record<DiplomaticRequestKind, (from: string, request: DiplomaticRequest, text: DiplomacyTexts) => string> = {
    vassalize: (from, request, text) => request.demand ? text.requestTitleDemand(from) : text.requestTitleOffer(from),
    alliance: (from, _request, text) => text.requestTitleAlliance(from),
    upgrade: (from, _request, text) => text.requestTitleUpgrade(from),
    call: (from, _request, text) => text.requestTitleCall(from),
    aid: (from, _request, text) => text.requestTitleAid(from),
    trade: (from, request, text) => text.requestTitleTrade(from, TRADE_KIND_LABEL[request.tradeKind ?? "exchange"]),
};

const REQUEST_DETAIL: Record<DiplomaticRequestKind, (state: GameState, request: DiplomaticRequest, text: DiplomacyTexts) => string> = {
    vassalize: (_state, request, text) => {
        const profile = VASSAL_PROFILES[request.vassalType ?? "autonomous"];
        const demand = request.demand ? text.requestDemand : text.requestContract;
        return text.requestDetailVassal(demand, profile.name, profile.blurb);
    },
    alliance: (state, request, text) => {
        const alliance = state.alliances.find((entry) => entry.id === request.allianceId);
        const leader = alliance
            ? state.nations[alliance.leader]?.name ?? "?"
            : state.nations[request.from]?.name ?? "?";
        return text.requestDetailAlliance(leader, alliance?.members.length ?? 0);
    },
    upgrade: (_state, request, text) => {
        const profile = VASSAL_PROFILES[request.vassalType ?? "cooperative"];
        return text.requestDetailUpgrade(profile.name, profile.blurb, VASSAL_UPGRADE_COST);
    },
    call: (state, request, text) => {
        const enemy = typeof request.enemy === "number" ? state.nations[request.enemy]?.name ?? text.enemyFallback : text.enemyFallback;
        return text.requestDetailCall(enemy);
    },
    aid: (state, request, text) => {
        const overlord = overlordOf(state, request.from);
        const type = vassalTypeOf(state, request.from);
        const contract = type ? text.vassalContract(VASSAL_PROFILES[type].name) : text.vassalGeneric;
        const overlordNote = overlord >= 0 ? text.aidOverlord(state.nations[overlord].name) : "";
        return text.requestDetailAid(overlordNote, contract);
    },
    trade: (_state, request, text) => text.requestDetailTrade(TRADE_KIND_LABEL[request.tradeKind ?? "exchange"]),
};

function requestTitle(state: GameState, request: DiplomaticRequest, text: DiplomacyTexts): string {
    const from = state.nations[request.from]?.name ?? text.nationFallback;
    return REQUEST_TITLE[request.kind](from, request, text);
}

function requestDetail(state: GameState, request: DiplomaticRequest, text: DiplomacyTexts): string {
    return REQUEST_DETAIL[request.kind](state, request, text);
}

/** Trade requests carry structured transfers; render them as coloured resource rows. */
function tradeRequestDetailHtml(request: DiplomaticRequest, text: DiplomacyTexts): string {
    const give = request.tradeGive ?? [];
    const receive = request.tradeReceive ?? [];
    const giveLabel = text.tradeGive;
    const providesLabel = text.tradeProvides;
    const weProvideLabel = text.tradeWeProvide;
    const note = text.tradeNote(cadenceToken("monthly"), TRADE_AGREEMENT_DAYS);
    const lines: string[] = [];
    if (request.tradeKind === "aid") {
        lines.push(html`<div class="trade-request-line"><span class="trade-side-label">${giveLabel}</span>${rawHtml(transferList(receive, "out"))}</div>`);
    } else {
        if (give.length) lines.push(html`<div class="trade-request-line"><span class="trade-side-label">${providesLabel}</span>${rawHtml(transferList(give, "in"))}</div>`);
        if (receive.length) lines.push(html`<div class="trade-request-line"><span class="trade-side-label">${weProvideLabel}</span>${rawHtml(transferList(receive, "out"))}</div>`);
    }
    lines.push(html`<p class="trade-request-note">${note}</p>`);
    return lines.join("");
}

/** Compact war / trade / vassal relationship strip between nation stats and 外交行动. */
function statusBarHtml(state: GameState, nationId: number, text: DiplomacyTexts): string {
    const nation = state.nations[nationId];
    if (!nation) return "";
    const enemies = state.nations.filter((other) => other.id !== nationId && isAtWar(state, nationId, other.id));
    const partners = tradePartners(state, nationId);
    const listSep = t("common.listSeparator");
    const label = text.statusLabel;
    const rows: string[] = [];
    if (enemies.length) {
        const allTip = text.statusWarAll(nation.name, enemies.map((enemy) => enemy.name).join(listSep));
        const self = html`<span class="diplo-status-flag" ${rawHtml(tooltipAttrs(escapeGameText(nation.name), escapeGameText(allTip)))}>${rawHtml(nationFlagHtmlFor(state, nationId, 18))}</span>`;
        const flags = enemies.map((enemy) => {
            const oneTip = text.statusWarOne(nation.name, enemy.name);
            return html`<span class="diplo-status-flag" ${rawHtml(tooltipAttrs(escapeGameText(enemy.name), escapeGameText(oneTip)))}>${rawHtml(nationFlagHtmlFor(state, enemy.id, 18))}</span>`;
        }).join("");
        rows.push(html`<div class="diplo-status-row"><span class="icon-glyph diplo-status-icon diplo-status-icon--war" aria-hidden="true" ${rawHtml(iconMaskStyle("war"))}></span><span class="diplo-status-items">${rawHtml(self)}${rawHtml(flags)}</span></div>`);
    }
    if (partners.length) {
        const flags = partners.map((partnerId) => {
            const partner = state.nations[partnerId];
            if (!partner) return "";
            const kinds = tradeResourceKinds(state, nationId, partnerId);
            const body = text.statusTrade(nation.name, partner.name, kinds.length, resourceNames(kinds));
            return html`<span class="diplo-status-flag" ${rawHtml(tooltipAttrs(escapeGameText(partner.name), escapeGameText(body)))}>${rawHtml(nationFlagHtmlFor(state, partnerId, 18))}</span>`;
        }).join("");
        rows.push(html`<div class="diplo-status-row"><span class="icon-glyph diplo-status-icon diplo-status-icon--trade" aria-hidden="true" ${rawHtml(iconMaskStyle("trade"))}></span><span class="diplo-status-items">${rawHtml(flags)}</span></div>`);
    }
    return rows.length ? html`<div class="diplo-status" aria-label="${label}">${rawHtml(rows.join(""))}</div>` : "";
}

function requestsHtml(state: GameState, text: DiplomacyTexts): string {
    const requests = state.diplomaticRequests.filter((request) => request.to === 0 && request.expiresDay > state.day);
    if (!requests.length) return "";
    const headLabel = text.requestHead;
    const acceptLabel = text.requestAccept;
    const rejectLabel = text.requestReject;
    const rows = requests.map((request) => {
        const from = state.nations[request.from];
        if (!from) return "";
        const title = requestTitle(state, request, text);
        const remaining = text.timeRemaining(Math.max(0, request.expiresDay - state.day));
        const detail = request.kind === "trade" ? tradeRequestDetailHtml(request, text) : html`${requestDetail(state, request, text)}`;
        const disabled = state.winner === null ? "" : " disabled";
        return html`<div class="diplo-request" data-request-id="${request.id}">
            <div class="diplo-request-head">${rawHtml(nationFlagHtmlFor(state, request.from, 20))}<b>${title}</b>
                <span class="diplo-request-days">${remaining}</span></div>
            <div class="diplo-request-body">${rawHtml(detail)}</div>
            <div class="diplo-request-actions">
                <button class="btn btn-primary" data-action="respond-request" data-request="${request.id}" data-accept="1" ${rawHtml(disabled)}>${acceptLabel}</button>
                <button class="btn btn-outline" data-action="respond-request" data-request="${request.id}" data-accept="0" ${rawHtml(disabled)}>${rejectLabel}</button>
            </div>
        </div>`;
    }).join("");
    return html`<div class="diplo-requests"><div class="diplo-requests-head">${headLabel}</div>${rawHtml(rows)}</div>`;
}

function readyActions(state: GameState, nationId: number): DiplomaticAction[] {
    return state.diplomaticActions.filter((action) => action.nation === 0 && action.target === nationId
        && state.day >= action.readyDay && state.day < action.expiresDay
        && canDeclareWar(state, 0, nationId, action.id));
}

function stateName(state: GameState, stateId: number | null, text: DiplomacyTexts): string {
    return stateId === null ? text.stateUnspecified : state.states[stateId]?.name ?? text.stateInvalid;
}

function actionLabel(state: GameState, action: DiplomaticAction, text: DiplomacyTexts): string {
    const scope = action.kind === "annex"
        ? state.nations[action.target]?.name ?? text.nationTargetFallback
        : stateName(state, action.stateId, text);
    return text.actionFullLabel(DIPLOMATIC_PROFILES[action.kind].label, scope);
}

function projectsHtml(state: GameState, nationId: number, text: DiplomacyTexts): string {
    const projects = state.diplomaticActions.filter((action) => action.nation === 0 && action.target === nationId);
    if (!projects.length) return "";
    const cancelHint = text.projectCancelHint;
    const chips = projects.map((action) => {
        const preparing = state.day < action.readyDay;
        const expired = state.day >= action.expiresDay;
        const ready = !preparing && !expired;
        const short = action.kind === "annex" ? text.projectAnnex : text.projectConquest(stateName(state, action.stateId, text));
        const time = expired ? text.projectExpired
            : preparing ? text.timeRemaining(action.readyDay - state.day)
                : text.timeReadyRemaining(action.expiresDay - state.day);
        const status = expired ? text.projectTipExpired
            : preparing ? text.projectTipPreparing : text.projectTipReady;
        const tip = text.projectTip(actionLabel(state, action, text), status, cancelHint);
        return html`<span class="diplo-project-chip${ready ? " ready" : ""}${expired ? " expired" : ""}" ${rawHtml(tooltipAttrs(escapeGameText(short), tip))}>${short} · ${time}</span>`;
    }).join("");
    return html`<div class="diplo-projects">${rawHtml(chips)}</div>`;
}

/** Cooldown wins over the normal tooltip; the button stays visible but inert. */
function requestGate(
    state: GameState, kind: DiplomaticRequestKind, nationId: number, normalTip: string, text: DiplomacyTexts,
): { readonly blocked: boolean; readonly attrs: string; readonly tip: string } {
    const days = requestCooldownDays(state, kind, nationId);
    return days > 0
        ? {
            blocked: true,
            attrs: 'aria-disabled="true"',
            tip: tooltipAttrs(text.requestTooFrequent, proposalCooldownTip(days)),
        }
        : { blocked: false, attrs: "", tip: normalTip };
}

/** Preview authorization as if the marked cancellations (and their refunds) had already been applied. */
function craftAllowed(
    state: GameState, cancels: ReadonlySet<number>, kind: DiplomaticActionKind, target: number, stateId: number | null,
): boolean {
    const refund = state.diplomaticActions.reduce(
        (sum, action) => sum + (cancels.has(action.id) ? cancelRefund(state, action) : 0), 0);
    const nations = state.nations.slice();
    nations[0] = { ...nations[0], politicalPower: nations[0].politicalPower + refund };
    const preview = {
        ...state,
        nations,
        diplomaticActions: state.diplomaticActions.filter((action) => !cancels.has(action.id)),
    };
    return canPrepareDiplomaticAction(preview, 0, kind, target, stateId);
}

/** Alliance actions rendered inline with the other diplomatic actions. */
function allianceActionsHtml(state: GameState, nationId: number, text: DiplomacyTexts): string {
    if (state.winner !== null) return "";
    const myAlliance = allianceOf(state, 0);
    const targetAlliance = allianceOf(state, nationId);
    const buttons: string[] = [];
    if (!myAlliance) {
        if (canCreateAlliance(state, 0)) {
            const label = text.allianceCreateLabel;
            buttons.push(html`<button class="btn btn-outline" data-action="create-alliance" ${rawHtml(tooltipAttrs(label, text.allianceCreateTip(ALLIANCE_CREATE_COST)))}>${label}</button>`);
        }
        if (targetAlliance && overlordOf(state, 0) < 0) {
            const leader = state.nations[targetAlliance.leader];
            const joinTip = decisionTooltipAttrs(
                text.allianceJoinTip(escapeGameText(leader?.name ?? text.allianceLeaderFallback), REQUEST_COOLDOWN_DAYS),
                [{ decision: decideJoinRequest(state, targetAlliance.leader, 0) }],
            );
            const gate = requestGate(state, "alliance", targetAlliance.leader, joinTip, text);
            const joinLabel = text.allianceJoinLabel;
            buttons.push(html`<button class="btn btn-outline${gate.blocked ? " cooldown" : ""}" data-action="join-alliance" data-leader="${targetAlliance.leader}" ${rawHtml(gate.attrs)} ${rawHtml(gate.tip)}>${joinLabel}</button>`);
        }
    } else {
        if (myAlliance.leader === 0 && canInviteToAlliance(state, 0, nationId)) {
            const inviteTip = decisionTooltipAttrs(
                text.allianceInviteTip(escapeGameText(state.nations[nationId].name)),
                [{ decision: decideAllianceInvite(state, 0, nationId) }],
            );
            const gate = requestGate(state, "alliance", nationId, inviteTip, text);
            const inviteLabel = text.allianceInviteLabel;
            buttons.push(html`<button class="btn btn-outline${gate.blocked ? " cooldown" : ""}" data-action="invite-alliance" data-nation="${nationId}" ${rawHtml(gate.attrs)} ${rawHtml(gate.tip)}>${inviteLabel}</button>`);
        }
        const leaveLabel = text.allianceLeave;
        buttons.push(html`<button class="btn btn-outline" data-action="leave-alliance" ${rawHtml(tooltipAttrs(leaveLabel, text.allianceLeaveTip(REQUEST_COOLDOWN_DAYS)))}>${leaveLabel}</button>`);
    }
    return buttons.join("");
}

function nationHtml(state: GameState, nationId: number, text: DiplomacyTexts): string {
    const nation = state.nations[nationId];
    const atWar = isAtWar(state, 0, nationId);
    const hasOffer = state.peaceOffers.includes(nationId);
    const truce = truceDays(state, 0, nationId);
    const status = !nation.alive ? text.statusDead
        : atWar ? text.statusAtWarDays(warDuration(state, 0, nationId))
            : truce > 0 ? text.statusTruceDays(truce) : text.statusAi;
    const summary = nationStats(state, nationId);
    const pillClass = !nation.alive ? "dead" : atWar ? "war" : "idle";
    const head = html`<div class="diplo-head">${rawHtml(nationFlagHtmlFor(state, nation.id, 26))}<span class="diplo-name">${nation.name}</span><span class="status-pill ${pillClass}">${status}</span></div>`;
    const stats = nationOverviewBody(state, summary, " diplo-kv");
    const base = html`${rawHtml(head)}${rawHtml(stats)}<div class="diplo-divider"></div>`;
    if (!nation.alive) {
        return html`<div class="diplo-row dead diplo-card" data-diplo-card="${nationId}" tabindex="-1">${rawHtml(base)}${rawHtml(projectsHtml(state, nationId, text))}</div>`;
    }

    const ready = readyActions(state, nationId);
    const claimCount = state.claims.filter((claim) => claim.nation === 0 &&
        state.states[claim.stateId]?.provinces.some((site) => state.provinces[site].legalOwner === nationId)).length;
    const declareTip = ready.length ? text.declareTipReady
        : truce > 0 ? text.declareTipTruce(truce) : text.declareTipNone(claimCount);
    const declareLabel = text.declareLabel;
    const declareBtn = html`<button class="btn btn-primary" data-action="declare-open" data-nation="${nationId}" data-diplo-focus="declare-${nationId}" ${rawHtml(ready.length && state.winner === null ? "" : " disabled")} ${rawHtml(tooltipAttrs(declareLabel, declareTip))}>${declareLabel}</button>`;

    const preparing = state.diplomaticActions.some((action) => action.nation === 0 && action.target === nationId && state.day < action.readyDay);
    const craftLabel = preparing ? text.craftStop : text.craftStart;
    const craftTip = preparing ? text.craftTipStop : text.craftTipStart;
    const craftBtn = html`<button class="btn btn-outline" data-action="diplo-menu-open" data-nation="${nationId}" data-diplo-focus="menu-${nationId}" ${rawHtml(atWar || state.winner !== null ? " disabled" : "")} ${rawHtml(tooltipAttrs(craftLabel, atWar ? text.craftTipAtWar : craftTip))}>${craftLabel}</button>`;

    let goalHtml = "";
    const actionButtons: string[] = [craftBtn];
    if (atWar) {
        const war = state.wars.find((item) => (item.aggressor === 0 && item.defender === nationId) || (item.aggressor === nationId && item.defender === 0));
        if (war) {
            const progress = warGoalProgress(state, war);
            const ours = war.aggressor === 0;
            const goal = war.goal === "annex" ? text.goalAnnex : text.goalConquest(stateName(state, war.stateId, text));
            const requirement = war.goal === "annex" ? text.goalRequirementAnnex : text.goalRequirementConquest;
            const summary = text.goalSummary(
                ours ? text.goalOurs : text.goalTheirs, goal, progress.held, progress.total,
                progress.canEnforce ? text.goalEnforceNote : "",
            );
            goalHtml = html`<div class="diplo-goal" ${rawHtml(tooltipAttrs(text.goalTitle, escapeGameText(requirement)))}>${summary}</div>`;
            if (ours) actionButtons.push(html`<button class="btn btn-outline" data-action="enforce-war-goal" data-nation="${nationId}" data-diplo-focus="enforce-${nationId}" ${rawHtml(progress.canEnforce && state.winner === null ? "" : " disabled")} ${rawHtml(tooltipAttrs(text.goalEnforceLabel, text.goalEnforceTip))}>${text.goalEnforceButton}</button>`);
        }
        const peaceEnabled = state.winner === null ? "" : " disabled";
        actionButtons.push(hasOffer
            ? html`<button class="btn btn-outline" data-action="accept-peace" data-nation="${nationId}" data-diplo-focus="accept-${nationId}" ${rawHtml(peaceEnabled)} ${rawHtml(tooltipAttrs(text.peaceAcceptLabel, text.peaceAcceptTip))}>${text.peaceAcceptLabel}</button><button class="btn btn-outline" data-action="reject-peace" data-nation="${nationId}" data-diplo-focus="reject-${nationId}" ${rawHtml(peaceEnabled)} ${rawHtml(tooltipAttrs(text.peaceRejectLabel, text.peaceRejectTip))}>${text.peaceRejectButton}</button>`
            : html`<button class="btn btn-outline" data-action="propose-peace" data-nation="${nationId}" data-diplo-focus="peace-${nationId}" ${rawHtml(peaceEnabled)} ${rawHtml(decisionTooltipAttrs(text.peaceProposeWhite(escapeGameText(nation.name)), [{ decision: decidePeace(state, nationId, 0) }]))}>${text.peaceProposeLabel}</button>`);
    } else {
        actionButtons.push(html`<button class="btn btn-outline" data-action="propose-peace" data-nation="${nationId}" data-diplo-focus="peace-${nationId}" disabled ${rawHtml(tooltipAttrs(text.peaceProposeLabel, text.peaceProposeDisabledTip))}>${text.peaceProposeLabel}</button>`);
        actionButtons.push(declareBtn);
    }

    actionButtons.push(allianceActionsHtml(state, nationId, text));
    return html`<div class="diplo-row diplo-card${hasOffer ? " offer" : ""}" data-diplo-card="${nationId}" tabindex="-1">
        ${rawHtml(base)}
        ${rawHtml(statusBarHtml(state, nationId, text))}
        <div class="diplo-actions-head">${text.actionsHead}</div>
        <div class="diplo-button-row">${rawHtml(actionButtons.join(""))}</div>
        ${rawHtml(goalHtml)}${rawHtml(projectsHtml(state, nationId, text))}
    </div>`;
}

function relationsHtml(state: GameState, target: number | null, text: DiplomacyTexts): string {
    const others = state.nations.filter((nation) => !nation.isPlayer);
    const conquered = others.filter((nation) => !nation.alive).length;
    const wars = others.filter((nation) => nation.alive && isAtWar(state, 0, nation.id)).length;
    const ready = state.diplomaticActions.filter((action) => action.nation === 0
        && state.day >= action.readyDay && state.day < action.expiresDay
        && canDeclareWar(state, 0, action.target, action.id)).length;
    const annexed = text.overviewAnnexed(conquered, others.length);
    const warsText = text.overviewWars(wars);
    const readyText = text.overviewReady(ready);
    const tabs = others.map((nation) => {
        const selected = target === nation.id;
        const war = nation.alive && isAtWar(state, 0, nation.id);
        const truce = nation.alive && !war && truceDays(state, 0, nation.id) > 0;
        const status = !nation.alive ? text.statusDead
            : war ? text.statusAtWar : truce ? text.statusTruce : text.statusAi;
        const controlledStates = state.states.filter((region) =>
            region.provinces.some((site) => state.provinces[site].owner === nation.id)).length;
        const tip = text.nationTip(
            status, tendencyProfileOf(nation.tendency).name,
            nationArmyCount(state, nation.id), controlledStates, nationProvinceCount(state, nation.id),
        );
        const label = text.nationSwatchLabel(nation.name, status);
        const color = nationDisplayColor(state, nation.id);
        return html`<button class="diplo-swatch${selected ? " selected" : ""}${nation.alive ? "" : " dead"}${war ? " war" : ""}${truce ? " truce" : ""}" role="tab" aria-selected="${selected}"
            aria-label="${label}" style="--pc:${color}"
            data-action="diplo-target" data-nation="${nation.id}" data-diplo-focus="nation-${nation.id}"
            ${rawHtml(tooltipAttrs(escapeGameText(nation.name), tip))}>${rawHtml(nationFlagHtmlFor(state, nation.id, 22))}</button>`;
    }).join("");
    return html`
        <div class="diplo-overview-stats">
            <span class="status-pill ready">${annexed}</span>
            <span class="status-pill ${wars ? "war" : "idle"}">${warsText}</span>
            <span class="status-pill ${ready ? "ready" : "idle"}">${readyText}</span>
        </div>
        ${rawHtml(requestsHtml(state, text))}
        <div class="diplo-swatches" role="tablist" aria-label="${text.overviewTargets}">${rawHtml(tabs)}</div>
        ${rawHtml(state.winner !== null ? html`<p class="diplo-requirement">${text.overviewEnded}</p>` : "")}
        ${rawHtml(target !== null ? nationHtml(state, target, text) : html`<p class="diplo-note">${text.overviewNoTarget}</p>`)}
    `;
}

export interface DiplomacyViewContext {
    readonly state: GameState;
    readonly target: number | null;
}

/** Pure view builder: the static diplomacy panel body, head and focus contract. */
export function diplomacyView(ctx: DiplomacyViewContext): PanelView {
    const { state, target } = ctx;
    const text = diplomacyTexts();
    const player = state.nations[0];
    const status = gameHtml(game`[[politics:${Math.floor(player.politicalPower)}]]`);
    return {
        head: panelHead({
            title: text.title,
            help: { title: text.helpTitle, body: text.helpBody },
            helpAttrs: 'data-diplo-focus="objective"',
            status,
        }),
        bodyClass: "diplo-body",
        focusAttr: "data-diplo-focus",
        body: html`${rawHtml(relationsHtml(state, target, text))}`,
    };
}

export interface DiplomacyHooks {
    toast(message: string): void;
    sound: SoundManager;
}

interface CraftPick {
    kind: DiplomaticActionKind;
    stateId: number | null;
}

/** Compact diplomacy: color-swatch nation tabs, one nation card, declare popover and a centered CB menu. */
export class DiplomacyPanel {
    private readonly engine: GameEngine;
    private readonly hooks: DiplomacyHooks;
    private readonly shell = new PanelShell(document.querySelector<HTMLElement>("#diplomacy-panel") as HTMLElement);
    private readonly el = this.shell.el;
    private readonly hud = this.el.closest<HTMLElement>("#hud") as HTMLElement;
    private scrollTop = 0;
    private target: number | null = null;
    private viewSignature = "";
    private declarePop: HTMLElement | null = null;
    private declareNation: number | null = null;
    private declarePick: number | null = null;
    private scrollBody: HTMLElement | null = null;
    private menuEl: HTMLElement | null = null;
    private menuNation: number | null = null;
    private menuCancels = new Set<number>();
    private menuCraft: CraftPick | null = null;

    constructor(engine: GameEngine, hooks: DiplomacyHooks) {
        this.engine = engine;
        this.hooks = hooks;
        this.el.addEventListener("keydown", this.onPanelKeyDown);
        this.el.addEventListener("click", this.onPanelClick);
    }

    setTarget(nationId: number): void {
        const nation = this.engine.state.nations[nationId];
        if (!nation || nation.isPlayer) return;
        this.closeDeclare();
        this.closeActionMenu();
        this.target = nationId;
        this.render();
    }

    setHidden(hidden: boolean): void {
        const body = this.el.querySelector<HTMLElement>(".diplo-body");
        if (hidden && body && body.clientHeight > 0) this.scrollTop = body.scrollTop;
        if (hidden) {
            this.closeDeclare();
            this.closeActionMenu();
            this.shell.hide();
        } else {
            this.shell.show();
            if (body) body.scrollTop = this.scrollTop;
        }
    }

    destroy(): void {
        this.closeDeclare();
        this.closeActionMenu();
    }

    render(): void {
        const oldBody = this.el.querySelector<HTMLElement>(".diplo-body");
        if (oldBody && oldBody.clientHeight > 0) this.scrollTop = oldBody.scrollTop;
        const active = document.activeElement instanceof HTMLElement && this.el.contains(document.activeElement)
            ? document.activeElement : null;
        const focusKey = active?.dataset.diploFocus;
        const focusCard = active?.closest<HTMLElement>("[data-diplo-card]")?.dataset.diploCard;

        const state = this.engine.state;
        const others = state.nations.filter((nation) => !nation.isPlayer);
        if (this.target === null || !others.some((nation) => nation.id === this.target)) {
            this.target = others.find((nation) => nation.alive && isAtWar(state, 0, nation.id))?.id
                ?? others.find((nation) => nation.alive)?.id ?? others[0]?.id ?? null;
        }

        const signature = `${this.target}:${this.target !== null && isAtWar(state, 0, this.target)}`;
        if (signature !== this.viewSignature) {
            this.scrollTop = 0;
            if (oldBody) oldBody.scrollTop = 0;
        }
        this.viewSignature = signature;

        this.shell.render(diplomacyView({
            state,
            target: this.target,
        }));

        // renderPanel restores data-diplo-focus; the old card fallback is still needed.
        if (active && focusCard !== undefined) {
            const restored = focusKey !== undefined && document.activeElement instanceof HTMLElement
                && document.activeElement.getAttribute("data-diplo-focus") === focusKey;
            if (!restored) {
                [...this.el.querySelectorAll<HTMLElement>("[data-diplo-card]")]
                    .find((element) => element.dataset.diploCard === focusCard)
                    ?.focus({ preventScroll: true });
            }
        }
        this.syncDeclare();
        this.syncActionMenu();
    }

    private readonly onPanelKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const tab = (event.target as HTMLElement).closest<HTMLElement>("[data-action='diplo-target']");
        if (!tab || !this.el.contains(tab)) return;
        event.preventDefault();
        event.stopPropagation();
        this.setTarget(Number(tab.dataset.nation));
    };

    private readonly onPanelClick = (event: MouseEvent): void => {
        if (!this.el.contains(event.target as Node)) return;
    };

    /* ---- centered diplomatic-action menu ---- */

    openActionMenu(nationId: number): void {
        if (this.menuEl && this.menuNation === nationId) {
            this.closeActionMenu();
            return;
        }
        this.closeActionMenu();
        const nation = this.engine.state.nations[nationId];
        if (!nation || nation.isPlayer || !nation.alive) return;
        const text = diplomacyTexts();
        this.menuNation = nationId;
        this.menuCancels.clear();
        this.menuCraft = null;
        const scrim = document.createElement("div");
        scrim.className = "diplo-menu-scrim";
        const label = text.actionsDialogLabel(nation.name);
        setGameHtml(scrim, html`<div class="diplo-menu" role="dialog" aria-label="${label}" tabindex="-1"></div>`);
        this.hud.appendChild(scrim);
        this.menuEl = scrim;
        scrim.addEventListener("click", this.onMenuClick);
        scrim.addEventListener("change", this.onMenuChange);
        this.fillActionMenu();
        scrim.querySelector<HTMLElement>(".diplo-menu")?.focus({ preventScroll: true });
    }

    closeActionMenu(): boolean {
        if (!this.menuEl) return false;
        this.menuEl.removeEventListener("click", this.onMenuClick);
        this.menuEl.removeEventListener("change", this.onMenuChange);
        this.menuEl.remove();
        this.menuEl = null;
        this.menuNation = null;
        this.menuCancels.clear();
        this.menuCraft = null;
        return true;
    }

    private readonly onMenuClick = (event: Event): void => {
        const target = event.target as HTMLElement;
        if (target === this.menuEl || target.closest("[data-menu-close]")) {
            this.closeActionMenu();
            return;
        }
        if (target.closest("[data-menu-confirm]")) this.confirmActionMenu();
    };

    private readonly onMenuChange = (event: Event): void => {
        const input = event.target as HTMLInputElement;
        const role = input.dataset.role;
        if (role === "cancel") {
            const id = Number(input.dataset.id);
            if (input.checked) this.menuCancels.add(id);
            else this.menuCancels.delete(id);
        } else if (role === "craft") {
            const kind = input.dataset.kind as DiplomaticActionKind;
            const stateId = kind === "annex" ? null : Number(input.dataset.state);
            if (input.checked) this.menuCraft = { kind, stateId };
            else if (this.menuCraft?.kind === kind && this.menuCraft.stateId === stateId) this.menuCraft = null;
        } else return;
        const key = role === "cancel" ? `[data-role="cancel"][data-id="${input.dataset.id}"]`
            : `[data-role="craft"][data-kind="${input.dataset.kind}"]${input.dataset.state ? `[data-state="${input.dataset.state}"]` : ""}`;
        this.fillActionMenu();
        this.menuEl?.querySelector<HTMLInputElement>(key)?.focus({ preventScroll: true });
    };

    private fillActionMenu(): void {
        if (!this.menuEl || this.menuNation === null) return;
        const state = this.engine.state;
        const text = diplomacyTexts();
        const nationId = this.menuNation;
        const nation = state.nations[nationId];
        const card = this.menuEl.querySelector<HTMLElement>(".diplo-menu");
        if (!card) return;
        const atWar = isAtWar(state, 0, nationId);
        const projects = state.diplomaticActions.filter((action) => action.nation === 0 && action.target === nationId);
        for (const id of [...this.menuCancels]) if (!projects.some((action) => action.id === id)) this.menuCancels.delete(id);

        const projectRows = projects.map((action) => {
            const preparing = state.day < action.readyDay;
            const expired = state.day >= action.expiresDay;
            const refund = cancelRefund(state, action);
            const spent = action.upkeepSpent ?? 0;
            const time = expired ? text.projectExpired
                : preparing ? text.timePreparingRemaining(action.readyDay - state.day)
                    : text.timeReadyRemaining(action.expiresDay - state.day);
            const refundNote = expired ? text.refundClear
                : preparing ? text.refundCancel(refund, spent) : text.refundAbandon;
            const checked = this.menuCancels.has(action.id);
            const label = actionLabel(state, action, text);
            return html`<label class="diplo-menu-row">
                <input type="checkbox" data-role="cancel" data-id="${action.id}" ${rawHtml(checked ? "checked" : "")} ${rawHtml(state.winner !== null ? " disabled" : "")} />
                <span class="diplo-menu-main"><b>${label}</b><span>${time} · ${refundNote}</span></span>
            </label>`;
        }).join("");

        const claims = state.claims.filter((claim) => claim.nation === 0 &&
            state.states[claim.stateId]?.provinces.some((site) => state.provinces[site].legalOwner === nationId));
        const craftRows = claims.map((claim) => {
            const region = state.states[claim.stateId];
            const allowed = !atWar && craftAllowed(state, this.menuCancels, "conquest", nationId, region.id);
            const picked = this.menuCraft?.kind === "conquest" && this.menuCraft.stateId === region.id;
            const profile = DIPLOMATIC_PROFILES.conquest;
            const label = text.craftConquest(region.name);
            const cost = text.craftCost(profile.cost, profile.days, profile.upkeep);
            return html`<label class="diplo-menu-row">
                <input type="checkbox" data-role="craft" data-kind="conquest" data-state="${region.id}" ${rawHtml(picked ? "checked" : "")} ${rawHtml(allowed ? "" : " disabled")} />
                <span class="diplo-menu-main"><b>${label}</b><span>${cost}</span></span>
            </label>`;
        }).join("");
        const annexAllowed = !atWar && craftAllowed(state, this.menuCancels, "annex", nationId, null);
        const annexPicked = this.menuCraft?.kind === "annex";
        const annexProfile = DIPLOMATIC_PROFILES.annex;
        const annexLabel = text.craftAnnex(nation?.name ?? "?");
        const annexCost = text.craftCostAnnex(annexProfile.cost, annexProfile.days, annexProfile.upkeep);
        const annexRow = html`<label class="diplo-menu-row">
            <input type="checkbox" data-role="craft" data-kind="annex" ${rawHtml(annexPicked ? "checked" : "")} ${rawHtml(annexAllowed ? "" : " disabled")} />
            <span class="diplo-menu-main"><b>${annexLabel}</b><span>${annexCost}</span></span>
        </label>`;

        const craftBlockReason = atWar ? text.craftBlockWar
            : state.winner !== null ? text.craftBlockEnded
                : projects.some((action) => state.day < action.readyDay && !this.menuCancels.has(action.id))
                    ? text.craftBlockBusy : "";
        const delta = (this.menuCraft ? -DIPLOMATIC_PROFILES[this.menuCraft.kind].cost : 0)
            + [...this.menuCancels].reduce((sum, id) => {
                const action = projects.find((item) => item.id === id);
                return sum + (action ? cancelRefund(state, action) : 0);
            }, 0);
        const changed = this.menuCancels.size > 0 || this.menuCraft !== null;
        const dialogLabel = text.actionsDialogLabel(nation?.name ?? "?");
        const closeLabel = text.menuClose;
        const deltaText = text.menuDelta(delta > 0 ? "+" : "", delta);
        const confirmEnabled = changed && state.winner === null ? "" : " disabled";
        const emptyCurrent = html`<p class="diplo-menu-empty">${text.menuEmptyCurrent}</p>`;
        const emptyClaims = html`<p class="diplo-menu-empty">${text.menuEmptyClaims}</p>`;
        const blockReason = craftBlockReason ? html`<p class="diplo-menu-empty">${craftBlockReason}</p>` : "";
        setGameHtml(card, html`
            <div class="diplo-menu-head"><span>${dialogLabel}</span><button class="diplo-menu-x" data-menu-close aria-label="${closeLabel}">×</button></div>
            <p class="diplo-menu-note">${text.menuNote}</p>
            <div class="diplo-menu-section">${text.menuSectionCurrent}</div>
            ${rawHtml(projectRows || emptyCurrent)}
            <div class="diplo-menu-section">${text.menuSectionNew}</div>
            ${rawHtml(blockReason)}
            ${rawHtml(craftRows || emptyClaims)}
            ${rawHtml(annexRow)}
            <div class="diplo-menu-foot">
                <span class="diplo-menu-delta ${delta > 0 ? "pos" : delta < 0 ? "neg" : ""}">${deltaText}</span>
                <button class="btn btn-primary" data-menu-confirm ${rawHtml(confirmEnabled)}>${text.menuConfirm}</button>
                <button class="btn" data-menu-close>${text.menuCancel}</button>
            </div>`);
    }

    private confirmActionMenu(): void {
        if (this.menuNation === null) return;
        const text = diplomacyTexts();
        const nationId = this.menuNation;
        let cancelled = 0;
        let crafted = 0;
        for (const id of [...this.menuCancels]) if (this.engine.cancelDiplomaticAction(id)) cancelled++;
        if (this.menuCraft && this.engine.prepareDiplomaticAction(this.menuCraft.kind, nationId, this.menuCraft.stateId)) crafted++;
        this.hooks.sound.play(crafted ? "recruit" : "select");
        const parts: string[] = [];
        if (cancelled) parts.push(text.toastCancelled(cancelled));
        if (crafted) parts.push(text.toastCrafted);
        this.hooks.toast(parts.length ? parts.join(text.toastSeparator) : text.toastNone);
        this.closeActionMenu();
    }

    private syncActionMenu(): void {
        if (!this.menuEl || this.menuNation === null) return;
        const state = this.engine.state;
        const nation = state.nations[this.menuNation];
        if (state.winner !== null || !nation?.alive || isAtWar(state, 0, this.menuNation)) {
            this.closeActionMenu();
            return;
        }
        this.fillActionMenu();
    }

    /* ---- declare-war popover ---- */

    openDeclare(nationId: number): void {
        const text = diplomacyTexts();
        if (this.declarePop && this.declareNation === nationId) {
            this.closeDeclare();
            return;
        }
        this.closeDeclare();
        const ready = readyActions(this.engine.state, nationId);
        if (!ready.length) return;
        this.declareNation = nationId;
        // Preselect the first ready casus belli so a single confirm click can declare.
        this.declarePick = ready[0].id;
        const pop = document.createElement("div");
        pop.className = "declare-pop";
        pop.setAttribute("role", "dialog");
        const name = this.engine.state.nations[nationId]?.name ?? text.declareTargetFallback;
        pop.setAttribute("aria-label", text.declareAriaLabel(name));
        this.hud.appendChild(pop);
        this.declarePop = pop;
        pop.addEventListener("click", this.onPopClick);
        document.addEventListener("pointerdown", this.onDocPointerDown, true);
        window.addEventListener("resize", this.onWindowResize);
        this.fillDeclare();
        this.attachScroll();
        this.positionDeclare();
    }

    closeDeclare(): boolean {
        if (!this.declarePop) return false;
        this.declarePop.removeEventListener("click", this.onPopClick);
        document.removeEventListener("pointerdown", this.onDocPointerDown, true);
        window.removeEventListener("resize", this.onWindowResize);
        this.scrollBody?.removeEventListener("scroll", this.onBodyScroll);
        this.scrollBody = null;
        this.declarePop.remove();
        this.declarePop = null;
        this.declareNation = null;
        this.declarePick = null;
        return true;
    }

    private readonly onPopClick = (event: Event): void => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-close]")) {
            this.closeDeclare();
            return;
        }
        const option = target.closest<HTMLElement>("[data-pick]");
        if (option && this.declarePop) {
            this.declarePick = Number(option.dataset.pick);
            this.fillDeclare();
            this.positionDeclare();
            this.declarePop.querySelector<HTMLElement>("[data-action='declare']")?.focus({ preventScroll: true });
        }
    };

    private readonly onDocPointerDown = (event: PointerEvent): void => {
        const target = event.target as HTMLElement;
        if (this.declarePop && !this.declarePop.contains(target) && !target.closest("[data-action='declare-open']")) {
            this.closeDeclare();
        }
    };

    private readonly onWindowResize = (): void => this.positionDeclare();
    private readonly onBodyScroll = (): void => this.positionDeclare();

    private attachScroll(): void {
        const body = this.el.querySelector<HTMLElement>(".diplo-body");
        if (body === this.scrollBody) return;
        this.scrollBody?.removeEventListener("scroll", this.onBodyScroll);
        this.scrollBody = body;
        body?.addEventListener("scroll", this.onBodyScroll);
    }

    private fillDeclare(): void {
        if (!this.declarePop || this.declareNation === null) return;
        const state = this.engine.state;
        const text = diplomacyTexts();
        const nation = state.nations[this.declareNation];
        const actions = readyActions(state, this.declareNation);
        if (this.declarePick !== null && !actions.some((action) => action.id === this.declarePick)) this.declarePick = null;
        const options = actions.map((action) => {
            const picked = this.declarePick === action.id;
            const scope = action.kind === "annex" ? text.goalAnnex : text.goalConquest(stateName(state, action.stateId, text));
            const valid = text.declareValid(action.expiresDay - state.day);
            return html`<button class="declare-option${picked ? " picked" : ""}" data-pick="${action.id}" aria-pressed="${picked}">
                <b>${scope}</b><span>${valid}</span>
            </button>`;
        }).join("");
        const title = text.declareTitle(nation?.name ?? "?");
        const closeLabel = text.declareClose;
        const confirmAttrs = this.declarePick === null ? " disabled" : `data-diplomatic-id="${this.declarePick}"`;
        setGameHtml(this.declarePop, html`
            <div class="declare-head"><span>${title}</span><button class="declare-x" data-close aria-label="${closeLabel}">×</button></div>
            <p class="declare-hint">${text.declareHint}</p>
            <div class="declare-options">${rawHtml(options)}</div>
            <button class="btn btn-primary declare-confirm" data-action="declare" data-nation="${this.declareNation}" ${rawHtml(confirmAttrs)}>${text.declareConfirm}</button>`);
    }

    private positionDeclare(): void {
        if (!this.declarePop || this.declareNation === null) return;
        const anchor = this.el.querySelector<HTMLElement>(`[data-action="declare-open"][data-nation="${this.declareNation}"]`);
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        const width = this.declarePop.offsetWidth;
        const height = this.declarePop.offsetHeight;
        let left = rect.right + 8;
        if (left + width > window.innerWidth - 8) left = rect.left - width - 8;
        if (left < 8) left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
        const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - height - 8));
        this.declarePop.style.left = `${Math.round(left)}px`;
        this.declarePop.style.top = `${Math.round(top)}px`;
    }

    private syncDeclare(): void {
        if (!this.declarePop || this.declareNation === null) return;
        const state = this.engine.state;
        if (state.winner !== null || isAtWar(state, 0, this.declareNation) || !readyActions(state, this.declareNation).length) {
            this.closeDeclare();
            return;
        }
        this.fillDeclare();
        this.attachScroll();
        this.positionDeclare();
    }
}
