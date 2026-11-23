import type { UIContext } from "./context.ts";
import { isArmyAutoManaged } from "../game/auto.ts";
import { AUTO_GLOBAL_LOCK_TIP } from "./common.ts";
import { CLAIM_COST } from "../game/diplomacy.ts";
import { ALLIANCE_CREATE_COST } from "../game/alliance.ts";
import { VASSAL_PROFILES, validVassalType } from "../game/vassal.ts";
import { REGIMENT_CAP } from "../game/types/unit.ts";
import type { VassalType } from "../game/types/diplomacy.ts";
import { textToken } from "./text.ts";

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

    return false;
}

/** Claims, diplomatic preparation, war goals and white peace (dock diplomacy tab). */
export function handleDiplomacyAction(ctx: UIContext, action: string, target: HTMLElement): boolean {
    if (![
        "claim-state", "claim-cancel", "claim-locate", "prepare-diplomacy", "cancel-diplomacy", "declare", "enforce-war-goal",
        "propose-peace", "accept-peace", "reject-peace",
        "respond-request", "vassal-request", "vassal-demand", "tribute-rate",
        "release-vassal", "vassal-type-open", "annex-vassal", "request-aid", "request-upgrade", "create-alliance", "invite-alliance", "join-alliance",
        "leave-alliance", "enforce-vassal",
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
        else fail("无法宣称：请检查[[politics]]、邻接与正式归属条件，或该州已被宣称");
    } else if (action === "claim-cancel") {
        if (stateId === null) fail("无法取消：目标州无效");
        else if (ctx.engine.cancelClaim(stateId)) {
            ctx.sound.play("select");
            ctx.toast(`已取消${state.states[stateId].name}的州宣称，返还 ${textToken("politics", CLAIM_COST)}`);
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
            ctx.toast("已开始制造战争借口：每日消耗[[politics]]，就绪后可宣战");
        } else {
            fail("无法准备：请检查[[politics]]、宣称、邻接和停战条件；每国仅能计时一项，同一目标不可重复");
        }
    } else if (action === "cancel-diplomacy") {
        if (Number.isInteger(actionId) && ctx.engine.cancelDiplomaticAction(actionId)) ctx.toast("已取消外交项目：制造中返还创建[[politics]]，已消耗维护不退还");
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
    } else if (action === "respond-request") {
        const requestId = Number(target.dataset.request);
        const accept = target.dataset.accept === "1";
        if (!Number.isInteger(requestId)) fail("外交请求无效");
        else if (ctx.engine.respondDiplomaticRequest(requestId, accept)) {
            ctx.sound.play("select");
            ctx.toast(accept ? "已接受外交请求" : "已拒绝外交请求");
        } else fail("无法处理：请求已失效，或当前条件已不满足");
    } else if (action === "vassal-request") {
        const details = target.closest("details");
        const picked = details?.querySelector<HTMLInputElement>("input[type='radio']:checked")?.value ?? "cooperative";
        if (!Number.isInteger(nationId)) fail("附庸请求目标无效");
        else if (ctx.engine.requestVassalization(nationId, picked)) ctx.toast(`${nationName} 接受了附庸请求，契约已生效`);
        else fail("附庸请求未获接受：需与目标邻接、双方均无宗主国，且对方认为你有足够价值");
    } else if (action === "vassal-demand") {
        if (!Number.isInteger(nationId)) fail("附庸目标无效");
        else ctx.confirm({
            title: `要求 ${nationName} 成为附庸`,
            body: "以压迫型附庸结束：不割让领土，对方上缴 30% [[funds]]/[[industry]] 与每日 [[politics:3]]，独立性不可主动提升。对方可能拒绝，并因此保持敌对。",
            confirmLabel: "提出要求",
            danger: true,
            onConfirm: () => {
                if (ctx.engine.demandVassalization(nationId)) ctx.toast(`${nationName} 接受了附庸要求`);
                else {
                    ctx.sound.play("error");
                    ctx.toast(`${nationName} 拒绝成为附庸：需明显弱于我方或无望继续战争`);
                }
            },
        });
    } else if (action === "tribute-rate") {
        const delta = Number(target.dataset.delta);
        if (!Number.isFinite(delta)) fail("贡赋调整无效");
        else if (ctx.engine.adjustTributeRate(delta)) ctx.toast("贡赋比例已调整");
        else fail("无法调整贡赋：只有合作型附庸可在 5%–40% 内调整");
    } else if (action === "release-vassal") {
        if (!Number.isInteger(nationId)) fail("附庸目标无效");
        else ctx.confirm({
            title: `释放 ${nationName}`,
            body: "解除附庸关系并给予 [[turn:10]]停战期；已收取的贡赋不会返还。",
            confirmLabel: "释放附庸",
            onConfirm: () => {
                if (ctx.engine.releaseVassal(nationId)) ctx.toast(`${nationName} 已恢复独立`);
                else {
                    ctx.sound.play("error");
                    ctx.toast("无法释放：该国不是你的附庸");
                }
            },
        });
    } else if (action === "vassal-type-open") {
        const current = target.dataset.type ?? "";
        if (!Number.isInteger(nationId)) fail("附庸目标无效");
        else if (!validVassalType(current)) fail("当前附庸类型无效");
        else ctx.confirm({
            title: `改变 ${nationName} 的附庸类型`,
            body: "选择新的契约类型；独立性进度按比例保留，并限制在新上限内。",
            confirmLabel: "确认更改",
            choices: (Object.keys(VASSAL_PROFILES) as VassalType[]).map((value) => ({
                value,
                label: VASSAL_PROFILES[value].name,
                hint: VASSAL_PROFILES[value].blurb,
            })),
            choice: current,
            onConfirm: (value) => {
                const picked = value ?? "";
                if (!validVassalType(picked)) {
                    fail("附庸类型无效");
                    return;
                }
                if (picked === current) return;
                if (ctx.engine.changeVassalType(nationId, picked)) {
                    ctx.sound.play("select");
                    ctx.toast(`${nationName} 的契约已改为${VASSAL_PROFILES[picked].name}`);
                } else {
                    ctx.sound.play("error");
                    ctx.toast("无法改变契约：该国不是你的附庸，或已是该类型");
                }
            },
        });
    } else if (action === "annex-vassal") {
        if (ctx.engine.annexVassal(nationId)) ctx.toast(`${nationName} 已被吞并，领土与军团并入我方`);
        else fail("无法吞并：仅能吞并独立性极低且无反叛意图的附庸");
    } else if (action === "request-aid") {
        if (ctx.engine.requestForeignAid(nationId)) ctx.toast(`${nationName} 已同意求援：提供[[funds]]与[[politics]]，甚至可能对宗主国宣战`);
        else fail("求援未成功：对方拒绝，或冷却未结束、暂无可用的非宗主国");
    } else if (action === "request-upgrade") {
        if (ctx.engine.requestVassalUpgrade()) ctx.toast("契约改善请求已发出，等待宗主国答复");
        else fail("无法请求改善契约：需独立性达到上限的 60%、国家倾向愿意改善、[[politics]]足够，且当前契约还有改善空间");
    } else if (action === "create-alliance") {
        ctx.confirm({
            title: "创建联盟阵营",
            body: `消耗 ${textToken("politics", ALLIANCE_CREATE_COST)}。创建后可邀请有共同敌人或战略倾向相近的国家；孤立主义不会主动创建联盟。`,
            confirmLabel: "创建",
            onConfirm: () => {
                if (ctx.engine.createAlliance()) ctx.toast("联盟阵营已创建，可在外交面板邀请成员");
                else {
                    ctx.sound.play("error");
                    ctx.toast("无法创建联盟：[[politics]]不足、已有联盟，或当前倾向不适合结盟");
                }
            },
        });
    } else if (action === "invite-alliance") {
        if (!Number.isInteger(nationId)) fail("联盟邀请目标无效");
        else if (ctx.engine.inviteToAlliance(nationId)) ctx.toast(`已向${nationName}发出结盟邀请`);
        else fail("无法邀请：需由联盟领袖发出，且双方有共同敌人或相近战略倾向");
    } else if (action === "join-alliance") {
        const leaderId = Number(target.dataset.leader);
        if (!Number.isInteger(leaderId)) fail("联盟领袖无效");
        else if (ctx.engine.requestJoinAlliance(leaderId)) ctx.toast("入盟申请已获接受");
        else fail("入盟申请被拒绝：需有共同敌人或相近战略倾向，拒绝后 [[turn:15]]内不能再次申请");
    } else if (action === "leave-alliance") {
        ctx.confirm({
            title: "退出联盟",
            body: "退出后共享通行权与共同敌人即刻失效，[[turn:15]]内无法重新加入同一联盟。",
            confirmLabel: "退出联盟",
            danger: true,
            onConfirm: () => {
                if (ctx.engine.leaveAlliance()) ctx.toast("已退出联盟");
                else {
                    ctx.sound.play("error");
                    ctx.toast("无法退出：我方不在任何联盟中");
                }
            },
        });
    } else if (action === "enforce-vassal") {
        if (!Number.isInteger(nationId)) fail("附庸目标无效");
        else ctx.confirm({
            title: `扶 ${nationName} 为压迫型附庸`,
            body: "以战争目标议和，但不割让领土：对方保留国土，上缴 30% [[funds]]/[[industry]] 与每日 [[politics:3]]，独立性极低且不可主动提升。",
            confirmLabel: "扶为附庸",
            danger: true,
            onConfirm: () => {
                if (ctx.engine.enforceWarGoal(nationId, "oppressive")) ctx.toast(`${nationName} 已成为压迫型附庸`);
                else {
                    ctx.sound.play("error");
                    ctx.toast("无法扶为附庸：需我方发起的全面吞并战争且已满足胜利条件");
                }
            },
        });
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
    if (action === "auto-manage-toggle") {
        const enabled = ctx.engine.state.autoManageArmies !== true;
        ctx.engine.setAutoManageArmies(enabled);
        ctx.multiSelect.clear();
        ctx.splitChecks.clear();
        if (ctx.engine.selectedArmy()) ctx.engine.select(ctx.engine.state.selected ?? null);
        ctx.sound.play("select");
        ctx.toast(enabled
            ? "已开启全局托管：面板已锁定，取消标题右侧齿轮后可手动指挥"
            : "已关闭全局托管：全部军团恢复手动指挥");
        return true;
    }

    if (action === "army-auto-toggle") {
        if (ctx.engine.state.autoManageArmies === true) {
            ctx.sound.play("error");
            ctx.toast(AUTO_GLOBAL_LOCK_TIP);
            return true;
        }
        const armyId = Number(target.dataset.army);
        const name = ctx.engine.state.armies.get(armyId)?.name ?? "军团";
        if (!ctx.engine.toggleArmyAutoManaged(armyId)) {
            ctx.sound.play("error");
            ctx.toast("无法设置托管：目标不是我方军团");
            return true;
        }
        const managed = isArmyAutoManaged(ctx.engine.state, ctx.engine.state.armies.get(armyId));
        ctx.multiSelect.delete(armyId);
        ctx.splitChecks.clear();
        if (managed && ctx.engine.state.selectedArmyId === armyId) ctx.engine.select(ctx.engine.state.selected ?? null);
        ctx.sound.play("select");
        ctx.toast(managed ? `${name} 已交由 AI 托管` : `${name} 已取消托管，可手动指挥`);
        return true;
    }

    if (action === "select-army") {
        if (ctx.engine.state.autoManageArmies === true) {
            ctx.sound.play("error");
            ctx.toast(AUTO_GLOBAL_LOCK_TIP);
            return true;
        }
        const armyId = Number(target.dataset.army);
        const mouse = event as MouseEvent;
        if ((mouse.ctrlKey || mouse.metaKey) && isArmyAutoManaged(ctx.engine.state, ctx.engine.state.armies.get(armyId))) {
            ctx.sound.play("error");
            ctx.toast("请先取消托管，再选择当前军团进行合并");
            return true;
        }
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
        const blocked = ids.find((id) => isArmyAutoManaged(ctx.engine.state, ctx.engine.state.armies.get(id)));
        if (blocked !== undefined) {
            ctx.multiSelect.delete(blocked);
            ctx.sound.play("error");
            ctx.toast("请先取消托管，再选择当前军团进行合并");
            ctx.refresh();
            return true;
        }
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
    if (isArmyAutoManaged(ctx.engine.state, army)) {
        ctx.sound.play("error");
        ctx.toast("该军团已托管：请先取消托管再下达命令");
        return true;
    }

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
        ctx.confirm({
            title: `解散 ${army.name}`,
            body: `军团解散后所属 ${army.regiments.length} 个团将复员，无法恢复。`,
            confirmLabel: "解散军团",
            danger: true,
            onConfirm: () => {
                if (ctx.engine.disbandArmy(army.id)) {
                    ctx.sound.play("select");
                    ctx.toast("军团已解散，所属团复员");
                } else {
                    ctx.sound.play("error");
                    ctx.toast("交战中的军团无法解散");
                }
            },
        });
    } else if (action === "redeploy") {
        if (ctx.engine.beginRedeploy(army.id)) {
            ctx.sound.play("select");
            ctx.toast("点击绿色省份完成战略转移，Esc 取消");
        } else {
            ctx.sound.play("error");
            ctx.toast("该军团本[[turn]]已行动，无法战略转移");
        }
    } else {
        return false;
    }
    return true;
}