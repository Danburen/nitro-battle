import type { UIContext, UIDispatchData, UIDispatchOptions } from "./context.ts";
import { CLAIM_COST } from "../game/diplomacy.ts";
import { ALLIANCE_CREATE_COST } from "../game/alliance.ts";
import { REQUEST_COOLDOWN_DAYS, requestCooldownDays } from "../game/requests.ts";
import type { DiplomaticRequestKind } from "../game/types/diplomacy.ts";
import { t } from "../i18n/index.ts";
import { proposalCooldownTip } from "./trade.ts";

/** Training, construction and policy switches (dock panels). */
export function handleEconomyAction(ctx: UIContext, action: string, data: UIDispatchData): boolean {
    const state = ctx.engine.state;

    if (action === "province-stance") {
        const site = state.selected;
        const stance = data.stance;
        if (site === null || (stance !== "auto" && stance !== "defend" && stance !== "attack")) return true;
        if (ctx.engine.setProvinceStance(site, stance)) ctx.sound.play("select");
        else ctx.sound.play("error");
        return true;
    }

    if (action === "clear-province-troops") {
        const site = state.selected;
        if (site === null || !ctx.engine.clearProvinceTroops(site)) {
            ctx.sound.play("error");
            ctx.toast(t("actions.economy.train.fail"));
        } else {
            ctx.sound.play("select");
        }
        return true;
    }

    if (action === "disband-regiment") {
        const site = state.selected;
        const kind = Number(data.kind);
        if (site === null || (kind !== 0 && kind !== 1 && kind !== 2) || !ctx.engine.disbandRegiment(site, kind)) {
            ctx.sound.play("error");
            ctx.toast(t("actions.economy.train.fail"));
        } else {
            ctx.sound.play("select");
        }
        return true;
    }

    if (action === "train-cancel") {
        if (ctx.engine.cancelTrain(Number(data.order))) {
            ctx.sound.play("select");
            ctx.toast(t("actions.economy.train.cancel.success"));
        } else {
            ctx.sound.play("error");
        }
        return true;
    }

    if (action === "build-cancel") {
        if (ctx.engine.cancelBuild(Number(data.order))) {
            ctx.sound.play("select");
            ctx.toast(t("actions.economy.build.cancel.success"));
        } else {
            ctx.sound.play("error");
        }
        return true;
    }

    return false;
}

/** Claims, diplomatic preparation, war goals and white peace (dock diplomacy tab). */
export function handleDiplomacyAction(ctx: UIContext, action: string, data: UIDispatchData, options: UIDispatchOptions): boolean {
    if (![
        "claim-state", "claim-cancel", "claim-locate", "prepare-diplomacy", "cancel-diplomacy", "declare", "enforce-war-goal",
        "propose-peace", "accept-peace", "reject-peace",
        "respond-request", "create-alliance", "invite-alliance", "join-alliance",
        "leave-alliance",
    ].includes(action)) return false;

    const state = ctx.engine.state;
    const fail = (message: string): void => {
        ctx.sound.play("error");
        ctx.toast(message);
    };
    const proposalFail = (kind: DiplomaticRequestKind, targetId: number, fallback: string): void => {
        const days = requestCooldownDays(state, kind, targetId);
        fail(days > 0 ? proposalCooldownTip(days) : fallback);
    };
    if (state.winner !== null) {
        fail(t("actions.diplomacy.ended"));
        return true;
    }
    if (options.cooldown) {
        fail(options.cooldownTooltip ?? t("actions.diplomacy.cooldownFallback"));
        return true;
    }
    const nationId = Number(data.nation);
    const nationName = state.nations[nationId]?.name ?? t("actions.diplomacy.unknownNation");
    const selectedState = options.selectedState ?? null;
    const dataState = data.state === undefined ? NaN : Number(data.state);
    const resolvedState = Number.isInteger(dataState) && state.states[dataState] ? dataState : selectedState;
    const stateId = resolvedState !== null && Number.isInteger(resolvedState) && state.states[resolvedState] ? resolvedState : null;
    const actionId = data.diplomaticId === undefined ? NaN : Number(data.diplomaticId);

    if (action === "claim-state") {
        if (stateId === null) fail(t("actions.diplomacy.claim.invalidState"));
        else if (ctx.engine.claimState(stateId)) ctx.toast(t("actions.diplomacy.claim.success", { name: state.states[stateId].name }));
        else fail(t("actions.diplomacy.claim.fail"));
    } else if (action === "claim-cancel") {
        if (stateId === null) fail(t("actions.diplomacy.claim.cancel.invalidState"));
        else if (ctx.engine.cancelClaim(stateId)) {
            ctx.sound.play("select");
            ctx.toast(t("actions.diplomacy.claim.cancel.success", { name: state.states[stateId].name, cost: CLAIM_COST }));
        } else fail(t("actions.diplomacy.claim.cancel.fail"));
    } else if (action === "claim-locate") {
        if (stateId === null) fail(t("actions.diplomacy.claim.locate.invalidState"));
        else {
            ctx.centerSite(state.states[stateId].center);
            ctx.sound.play("select");
        }
    } else if (action === "prepare-diplomacy") {
        const kind = data.kind;
        if (kind !== "conquest" && kind !== "annex") {
            fail(t("actions.diplomacy.prepare.invalidKind"));
        } else if (kind !== "annex" && stateId === null) {
            fail(t("actions.diplomacy.prepare.invalidState"));
        } else if (ctx.engine.prepareDiplomaticAction(kind, nationId, kind === "annex" ? null : stateId)) {
            ctx.toast(t("actions.diplomacy.prepare.success"));
        } else {
            fail(t("actions.diplomacy.prepare.fail"));
        }
    } else if (action === "cancel-diplomacy") {
        if (Number.isInteger(actionId) && ctx.engine.cancelDiplomaticAction(actionId)) ctx.toast(t("actions.diplomacy.prepare.cancel.success"));
        else fail(t("actions.diplomacy.prepare.cancel.fail"));
    } else if (action === "declare") {
        if (!Number.isInteger(actionId)) fail(t("actions.diplomacy.war.declare.invalidGoal"));
        else if (ctx.engine.declareWar(nationId, actionId)) ctx.toast(t("actions.diplomacy.war.declare.success", { nation: nationName }));
        else fail(t("actions.diplomacy.war.declare.fail"));
    } else if (action === "enforce-war-goal") {
        if (ctx.engine.enforceWarGoal(nationId)) ctx.toast(t("actions.diplomacy.war.goal.success", { nation: nationName }));
        else fail(t("actions.diplomacy.war.goal.fail"));
    } else if (action === "propose-peace") {
        if (ctx.engine.proposePeace(nationId)) ctx.toast(t("actions.diplomacy.peace.white.success", { nation: nationName }));
        else fail(t("actions.diplomacy.peace.white.notAccepted", { nation: nationName }));
    } else if (action === "accept-peace") {
        if (ctx.engine.respondPeace(nationId, true)) ctx.toast(t("actions.diplomacy.peace.accept.success", { nation: nationName }));
        else fail(t("actions.diplomacy.peace.accept.fail"));
    } else if (action === "respond-request") {
        const requestId = Number(data.request);
        const accept = data.accept === "1";
        if (!Number.isInteger(requestId)) fail(t("actions.diplomacy.request.invalid"));
        else if (ctx.engine.respondDiplomaticRequest(requestId, accept)) {
            ctx.sound.play("select");
            ctx.toast(accept ? t("actions.diplomacy.request.accepted") : t("actions.diplomacy.request.rejected"));
        } else fail(t("actions.diplomacy.request.fail"));
    } else if (action === "create-alliance") {
        ctx.confirm({
            title: t("actions.diplomacy.alliance.create.title"),
            body: t("actions.diplomacy.alliance.create.body", { cost: ALLIANCE_CREATE_COST }),
            confirmLabel: t("actions.diplomacy.alliance.create.confirm"),
            onConfirm: () => {
                if (ctx.engine.createAlliance()) ctx.toast(t("actions.diplomacy.alliance.create.success"));
                else {
                    ctx.sound.play("error");
                    ctx.toast(t("actions.diplomacy.alliance.create.fail"));
                }
            },
        });
    } else if (action === "invite-alliance") {
        if (!Number.isInteger(nationId)) fail(t("actions.diplomacy.alliance.invite.invalidTarget"));
        else if (ctx.engine.inviteToAlliance(nationId)) ctx.toast(t("actions.diplomacy.alliance.invite.success"));
        else proposalFail("alliance", nationId, t("actions.diplomacy.alliance.invite.fail"));
    } else if (action === "join-alliance") {
        const leaderId = Number(data.leader);
        if (!Number.isInteger(leaderId)) fail(t("actions.diplomacy.alliance.join.invalidLeader"));
        else if (ctx.engine.requestJoinAlliance(leaderId)) ctx.toast(t("actions.diplomacy.alliance.join.success"));
        else proposalFail("alliance", leaderId, t("actions.diplomacy.alliance.join.fail", { days: REQUEST_COOLDOWN_DAYS }));
    } else if (action === "leave-alliance") {
        ctx.confirm({
            title: t("actions.diplomacy.alliance.leave"),
            body: t("actions.diplomacy.alliance.leave.body", { days: REQUEST_COOLDOWN_DAYS }),
            confirmLabel: t("actions.diplomacy.alliance.leave"),
            danger: true,
            onConfirm: () => {
                if (ctx.engine.leaveAlliance()) ctx.toast(t("actions.diplomacy.alliance.leave.success"));
                else {
                    ctx.sound.play("error");
                    ctx.toast(t("actions.diplomacy.alliance.leave.fail"));
                }
            },
        });
    } else {
        const hadOffer = state.peaceOffers.includes(nationId);
        ctx.engine.respondPeace(nationId, false);
        if (hadOffer && !state.peaceOffers.includes(nationId)) ctx.toast(t("actions.diplomacy.peace.reject.success", { nation: nationName }));
        else fail(t("actions.diplomacy.peace.reject.fail"));
    }
    return true;
}

