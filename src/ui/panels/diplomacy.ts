import type { GameEngine } from "../../game/engine.ts";
import type { SoundManager } from "../../audio/index.ts";
import {
    DIPLOMATIC_PROFILES, canDeclareWar, canPrepareDiplomaticAction, cancelRefund,
    decidePeace, isAtWar, nationPower, truceDays, warDuration,
} from "../../game/diplomacy.ts";
import { nationArmyCount, nationProvinceCount } from "../../game/rules.ts";
import { warGoalProgress } from "../../game/settlement.ts";
import { tendencyProfileOf } from "../../game/ai/tendencies.ts";
import {
    ALLIANCE_CREATE_COST, ALLIANCE_HELP_BODY, allianceOf, canCreateAlliance, canInviteToAlliance,
    decideAllianceInvite, decideJoinRequest,
} from "../../game/alliance.ts";
import {
    VASSAL_HELP_BODY, VASSAL_PROFILES, VASSAL_UPGRADE_COST, aidCandidates,
    canAnnexVassal, canBecomeVassal, canRequestAid, canRequestUpgrade, decideAid,
    decideUpgrade, decideVassalDemand, decideVassalOffer,
    tributeRateOf, upgradeTargetOf,
} from "../../game/vassal.ts";
import { nationDisplayColor, overlordOf, vassalTypeOf, vassalsOf } from "../../game/access.ts";
import { REQUEST_COOLDOWN_DAYS, requestCooldownDays } from "../../game/requests.ts";
import { TRADE_AGREEMENT_DAYS, tradePartners, tradeResourceKinds } from "../../game/trade.ts";
import type { DiplomaticAction, DiplomaticActionKind, DiplomaticRequest, DiplomaticRequestKind } from "../../game/types/diplomacy.ts";
import type { GameState } from "../../game/types/state.ts";
import { escapeGameText, escapeHtml, iconMaskStyle, renderGameText, textToken } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { decisionTooltipAttrs } from "../decision-tip.ts";
import { helpButton, panelHead } from "../panel.ts";
import { nationOverviewBody, nationStats } from "../nation-info.ts";
import { vassalIndependenceIcon, vassalTypeIcon } from "../vassal.ts";
import { nationFlagHtmlFor } from "../flags.ts";
import { TRADE_KIND_LABEL, cadenceToken, proposalCooldownTip, resourceNames, transferList } from "../trade.ts";

const OBJECTIVE_TIP = "目标：通过战争与议和吞并所有对手。\n首都失守不立即灭国，失去全部正式领土才战败。\n\n实际控制不等于正式归属；战争逐省争夺，攻占州中心或首都不会令全境易主。\n目标议和只转移约定领土；白和平返还双方临时占领区，不转移第三国土地。\n宣战需先在「扩张」页提出州宣称，再制造夺取或吞并借口；借口就绪后点击【宣战】选择战争目标。";

/** Pending-request copy: one row per kind, so a new request never means a new branch. */
const REQUEST_TITLE: Record<DiplomaticRequestKind, (from: string, request: DiplomaticRequest) => string> = {
    vassalize: (from, request) => request.demand ? `${from} 要求你成为附庸` : `${from} 请求成为附庸`,
    alliance: (from) => `${from} 邀请加入联盟`,
    upgrade: (from) => `${from} 请求改善附庸契约`,
    call: (from) => `${from} 召唤你履行附庸义务`,
    aid: (from) => `${from} 请求外援`,
    trade: (from, request) => `${from} 提议${TRADE_KIND_LABEL[request.tradeKind ?? "exchange"]}`,
};

const REQUEST_DETAIL: Record<DiplomaticRequestKind, (state: GameState, request: DiplomaticRequest) => string> = {
    vassalize: (_state, request) => {
        const profile = VASSAL_PROFILES[request.vassalType ?? "autonomous"];
        return `${request.demand ? "强制要求" : "契约"}：${profile.name} · ${profile.blurb}`;
    },
    alliance: (state, request) => {
        const alliance = state.alliances.find((entry) => entry.id === request.allianceId);
        const leader = alliance
            ? state.nations[alliance.leader]?.name ?? "?"
            : state.nations[request.from]?.name ?? "?";
        return `联盟领袖：${leader} · 成员 ${alliance?.members.length ?? 0} 国 · 共享通行权与共同敌人`;
    },
    upgrade: (_state, request) => {
        const profile = VASSAL_PROFILES[request.vassalType ?? "cooperative"];
        return `附庸请求将契约改善为${profile.name}，需 ${textToken("politics", VASSAL_UPGRADE_COST)}：${profile.blurb}`;
    },
    call: (state, request) => {
        const enemy = typeof request.enemy === "number" ? state.nations[request.enemy]?.name ?? "敌方" : "敌方";
        return `宗主国正在与 ${enemy} 作战。接受后立即对 ${enemy} 宣战；拒绝会使独立性上升。`;
    },
    aid: (state, request) => {
        const overlord = overlordOf(state, request.from);
        const type = vassalTypeOf(state, request.from);
        const contract = type ? `${VASSAL_PROFILES[type].name}附庸` : "附庸";
        return `求援国是${overlord >= 0 ? ` ${state.nations[overlord].name} 的` : ""}${contract}；接受后可提供[[funds]]与[[politics]]，并可能对宗主国宣战。`;
    },
    trade: (_state, request) => `${TRADE_KIND_LABEL[request.tradeKind ?? "exchange"]}：双方按下列资源与交割频率履约。`,
};

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
    private readonly el = document.querySelector<HTMLElement>("#diplomacy-panel") as HTMLElement;
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
    private vassalListCollapsed = false;

    constructor(engine: GameEngine, hooks: DiplomacyHooks) {
        this.engine = engine;
        this.hooks = hooks;
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
        }
        this.el.classList.toggle("hidden", hidden);
        if (!hidden && body) body.scrollTop = this.scrollTop;
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
        const player = state.nations[0];
        const others = state.nations.filter((nation) => !nation.isPlayer);
        if (this.target === null || !others.some((nation) => nation.id === this.target)) {
            this.target = others.find((nation) => nation.alive && isAtWar(state, 0, nation.id))?.id
                ?? others.find((nation) => nation.alive)?.id ?? others[0]?.id ?? null;
        }

        const signature = `${this.target}:${this.target !== null && isAtWar(state, 0, this.target)}`;
        if (signature !== this.viewSignature) this.scrollTop = 0;
        this.viewSignature = signature;

        this.el.innerHTML = `
            ${panelHead({
                title: "外交",
                help: { title: "战役目标与规则", body: OBJECTIVE_TIP },
                helpAttrs: 'data-diplo-focus="objective"',
                status: renderGameText(textToken("politics", Math.floor(player.politicalPower))),
            })}
            <div class="panel-body diplo-body">
                ${this.relationsHtml()}
            </div>`;

        for (const tab of this.el.querySelectorAll<HTMLElement>("[data-action='diplo-target']")) {
            tab.onkeydown = (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                this.setTarget(Number(tab.dataset.nation));
            };
        }
        for (const toggle of this.el.querySelectorAll<HTMLElement>("[data-vassal-collapse]")) {
            toggle.onclick = () => {
                this.vassalListCollapsed = !this.vassalListCollapsed;
                this.hooks.sound.play("select");
                this.render();
            };
        }
        if (active) {
            const next = [...this.el.querySelectorAll<HTMLElement>("[data-diplo-focus]")]
                .find((element) => element.dataset.diploFocus === focusKey && !element.matches(":disabled"));
            const card = [...this.el.querySelectorAll<HTMLElement>("[data-diplo-card]")]
                .find((element) => element.dataset.diploCard === focusCard);
            (next ?? card)?.focus({ preventScroll: true });
        }
        this.el.querySelector<HTMLElement>(".diplo-body")!.scrollTop = this.scrollTop;
        this.syncDeclare();
        this.syncActionMenu();
    }

    private requestTitle(request: DiplomaticRequest): string {
        const from = this.engine.state.nations[request.from]?.name ?? "某国";
        return REQUEST_TITLE[request.kind](from, request);
    }

    private requestDetail(request: DiplomaticRequest): string {
        return REQUEST_DETAIL[request.kind](this.engine.state, request);
    }

    /** Trade requests carry structured transfers; render them as coloured resource rows. */
    private tradeRequestDetailHtml(request: DiplomaticRequest): string {
        const give = request.tradeGive ?? [];
        const receive = request.tradeReceive ?? [];
        const lines: string[] = [];
        if (request.tradeKind === "aid") {
            lines.push(`<div class="trade-request-line"><span class="trade-side-label">请求物资（你提供）</span>${transferList(receive, "out")}</div>`);
        } else {
            if (give.length) lines.push(`<div class="trade-request-line"><span class="trade-side-label">对方提供</span>${transferList(give, "in")}</div>`);
            if (receive.length) lines.push(`<div class="trade-request-line"><span class="trade-side-label">我方提供</span>${transferList(receive, "out")}</div>`);
        }
        lines.push(`<p class="trade-request-note">每月部分${cadenceToken("monthly")}自动交割，持续 ${renderGameText(textToken("turn", TRADE_AGREEMENT_DAYS))}；固定部分在接受时交付。</p>`);
        return lines.join("");
    }

    /** Compact war / trade / vassal relationship strip between nation stats and 外交行动. */
    private statusBarHtml(nationId: number): string {
        const state = this.engine.state;
        const nation = state.nations[nationId];
        if (!nation) return "";
        const enemies = state.nations.filter((other) => other.id !== nationId && isAtWar(state, nationId, other.id));
        const partners = tradePartners(state, nationId);
        const overlord = overlordOf(state, nationId);
        const vassals = vassalsOf(state, nationId);

        const rows: string[] = [];
        if (enemies.length) {
            const self = `<span class="diplo-status-flag" ${tooltipAttrs(
                escapeGameText(nation.name),
                escapeGameText(`${nation.name} 正在与 ${enemies.map((enemy) => enemy.name).join("、")} 交战`),
            )}>${nationFlagHtmlFor(state, nationId, 18)}</span>`;
            const flags = enemies.map((enemy) => `<span class="diplo-status-flag" ${tooltipAttrs(
                escapeGameText(enemy.name),
                escapeGameText(`${nation.name} 正在与 ${enemy.name} 交战`),
            )}>${nationFlagHtmlFor(state, enemy.id, 18)}</span>`).join("");
            rows.push(`<div class="diplo-status-row"><span class="icon-glyph diplo-status-icon diplo-status-icon--war" aria-hidden="true" ${iconMaskStyle("war")}></span><span class="diplo-status-items">${self}${flags}</span></div>`);
        }
        if (partners.length) {
            const flags = partners.map((partnerId) => {
                const partner = state.nations[partnerId];
                if (!partner) return "";
                const kinds = tradeResourceKinds(state, nationId, partnerId);
                const body = `${nation.name} 与 ${partner.name} 有贸易条约，涉及 ${kinds.length} 种资源：${resourceNames(kinds)}。`;
                return `<span class="diplo-status-flag" ${tooltipAttrs(escapeGameText(partner.name), escapeGameText(body))}>${nationFlagHtmlFor(state, partnerId, 18)}</span>`;
            }).join("");
            rows.push(`<div class="diplo-status-row"><span class="icon-glyph diplo-status-icon diplo-status-icon--trade" aria-hidden="true" ${iconMaskStyle("trade")}></span><span class="diplo-status-items">${flags}</span></div>`);
        }
        if (overlord >= 0 || vassals.length) {
            const bits: string[] = [];
            if (overlord >= 0) {
                const lord = state.nations[overlord];
                bits.push(`<span class="diplo-status-vassal">${vassalTypeIcon(state, nationId)}<span class="diplo-status-flag" ${tooltipAttrs(
                    escapeGameText(lord?.name ?? "宗主国"),
                    escapeGameText(`${nation.name} 是 ${lord?.name ?? "?"} 的${VASSAL_PROFILES[vassalTypeOf(state, nationId) ?? "autonomous"].name}附庸`),
                )}>${nationFlagHtmlFor(state, overlord, 18)}</span></span>`);
            }
            for (const vassalId of vassals) {
                const vassal = state.nations[vassalId];
                if (!vassal) continue;
                bits.push(`<span class="diplo-status-vassal">${vassalTypeIcon(state, vassalId)}<span class="diplo-status-flag" ${tooltipAttrs(
                    escapeGameText(vassal.name),
                    escapeGameText(`${vassal.name} 是 ${nation.name} 的${VASSAL_PROFILES[vassalTypeOf(state, vassalId) ?? "autonomous"].name}附庸`),
                )}>${nationFlagHtmlFor(state, vassalId, 18)}</span></span>`);
            }
            rows.push(`<div class="diplo-status-row"><span class="diplo-status-items">${bits.join("")}</span></div>`);
        }
        return rows.length ? `<div class="diplo-status" aria-label="外交状态">${rows.join("")}</div>` : "";
    }

    private requestsHtml(): string {
        const state = this.engine.state;
        const requests = state.diplomaticRequests.filter((request) => request.to === 0 && request.expiresDay > state.day);
        if (!requests.length) return "";
        const rows = requests.map((request) => {
            const from = state.nations[request.from];
            if (!from) return "";
            return `<div class="diplo-request" data-request-id="${request.id}">
                <div class="diplo-request-head">${nationFlagHtmlFor(state, request.from, 20)}<b>${escapeHtml(this.requestTitle(request))}</b>
                    <span class="diplo-request-days">剩 ${renderGameText(textToken("turn", Math.max(0, request.expiresDay - state.day)))}</span></div>
                <div class="diplo-request-body">${request.kind === "trade" ? this.tradeRequestDetailHtml(request) : escapeHtml(this.requestDetail(request))}</div>
                <div class="diplo-request-actions">
                    <button class="btn btn-primary" data-action="respond-request" data-request="${request.id}" data-accept="1" ${state.winner === null ? "" : "disabled"}>接受</button>
                    <button class="btn btn-outline" data-action="respond-request" data-request="${request.id}" data-accept="0" ${state.winner === null ? "" : "disabled"}>拒绝</button>
                </div>
            </div>`;
        }).join("");
        return `<div class="diplo-requests"><div class="diplo-requests-head">待处理外交请求</div>${rows}</div>`;
    }

    /** Player-side vassal contract: independence, tribute and contract upgrade. */
    private selfVassalHtml(): string {
        const state = this.engine.state;
        const overlord = overlordOf(state, 0);
        if (overlord >= 0) {
            const type = vassalTypeOf(state, 0) ?? "autonomous";
            const profile = VASSAL_PROFILES[type];
            const rate = tributeRateOf(state, 0);
            const upgradeTarget = upgradeTargetOf(type);
            const canUpgrade = canRequestUpgrade(state, 0);
            const upgradeCooldown = requestCooldownDays(state, "upgrade", overlord);
            let upgradeTip = "";
            if (upgradeCooldown > 0) {
                upgradeTip = tooltipAttrs("请求改善契约", proposalCooldownTip(upgradeCooldown));
            } else if (upgradeTarget) {
                upgradeTip = canUpgrade
                    ? decisionTooltipAttrs(
                        `向 ${escapeGameText(state.nations[overlord]?.name ?? "宗主国")} 请求将契约改善为${VASSAL_PROFILES[upgradeTarget].name}，需 ${textToken("politics", VASSAL_UPGRADE_COST)}。确认后送出，下一回合答复。`,
                        [{ decision: decideUpgrade(state, overlord, 0) }],
                    )
                    : tooltipAttrs("请求改善契约", `独立性达到上限的 60%、国家倾向愿意改善且需要 ${textToken("politics", VASSAL_UPGRADE_COST)} 时可提出；宗主国可能拒绝。改善目标：${VASSAL_PROFILES[upgradeTarget].name}。`);
            }
            const upgrade = upgradeTarget
                ? `<button class="btn btn-outline${upgradeCooldown > 0 ? " cooldown" : ""}" data-action="request-upgrade" ${upgradeCooldown > 0 ? 'aria-disabled="true"' : canUpgrade ? "" : "disabled"} ${upgradeTip}>请求改善契约</button>`
                : "";
            const tributeControl = type === "cooperative"
                ? `<div class="diplo-vassal-tribute"><span class="vassal-tribute-label">贡赋比例</span> ${Math.round(rate * 100)}%
                    <button class="btn btn-outline" data-action="tribute-rate" data-delta="-0.05" ${rate <= profile.resourceMin + 1e-9 ? "disabled" : ""}>-5%</button>
                    <button class="btn btn-outline" data-action="tribute-rate" data-delta="0.05" ${rate >= profile.resourceMax - 1e-9 ? "disabled" : ""}>+5%</button></div>`
                : "";
            return `<div class="diplo-vassal-self">
                <div class="diplo-vassal-head">${nationFlagHtmlFor(state, overlord, 22)}
                    <b>附庸于：${escapeHtml(state.nations[overlord].name)}</b>
                    ${vassalTypeIcon(state, 0)}
                    ${vassalIndependenceIcon(state, 0)}
                    ${helpButton({ title: "附庸制度", body: VASSAL_HELP_BODY })}
                </div>
                ${tributeControl}
                ${upgrade ? `<div class="diplo-button-row">${upgrade}</div>` : ""}
            </div>`;
        }
        const vassals = vassalsOf(state, 0);
        if (!vassals.length) return "";
        const rows = vassals.map((id) => `
            <div class="diplo-vassal-row">
                ${nationFlagHtmlFor(state, id, 20)}
                <span class="diplo-vassal-name">${escapeHtml(state.nations[id].name)}</span>
                ${vassalTypeIcon(state, id)}
                ${vassalIndependenceIcon(state, id)}
                <button class="btn btn-outline" data-action="diplo-target" data-nation="${id}" data-diplo-focus="vassal-view-${id}" ${tooltipAttrs("查看附庸", `查看 ${state.nations[id].name} 的外交详情，在那里释放或改变契约。`)}>查看附庸</button>
            </div>`).join("");
        return `<div class="diplo-vassal-self">
            <div class="diplo-vassal-head">
                <b>你拥有 ${vassals.length} 个附庸</b>
                ${helpButton({ title: "附庸制度", body: VASSAL_HELP_BODY })}
                <button type="button" class="diplo-vassal-caret" data-vassal-collapse data-diplo-focus="vassal-collapse" aria-label="${this.vassalListCollapsed ? "展开附庸列表" : "收起附庸列表"}">${this.vassalListCollapsed ? "▸" : "▾"}</button>
            </div>
            <div class="diplo-vassal-list${this.vassalListCollapsed ? " hidden" : ""}">${rows}</div>
        </div>`;
    }

    /** Player-side alliance: current camp or the create button. */
    private selfAllianceHtml(): string {
        const state = this.engine.state;
        const alliance = allianceOf(state, 0);
        if (alliance) {
            const leader = state.nations[alliance.leader];
            const members = alliance.members.map((id) => state.nations[id]?.name ?? "?").join("、");
            return `<div class="diplo-alliance">
                <div class="diplo-alliance-head"><b>联盟</b><span class="status-pill ready">${alliance.members.length} 国</span>${helpButton({ title: "联盟制度", body: ALLIANCE_HELP_BODY })}</div>
                <p class="diplo-note">领袖：${escapeHtml(leader?.name ?? "?")} · 成员：${escapeHtml(members)}</p>
                <button class="btn btn-outline" data-action="leave-alliance" ${tooltipAttrs("退出联盟", `退出后 ${textToken("turn", REQUEST_COOLDOWN_DAYS)}回合内无法重新加入同一联盟；共享通行权与共同敌人即刻失效。`)}>退出联盟</button>
            </div>`;
        }
        if (!canCreateAlliance(state, 0)) return "";
        return `<div class="diplo-alliance">
            <div class="diplo-alliance-head"><b>尚未结盟</b>${helpButton({ title: "联盟制度", body: ALLIANCE_HELP_BODY })}</div>
            <p class="diplo-note">创建阵营消耗 ${ALLIANCE_CREATE_COST} 政治点；随后可邀请有共同敌人或战略倾向相近的国家。</p>
            <button class="btn btn-outline" data-action="create-alliance" ${tooltipAttrs("创建联盟", `消耗 ${ALLIANCE_CREATE_COST} 政治点；孤立主义国家不会主动创建联盟。`)}>创建联盟</button>
        </div>`;
    }


    private relationsHtml(): string {
        const state = this.engine.state;
        const others = state.nations.filter((nation) => !nation.isPlayer);
        const conquered = others.filter((nation) => !nation.alive).length;
        const wars = others.filter((nation) => nation.alive && isAtWar(state, 0, nation.id)).length;
        const ready = state.diplomaticActions.filter((action) => action.nation === 0
            && state.day >= action.readyDay && state.day < action.expiresDay
            && canDeclareWar(state, 0, action.target, action.id)).length;
        const tabs = others.map((nation) => {
            const selected = this.target === nation.id;
            const war = nation.alive && isAtWar(state, 0, nation.id);
            const truce = nation.alive && !war && truceDays(state, 0, nation.id) > 0;
            const status = !nation.alive ? "已灭亡" : war ? "交战中" : truce ? "停战中" : "电脑";
            const controlledStates = state.states.filter((region) =>
                region.provinces.some((site) => state.provinces[site].owner === nation.id)).length;
            const tip = `${status}\n外交倾向：${tendencyProfileOf(nation.tendency).name}\n拥有军团：${nationArmyCount(state, nation.id)}\n拥有地区：${controlledStates} 州（${nationProvinceCount(state, nation.id)} 省）`;
            const color = nationDisplayColor(state, nation.id);
            return `<button class="diplo-swatch${selected ? " selected" : ""}${nation.alive ? "" : " dead"}${war ? " war" : ""}${truce ? " truce" : ""}" role="tab" aria-selected="${selected}"
                aria-label="${escapeHtml(`${nation.name}（${status}）`)}" style="--pc:${escapeHtml(color)}"
                data-action="diplo-target" data-nation="${nation.id}" data-diplo-focus="nation-${nation.id}"
                ${tooltipAttrs(escapeGameText(nation.name), tip)}>${nationFlagHtmlFor(state, nation.id, 22)}</button>`;
        }).join("");
        return `
            <div class="diplo-overview-stats">
                <span class="status-pill ready">吞并 ${conquered}/${others.length}</span>
                <span class="status-pill ${wars ? "war" : "idle"}">${wars} 场战争</span>
                <span class="status-pill ${ready ? "ready" : "idle"}">借口就绪 ${ready}</span>
            </div>
            ${this.requestsHtml()}
            ${this.selfVassalHtml()}
            ${this.selfAllianceHtml()}
            <div class="diplo-swatches" role="tablist" aria-label="目标国家">${tabs}</div>
            ${state.winner !== null ? '<p class="diplo-requirement">战役已结束，外交操作已关闭。</p>' : ""}
            ${this.target !== null ? this.nationHtml(this.target) : '<p class="diplo-note">没有可交互的目标国家。</p>'}`;
    }

    private stateName(stateId: number | null): string {
        return stateId === null ? "未指定州" : this.engine.state.states[stateId]?.name ?? "已失效州";
    }

    private actionLabel(action: DiplomaticAction): string {
        const scope = action.kind === "annex"
            ? this.engine.state.nations[action.target]?.name ?? "目标国家"
            : this.stateName(action.stateId);
        return `${DIPLOMATIC_PROFILES[action.kind].label} · ${scope}`;
    }

    private projectsHtml(target: number): string {
        const state = this.engine.state;
        const projects = state.diplomaticActions.filter((action) => action.nation === 0 && action.target === target);
        if (!projects.length) return "";
        const chips = projects.map((action) => {
            const preparing = state.day < action.readyDay;
            const expired = state.day >= action.expiresDay;
            const ready = !preparing && !expired;
            const short = action.kind === "annex" ? "吞并" : `夺取·${this.stateName(action.stateId)}`;
            const time = expired ? "已过期" : preparing ? `剩 ${renderGameText(textToken("turn", action.readyDay - state.day))}` : `就绪 · 剩 ${renderGameText(textToken("turn", action.expiresDay - state.day))}`;
            const tip = `${this.actionLabel(action)}\n${expired ? "已过期，可在外交行动菜单清除。" : preparing ? "准备中，完成后可宣战。" : "已就绪，点击【宣战】选择此目标。"}\n取消请打开【制造战争借口／停止制造】菜单。`;
            return `<span class="diplo-project-chip${ready ? " ready" : ""}${expired ? " expired" : ""}" ${tooltipAttrs(escapeGameText(short), tip)}>${escapeHtml(short)} · ${time}</span>`;
        }).join("");
        return `<div class="diplo-projects">${chips}</div>`;
    }

    /** Cooldown wins over the normal tooltip; the button stays visible but inert. */
    private requestGate(
        kind: DiplomaticRequestKind, nationId: number, normalTip: string,
    ): { readonly blocked: boolean; readonly attrs: string; readonly tip: string } {
        const days = requestCooldownDays(this.engine.state, kind, nationId);
        return days > 0
            ? {
                blocked: true,
                attrs: 'aria-disabled="true"',
                tip: tooltipAttrs("请求过于频繁", proposalCooldownTip(days)),
            }
            : { blocked: false, attrs: "", tip: normalTip };
    }

    /** Aid tooltip: qualitative reasons plus the verdict from the request's own decision function. */
    private aidTooltipAttrs(nationId: number): string {
        const state = this.engine.state;
        const nation = state.nations[nationId];
        const overlord = overlordOf(state, 0);
        const overlordName = overlord >= 0 ? state.nations[overlord]?.name ?? "宗主国" : "宗主国";
        const description = `向 ${escapeGameText(nation.name)} 请求外援。对方是 ${escapeGameText(overlordName)} 的附庸；接受后会提供 [[funds]] 与 [[politics]]，并可能因此对宗主国宣战。确认后送出，下一回合答复；拒绝后需等待 ${textToken("turn", REQUEST_COOLDOWN_DAYS)}回合才能再试。`;
        return decisionTooltipAttrs(description, [{ decision: decideAid(state, 0, nationId) }]);
    }

    private nationHtml(nationId: number): string {
        const state = this.engine.state;
        const nation = state.nations[nationId];
        const atWar = isAtWar(state, 0, nationId);
        const hasOffer = state.peaceOffers.includes(nationId);
        const truce = truceDays(state, 0, nationId);
        const status = !nation.alive ? "已灭亡" : atWar ? `交战 ${renderGameText(textToken("turn", warDuration(state, 0, nationId)))}` : truce > 0 ? `停战 ${renderGameText(textToken("turn", truce))}` : "电脑";
        const summary = nationStats(state, nationId);
        const head = `<div class="diplo-head">${nationFlagHtmlFor(state, nation.id, 26)}<span class="diplo-name">${escapeHtml(nation.name)}</span><span class="status-pill ${!nation.alive ? "dead" : atWar ? "war" : "idle"}">${status}</span></div>`;
        const stats = nationOverviewBody(state, summary, " diplo-kv");
        const base = `${head}${stats}<div class="diplo-divider"></div>`;
        if (!nation.alive) return `<div class="diplo-row dead diplo-card" data-diplo-card="${nationId}" tabindex="-1">${base}${this.projectsHtml(nationId)}</div>`;

        const ready = this.readyActions(nationId);
        const claimCount = state.claims.filter((claim) => claim.nation === 0 &&
            state.states[claim.stateId]?.provinces.some((site) => state.provinces[site].legalOwner === nationId)).length;
        const declareTip = ready.length
            ? "向这个国家宣战：选择已就绪的战争借口后确认，宣战立即生效。\n\n[[note:无需对方接受]]\n宗主国与盟友可能依关系参战；停战期内不能再次宣战。"
            : truce > 0 ? `尚在停战期，剩 [[turn:${truce}]]。`
                : `暂无可用借口：先在「扩张」页或州模式地图宣称该国土州（已宣称 ${claimCount} 项），再打开【制造战争借口】制造夺取或吞并借口；就绪后回到此处宣战。每国同时仅计时一项借口。`;
        const declareBtn = `<button class="btn btn-primary" data-action="declare-open" data-nation="${nationId}" data-diplo-focus="declare-${nationId}" ${ready.length && state.winner === null ? "" : "disabled"} ${tooltipAttrs("宣战", declareTip)}>宣战</button>`;

        const preparing = state.diplomaticActions.some((action) => action.nation === 0 && action.target === nationId && state.day < action.readyDay);
        const craftLabel = preparing ? "停止制造" : "制造战争借口";
        const craftTip = preparing
            ? "打开外交行动菜单：取消正在制造的借口（返还创建政治点，持续消耗不返还），或改选其他目标。"
            : "打开外交行动菜单：勾选已宣称的州制造夺取借口，或制造全面吞并借口；也可取消现有项目。";
        const craftBtn = `<button class="btn btn-outline" data-action="diplo-menu-open" data-nation="${nationId}" data-diplo-focus="menu-${nationId}" ${atWar || state.winner !== null ? "disabled" : ""} ${tooltipAttrs(craftLabel, atWar ? "交战中无法制造或取消借口。" : craftTip)}>${craftLabel}</button>`;

        let goalHtml = "";
        const actionButtons: string[] = [craftBtn];
        if (atWar) {
            const war = state.wars.find((item) => (item.aggressor === 0 && item.defender === nationId) || (item.aggressor === nationId && item.defender === 0));
            if (war) {
                const progress = warGoalProgress(state, war);
                const ours = war.aggressor === 0;
                const goal = war.goal === "annex" ? "全面吞并" : `夺取 ${this.stateName(war.stateId)}`;
                const requirement = war.goal === "annex"
                    ? "需控制敌国首都及至少 60% 正式领土，且无第三方占领；或控制全部正式领土。"
                    : "需控制目标州内全部敌方正式领土；不会转移第三国土地。";
                goalHtml = `<div class="diplo-goal" ${tooltipAttrs("战争目标", escapeGameText(requirement))}>${ours ? "我方" : "对方"}目标：${escapeHtml(goal)} · 控制 ${progress.held}/${progress.total} 省${progress.canEnforce ? " · 可落实" : ""}</div>`;
                if (ours) actionButtons.push(`<button class="btn btn-outline" data-action="enforce-war-goal" data-nation="${nationId}" data-diplo-focus="enforce-${nationId}" ${progress.canEnforce && state.winner === null ? "" : "disabled"} ${tooltipAttrs("落实战争目标", "按约定目标议和，目标之外的临时占领退还，双方撤军至可控地区。")}>落实目标</button>`);
                if (ours && war.goal === "annex") actionButtons.push(`<button class="btn btn-outline" data-action="enforce-vassal" data-nation="${nationId}" data-diplo-focus="enforce-vassal-${nationId}" ${progress.canEnforce && state.winner === null ? "" : "disabled"} ${tooltipAttrs("扶为附庸", "以压迫型附庸结束战争：不割让领土，对方保留国土、上缴固定资源与政治点，独立性与宗主国通行权随之生效。")}>扶为附庸</button>`);
            }
            actionButtons.push(hasOffer
                ? `<button class="btn btn-outline" data-action="accept-peace" data-nation="${nationId}" data-diplo-focus="accept-${nationId}" ${state.winner === null ? "" : "disabled"} ${tooltipAttrs("接受求和", "双方返还临时占领区、解除会战并撤军，进入停战期。")}>接受求和</button><button class="btn btn-outline" data-action="reject-peace" data-nation="${nationId}" data-diplo-focus="reject-${nationId}" ${state.winner === null ? "" : "disabled"} ${tooltipAttrs("拒绝求和", "拒绝此次提议，战争继续。")}>拒绝</button>`
                : `<button class="btn btn-outline" data-action="propose-peace" data-nation="${nationId}" data-diplo-focus="peace-${nationId}" ${state.winner === null ? "" : "disabled"} ${decisionTooltipAttrs(`提议与 ${escapeGameText(nation.name)} 白和平：双方临时占领均退还，不保留战果。`, [{ decision: decidePeace(state, nationId, 0) }])}>求和</button>`);
        } else {
            actionButtons.push(`<button class="btn btn-outline" data-action="propose-peace" data-nation="${nationId}" data-diplo-focus="peace-${nationId}" disabled ${tooltipAttrs("求和", "仅交战中可提议白和平。")}>求和</button>`);
            actionButtons.push(declareBtn);
        }
        // All vassal and alliance actions share the card's single 外交行动 row.
        actionButtons.push(...this.vassalActionsHtml(nationId));
        // A vassal's foreign-aid request targets the nation on this card. Only
        // valid helpers qualify — the overlord is never a candidate.
        if (canRequestAid(state, 0) && aidCandidates(state, 0).includes(nationId)) {
            const gate = this.requestGate("aid", nationId, this.aidTooltipAttrs(nationId));
            actionButtons.push(`<button class="btn btn-outline${gate.blocked ? " cooldown" : ""}" data-action="request-aid" data-nation="${nationId}" ${gate.blocked ? gate.attrs : state.winner === null ? "" : "disabled"} ${gate.tip}>请求外援</button>`);
        }

        return `<div class="diplo-row diplo-card${hasOffer ? " offer" : ""}" data-diplo-card="${nationId}" tabindex="-1">
            ${base}
            ${this.statusBarHtml(nationId)}
            <div class="diplo-actions-head">外交行动</div>
            <div class="diplo-button-row">${actionButtons.join("")}</div>
            ${goalHtml}${this.projectsHtml(nationId)}
            ${this.allianceActionsHtml(nationId)}
        </div>`;
    }

    /** Vassal actions merged into the card's 外交行动 row — no separate section. */
    private vassalActionsHtml(nationId: number): string[] {
        const state = this.engine.state;
        if (state.winner !== null) return [];
        const overlord = overlordOf(state, 0);
        const targetOverlord = overlordOf(state, nationId);
        const type = vassalTypeOf(state, nationId);

        if (targetOverlord === 0) {
            const actions = [
                `<button class="btn btn-outline" data-action="release-vassal" data-nation="${nationId}" ${tooltipAttrs("释放附庸", "解除附庸关系并给予 [[turn:10]]停战期；不会返还已收取的贡赋。")}>释放附庸</button>`,
                `<button class="btn btn-outline" data-action="vassal-type-open" data-nation="${nationId}" data-type="${type ?? ""}" ${tooltipAttrs("改变附庸类型", "打开对话框选择新的契约类型；独立性进度按比例保留并限制在新上限内。")}>改变附庸类型</button>`,
            ];
            if (canAnnexVassal(state, 0, nationId)) {
                actions.push(`<button class="btn btn-outline" data-action="annex-vassal" data-nation="${nationId}" ${tooltipAttrs("吞并附庸", "该附庸独立性极低且无反叛意图，可直接吞并：其全部领土与军团并入我方。")}>吞并附庸</button>`);
            }
            return actions;
        }
        if (overlord === nationId || targetOverlord >= 0 || vassalsOf(state, nationId).length > 0 || overlord >= 0) return [];
        const canOffer = canBecomeVassal(state, 0, nationId, "cooperative");
        const canDemand = canBecomeVassal(state, nationId, 0, "oppressive") &&
            nationPower(state, 0) >= nationPower(state, nationId) * 1.5;
        const actions: string[] = [];
        if (canOffer) {
            const cooldown = requestCooldownDays(state, "vassalize", nationId);
            if (cooldown > 0) {
                actions.push(`<button class="btn btn-outline cooldown" data-action="vassal-request" data-nation="${nationId}" aria-disabled="true" ${tooltipAttrs("请求成为附庸", proposalCooldownTip(cooldown))}>请求成为附庸…</button>`);
            } else {
                const offerTip = decisionTooltipAttrs(
                    `向 ${escapeGameText(state.nations[nationId].name)} 请求成为附庸；下方按契约类型分别显示对方的判定。确认后送出，下一回合答复。`,
                    [
                        { title: "合作型", decision: decideVassalOffer(state, nationId, 0, "cooperative") },
                        { title: "自治型", decision: decideVassalOffer(state, nationId, 0, "autonomous") },
                    ],
                );
                actions.push(`<details class="diplo-submenu">
                    <summary ${offerTip}>请求成为附庸…</summary>
                    <div class="diplo-submenu-body">
                        <label class="diplo-radio"><input type="radio" name="vassal-type-${nationId}" value="cooperative" checked />
                            <span><b>合作型</b>：${renderGameText("上缴 5%–40% [[funds]]/[[industry]]（默认 15%），换取保护与每[[turn]] [[politics:1]]；独立性低。")}</span></label>
                        <label class="diplo-radio"><input type="radio" name="vassal-type-${nationId}" value="autonomous" />
                            <span><b>自治型</b>：${renderGameText("仅每[[turn]]上缴 [[politics:2]]，经济自主；独立性较高。")}</span></label>
                        <button class="btn btn-primary" data-action="vassal-request" data-nation="${nationId}" ${tooltipAttrs("请求成为附庸", "按所选契约类型提交；确认后送出，下一回合答复。压迫型不能主动选择。判定结果见上方说明。")}>提交请求</button>
                    </div>
                </details>`);
            }
        }
        if (canDemand) {
            const cooldown = requestCooldownDays(state, "vassalize", nationId);
            const demandTip = cooldown > 0
                ? tooltipAttrs("要求附庸", proposalCooldownTip(cooldown))
                : decisionTooltipAttrs(
                    `以实力施压，要求 ${escapeGameText(state.nations[nationId].name)} 成为压迫型附庸：不割地，但上缴固定 30% [[funds]]/[[industry]] 与每[[turn]] [[politics:3]]，且不可主动提升独立性。确认后送出，下一回合答复。`,
                    [{ decision: decideVassalDemand(state, 0, nationId) }],
                );
            actions.push(`<button class="btn btn-outline${cooldown > 0 ? " cooldown" : ""}" data-action="vassal-demand" data-nation="${nationId}" ${cooldown > 0 ? 'aria-disabled="true"' : ""} ${demandTip}>要求附庸</button>`);
        }
        return actions;
    }

    private allianceActionsHtml(nationId: number): string {
        const state = this.engine.state;
        if (state.winner !== null) return "";
        const myAlliance = allianceOf(state, 0);
        const targetAlliance = allianceOf(state, nationId);
        if (myAlliance && targetAlliance && myAlliance.id === targetAlliance.id) {
            return `<p class="diplo-note">盟友：共享通行权，并把彼此的敌人视为共同敌人。</p>`;
        }
        if (myAlliance && myAlliance.leader === 0 && canInviteToAlliance(state, 0, nationId)) {
            const inviteTip = decisionTooltipAttrs(
                `邀请 ${escapeGameText(state.nations[nationId].name)} 加入我方阵营；成员共享通行权与共同敌人。确认后送出，下一回合答复。`,
                [{ decision: decideAllianceInvite(state, 0, nationId) }],
            );
            const gate = this.requestGate("alliance", nationId, inviteTip);
            return `<div class="diplo-alliance-section"><div class="diplo-actions-head">联盟事务</div>
                <button class="btn btn-outline${gate.blocked ? " cooldown" : ""}" data-action="invite-alliance" data-nation="${nationId}" ${gate.attrs} ${gate.tip}>邀请加入联盟</button>
            </div>`;
        }
        if (!myAlliance && targetAlliance && overlordOf(state, 0) < 0) {
            const leader = state.nations[targetAlliance.leader];
            const joinTip = decisionTooltipAttrs(
                `向 ${escapeGameText(leader?.name ?? "领袖")} 申请加入其阵营；确认后送出，下一回合答复；拒绝后 ${textToken("turn", REQUEST_COOLDOWN_DAYS)}回合内不能再次申请。`,
                [{ decision: decideJoinRequest(state, targetAlliance.leader, 0) }],
            );
            const gate = this.requestGate("alliance", targetAlliance.leader, joinTip);
            return `<div class="diplo-alliance-section"><div class="diplo-actions-head">联盟事务</div>
                <button class="btn btn-outline${gate.blocked ? " cooldown" : ""}" data-action="join-alliance" data-leader="${targetAlliance.leader}" ${gate.attrs} ${gate.tip}>申请加入联盟</button>
            </div>`;
        }
        return "";
    }

    private readyActions(nationId: number): DiplomaticAction[] {
        const state = this.engine.state;
        return state.diplomaticActions.filter((action) => action.nation === 0 && action.target === nationId
            && state.day >= action.readyDay && state.day < action.expiresDay
            && canDeclareWar(state, 0, nationId, action.id));
    }

    /* ---- centered diplomatic-action menu ---- */

    openActionMenu(nationId: number): void {
        if (this.menuEl && this.menuNation === nationId) {
            this.closeActionMenu();
            return;
        }
        this.closeActionMenu();
        const nation = this.engine.state.nations[nationId];
        if (!nation || nation.isPlayer || !nation.alive) return;
        this.menuNation = nationId;
        this.menuCancels.clear();
        this.menuCraft = null;
        const scrim = document.createElement("div");
        scrim.className = "diplo-menu-scrim";
        scrim.innerHTML = `<div class="diplo-menu" role="dialog" aria-label="外交行动 · ${escapeHtml(nation.name)}" tabindex="-1"></div>`;
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

    /** Preview authorization as if the marked cancellations (and their refunds) had already been applied. */
    private craftAllowed(kind: DiplomaticActionKind, target: number, stateId: number | null): boolean {
        const state = this.engine.state;
        const refund = state.diplomaticActions.reduce(
            (sum, action) => sum + (this.menuCancels.has(action.id) ? cancelRefund(state, action) : 0), 0);
        const nations = state.nations.slice();
        nations[0] = { ...nations[0], politicalPower: nations[0].politicalPower + refund };
        const preview = {
            ...state,
            nations,
            diplomaticActions: state.diplomaticActions.filter((action) => !this.menuCancels.has(action.id)),
        };
        return canPrepareDiplomaticAction(preview, 0, kind, target, stateId);
    }

    private fillActionMenu(): void {
        if (!this.menuEl || this.menuNation === null) return;
        const state = this.engine.state;
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
            const time = expired ? "已过期" : preparing ? `准备中 · 剩 ${renderGameText(textToken("turn", action.readyDay - state.day))}` : `已就绪 · 剩 ${renderGameText(textToken("turn", action.expiresDay - state.day))}`;
            const refundNote = expired ? "清除不返还"
                : preparing ? `取消返还 ${refund} · 已耗 ${spent} 不返还`
                    : "放弃不返还";
            const checked = this.menuCancels.has(action.id);
            return `<label class="diplo-menu-row">
                <input type="checkbox" data-role="cancel" data-id="${action.id}" ${checked ? "checked" : ""} ${state.winner !== null ? "disabled" : ""} />
                <span class="diplo-menu-main"><b>${escapeHtml(this.actionLabel(action))}</b><span>${time} · ${refundNote}</span></span>
            </label>`;
        }).join("");

        const claims = state.claims.filter((claim) => claim.nation === 0 &&
            state.states[claim.stateId]?.provinces.some((site) => state.provinces[site].legalOwner === nationId));
        const craftRows = claims.map((claim) => {
            const region = state.states[claim.stateId];
            const allowed = !atWar && this.craftAllowed("conquest", nationId, region.id);
            const picked = this.menuCraft?.kind === "conquest" && this.menuCraft.stateId === region.id;
            const profile = DIPLOMATIC_PROFILES.conquest;
            return `<label class="diplo-menu-row">
                <input type="checkbox" data-role="craft" data-kind="conquest" data-state="${region.id}" ${picked ? "checked" : ""} ${allowed ? "" : "disabled"} />
                <span class="diplo-menu-main"><b>夺取 · ${escapeHtml(region.name)}</b><span>消耗 ${profile.cost} · ${renderGameText(textToken("turn", profile.days))} · 每${renderGameText("[[turn]]")} ${profile.upkeep}</span></span>
            </label>`;
        }).join("");
        const annexAllowed = !atWar && this.craftAllowed("annex", nationId, null);
        const annexPicked = this.menuCraft?.kind === "annex";
        const annexProfile = DIPLOMATIC_PROFILES.annex;
        const annexRow = `<label class="diplo-menu-row">
            <input type="checkbox" data-role="craft" data-kind="annex" ${annexPicked ? "checked" : ""} ${annexAllowed ? "" : "disabled"} />
            <span class="diplo-menu-main"><b>全面吞并 · ${escapeHtml(nation?.name ?? "?")}</b><span>消耗 ${annexProfile.cost} · ${renderGameText(textToken("turn", annexProfile.days))} · 每${renderGameText("[[turn]]")} ${annexProfile.upkeep} · 无需宣称</span></span>
        </label>`;

        const craftBlockReason = atWar ? "交战中无法制造新借口。"
            : state.winner !== null ? "战役已结束。"
                : projects.some((action) => state.day < action.readyDay && !this.menuCancels.has(action.id))
                    ? "每国同时仅计时一项：先勾选取消当前准备中的项目，才能制造新借口。"
                    : "";
        const delta = (this.menuCraft ? -DIPLOMATIC_PROFILES[this.menuCraft.kind].cost : 0)
            + [...this.menuCancels].reduce((sum, id) => {
                const action = projects.find((item) => item.id === id);
                return sum + (action ? cancelRefund(state, action) : 0);
            }, 0);
        const changed = this.menuCancels.size > 0 || this.menuCraft !== null;

        card.innerHTML = `
            <div class="diplo-menu-head"><span>外交行动 · ${escapeHtml(nation?.name ?? "?")}</span><button class="diplo-menu-x" data-menu-close aria-label="关闭外交行动菜单">×</button></div>
            <p class="diplo-menu-note">勾选现有项目以取消（准备中返还创建政治点，持续消耗不返还）；勾选宣称或吞并以制造新借口。</p>
            <div class="diplo-menu-section">当前借口项目</div>
            ${projectRows || '<p class="diplo-menu-empty">暂无进行中的借口项目。</p>'}
            <div class="diplo-menu-section">制造新借口</div>
            ${craftBlockReason ? `<p class="diplo-menu-empty">${escapeHtml(craftBlockReason)}</p>` : ""}
            ${craftRows || '<p class="diplo-menu-empty">无已宣称的该国土州；先到「扩张」页或州模式地图提出宣称。</p>'}
            ${annexRow}
            <div class="diplo-menu-foot">
                <span class="diplo-menu-delta ${delta > 0 ? "pos" : delta < 0 ? "neg" : ""}">政治点 ${delta > 0 ? "+" : ""}${delta}</span>
                <button class="btn btn-primary" data-menu-confirm ${changed && state.winner === null ? "" : "disabled"}>确认</button>
                <button class="btn" data-menu-close>取消</button>
            </div>`;
    }

    private confirmActionMenu(): void {
        if (this.menuNation === null) return;
        const nationId = this.menuNation;
        let cancelled = 0;
        let crafted = 0;
        for (const id of [...this.menuCancels]) if (this.engine.cancelDiplomaticAction(id)) cancelled++;
        if (this.menuCraft && this.engine.prepareDiplomaticAction(this.menuCraft.kind, nationId, this.menuCraft.stateId)) crafted++;
        this.hooks.sound.play(crafted ? "recruit" : "select");
        const parts: string[] = [];
        if (cancelled) parts.push(`取消 ${cancelled} 项借口`);
        if (crafted) parts.push("开始制造新借口");
        this.hooks.toast(parts.length ? parts.join("，") : "没有可执行的外交变更");
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
        if (this.declarePop && this.declareNation === nationId) {
            this.closeDeclare();
            return;
        }
        this.closeDeclare();
        if (!this.readyActions(nationId).length) return;
        this.declareNation = nationId;
        this.declarePick = null;
        const pop = document.createElement("div");
        pop.className = "declare-pop";
        pop.setAttribute("role", "dialog");
        pop.setAttribute("aria-label", `向${this.engine.state.nations[nationId]?.name ?? "目标"}宣战`);
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
        const nation = state.nations[this.declareNation];
        const actions = this.readyActions(this.declareNation);
        if (this.declarePick !== null && !actions.some((action) => action.id === this.declarePick)) this.declarePick = null;
        const options = actions.map((action) => {
            const picked = this.declarePick === action.id;
            const scope = action.kind === "annex" ? "全面吞并" : `夺取 ${this.stateName(action.stateId)}`;
            return `<button class="declare-option${picked ? " picked" : ""}" data-pick="${action.id}" aria-pressed="${picked}">
                <b>${escapeHtml(scope)}</b><span>借口有效剩 ${renderGameText(textToken("turn", action.expiresDay - state.day))}</span>
            </button>`;
        }).join("");
        this.declarePop.innerHTML = `
            <div class="declare-head"><span>向 ${escapeHtml(nation?.name ?? "?")} 宣战</span><button class="declare-x" data-close aria-label="关闭宣战窗口">×</button></div>
            <p class="declare-hint">选择战争目标：</p>
            <div class="declare-options">${options}</div>
            <button class="btn btn-primary declare-confirm" data-action="declare" data-nation="${this.declareNation}" ${this.declarePick === null ? "disabled" : `data-diplomatic-id="${this.declarePick}"`}>确认宣战</button>`;
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
        if (state.winner !== null || isAtWar(state, 0, this.declareNation) || !this.readyActions(this.declareNation).length) {
            this.closeDeclare();
            return;
        }
        this.fillDeclare();
        this.attachScroll();
        this.positionDeclare();
    }
}