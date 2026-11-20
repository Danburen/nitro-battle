import type { UIContext } from "./context.ts";
import { CLAIM_COST } from "../game/diplomacy.ts";
import { POLICY_SWITCH_COST, REGIMENT_CAP } from "../game/types.ts";
import type { ConscriptionPolicy, EconomyPolicy, OccupationPolicy } from "../game/types.ts";

/** Training, construction and policy switches (dock panels). */
export function handleEconomyAction(ctx: UIContext, action: string, target: HTMLElement): boolean {
    const state = ctx.engine.state;

    if (action === "train") {
        const kind = Number(target.dataset.kind) as 0 | 1 | 2;
        const site = state.selected;
        const destination = site !== null && state.provinces[site].owner === 0 ? site : null;
        if (ctx.engine.queueTrain(kind, destination)) {
            ctx.sound.play("recruit");
            ctx.toast("已加入训练队列");
        } else {
            ctx.sound.play("error");
            ctx.toast("无法训练：资金、人力或工业不足");
        }
        return true;
    }

    if (action === "train-cancel") {
        if (ctx.engine.cancelTrain(Number(target.dataset.order))) {
            ctx.sound.play("select");
            ctx.toast("已取消训练并返还半数资源");
        } else {
            ctx.sound.play("error");
        }
        return true;
    }

    if (action === "build-cancel") {
        if (ctx.engine.cancelBuild(Number(target.dataset.order))) {
            ctx.sound.play("select");
            ctx.toast("已取消施工并返还半数资源");
        } else {
            ctx.sound.play("error");
        }
        return true;
    }

    if (action === "policy") {
        const category = target.dataset.category as "economy" | "conscription" | "occupation";
        const value = target.dataset.value ?? "";
        const ok = category === "economy"
            ? ctx.engine.setPolicy("economy", value as EconomyPolicy)
            : category === "conscription"
                ? ctx.engine.setPolicy("conscription", value as ConscriptionPolicy)
                : ctx.engine.setPolicy("occupation", value as OccupationPolicy);
        if (ok) {
            ctx.sound.play("select");
            ctx.toast(`政策已调整（-${POLICY_SWITCH_COST} 政治点）`);
        } else {
            ctx.sound.play("error");
            ctx.toast(`政治点不足 ${POLICY_SWITCH_COST}，或政策未变化`);
        }
        return true;
    }

    return false;
}

/** Claims, diplomatic preparation, war goals and white peace (dock diplomacy tab). */
export function handleDiplomacyAction(ctx: UIContext, action: string, target: HTMLElement): boolean {
    if (![
        "claim-state", "claim-cancel", "claim-locate", "prepare-diplomacy", "cancel-diplomacy", "declare", "enforce-war-goal",
        "propose-peace", "accept-peace", "reject-peace",
    ].includes(action)) return false;

    const state = ctx.engine.state;
    const fail = (message: string): void => {
        ctx.sound.play("error");
        ctx.toast(message);
    };
    if (state.winner !== null) {
        fail("战役已结束，无法进行外交操作");
        return true;
    }
    const nationId = Number(target.dataset.nation);
    const nationName = state.nations[nationId]?.name ?? "中立独立区域";
    const select = target.closest("[data-diplo-card]")?.querySelector<HTMLSelectElement>("[data-diplo-state]");
    const selectedState = select && select.value !== "" ? Number(select.value) : null;
    const dataState = target.dataset.state === undefined ? NaN : Number(target.dataset.state);
    const resolvedState = Number.isInteger(dataState) && state.states[dataState] ? dataState : selectedState;
    const stateId = resolvedState !== null && Number.isInteger(resolvedState) && state.states[resolvedState] ? resolvedState : null;
    const actionId = target.dataset.diplomaticId === undefined ? NaN : Number(target.dataset.diplomaticId);

    if (action === "claim-state") {
        if (stateId === null) fail("请先选择有效的目标州");
        else if (ctx.engine.claimState(stateId)) ctx.toast(`已提出${state.states[stateId].name}的州宣称；尚需制造战争借口`);
        else fail("无法宣称：请检查政治点、邻接与正式归属条件，或该州已被宣称");
    } else if (action === "claim-cancel") {
        if (stateId === null) fail("无法取消：目标州无效");
        else if (ctx.engine.cancelClaim(stateId)) {
            ctx.sound.play("select");
            ctx.toast(`已取消${state.states[stateId].name}的州宣称，返还 ${CLAIM_COST} 政治点`);
        } else fail("无法取消宣称：该州没有我方宣称，或正与其归属国交战");
    } else if (action === "claim-locate") {
        if (stateId === null) fail("无法定位：目标州无效");
        else {
            ctx.centerSite(state.states[stateId].center);
            ctx.sound.play("select");
        }
    } else if (action === "prepare-diplomacy") {
        const kind = target.dataset.kind;
        if (kind !== "conquest" && kind !== "annex") {
            fail("外交准备类型无效，请重新打开外交页");
        } else if (kind !== "annex" && stateId === null) {
            fail("请先选择符合条件的目标州");
        } else if (ctx.engine.prepareDiplomaticAction(kind, nationId, kind === "annex" ? null : stateId)) {
            ctx.toast("已开始制造战争借口：每日消耗政治点，就绪后可宣战");
        } else {
            fail("无法准备：请检查政治点、宣称、邻接和停战条件；每国仅能计时一项，同一目标不可重复");
        }
    } else if (action === "cancel-diplomacy") {
        if (Number.isInteger(actionId) && ctx.engine.cancelDiplomaticAction(actionId)) ctx.toast("已取消外交项目：制造中返还创建政治点，已消耗维护不退还");
        else fail("无法取消：外交项目不存在、已被消耗，或不属于我方");
    } else if (action === "declare") {
        if (!Number.isInteger(actionId)) fail("无法宣战：请先完成有效战争借口，并使用该借口的宣战按钮");
        else if (ctx.engine.declareWar(nationId, actionId)) ctx.toast(`已向${nationName}宣战，按约定目标逐省争夺`);
        else fail("无法宣战：借口尚未就绪、已过期或目标失效；也可能仍在停战期或已交战");
    } else if (action === "enforce-war-goal") {
        if (ctx.engine.enforceWarGoal(nationId)) ctx.toast(`已与${nationName}按战争目标议和，其余临时占领退还`);
        else fail("无法落实目标：需我方发起的有效战争，并满足目标领土控制条件；吞并还需检查首都和第三方占领");
    } else if (action === "propose-peace") {
        if (ctx.engine.proposePeace(nationId)) ctx.toast(`与${nationName}达成白和平，双方返还临时占领并撤军`);
        else fail(`${nationName}未接受白和平：可能拒绝提议，或双方已不再交战`);
    } else if (action === "accept-peace") {
        if (ctx.engine.respondPeace(nationId, true)) ctx.toast(`已接受${nationName}的白和平，双方返还临时占领并撤军`);
        else fail("无法接受白和平：提议已失效或战争已结束");
    } else {
        const hadOffer = state.peaceOffers.includes(nationId);
        ctx.engine.respondPeace(nationId, false);
        if (hadOffer && !state.peaceOffers.includes(nationId)) ctx.toast(`已拒绝${nationName}的白和平提议`);
        else fail("无法拒绝：该白和平提议已失效");
    }
    return true;
}

/** Army selection, merging, splitting and per-army commands (list + detail window). */
export function handleArmyAction(ctx: UIContext, action: string, target: HTMLElement, event: Event): boolean {
    if (action === "select-army") {
        const armyId = Number(target.dataset.army);
        const mouse = event as MouseEvent;
        if (mouse.ctrlKey || mouse.metaKey) {
            if (ctx.multiSelect.has(armyId)) ctx.multiSelect.delete(armyId);
            else ctx.multiSelect.add(armyId);
            ctx.sound.play("select");
            ctx.refresh();
            return true;
        }
        ctx.multiSelect.clear();
        ctx.splitChecks.clear();
        ctx.engine.selectArmy(armyId);
        ctx.sound.play("select");
        return true;
    }

    if (action === "merge-selected") {
        const ids = [...ctx.multiSelect].sort((a, b) => a - b);
        if (ctx.engine.orderMerge(ids)) {
            ctx.multiSelect.clear();
            ctx.sound.play("select");
            ctx.toast("合并命令已下达：小军团向大军团集结");
        } else {
            ctx.sound.play("error");
            ctx.toast(`无法合并：军团需未行动且未交战，合计不超过 ${REGIMENT_CAP} 团`);
        }
        return true;
    }

    if (action === "merge-clear") {
        ctx.multiSelect.clear();
        ctx.refresh();
        return true;
    }

    if (action === "detail-close") {
        ctx.splitChecks.clear();
        ctx.engine.select(null);
        return true;
    }

    if (action === "redeploy-cancel") {
        ctx.engine.cancelRedeploy();
        return true;
    }

    const army = ctx.engine.selectedArmy();
    if (!army || army.nation !== 0) return false;

    if (action === "split") {
        const freshId = ctx.engine.splitArmy(army.id, [...ctx.splitChecks]);
        if (freshId !== null) {
            ctx.splitChecks.clear();
            ctx.sound.play("recruit");
            ctx.toast("拆分完成：新军团已进驻相邻空省");
        } else {
            ctx.sound.play("error");
            ctx.toast("无法拆分：需未行动、未交战、有空邻省且军团未满额");
        }
    } else if (action === "attack") {
        const site = Number(target.dataset.site);
        if (ctx.engine.attack(army.id, site)) {
            ctx.toast("进攻发起：每日结算一轮，直至分出胜负");
        } else {
            ctx.sound.play("error");
            ctx.toast("无法进攻：需相邻、未行动且目标无敌对会战");
        }
    } else if (action === "attack-cancel") {
        if (ctx.engine.cancelAttack(army.id)) ctx.toast("已停止进攻");
    } else if (action === "march-cancel") {
        if (ctx.engine.cancelMarch(army.id)) ctx.toast("已撤销行军命令");
    } else if (action === "wait") {
        ctx.engine.waitArmy(army.id);
        ctx.sound.play("select");
    } else if (action === "disband") {
        if (ctx.engine.disbandArmy(army.id)) {
            ctx.sound.play("select");
            ctx.toast("军团已解散，所属团复员");
        } else {
            ctx.sound.play("error");
            ctx.toast("交战中的军团无法解散");
        }
    } else if (action === "redeploy") {
        if (ctx.engine.beginRedeploy(army.id)) {
            ctx.sound.play("select");
            ctx.toast("点击绿色省份完成战略转移，Esc 取消");
        } else {
            ctx.sound.play("error");
            ctx.toast("该军团本回合已行动，无法战略转移");
        }
    } else {
        return false;
    }
    return true;
}