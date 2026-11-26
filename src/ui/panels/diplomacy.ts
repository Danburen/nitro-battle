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
import { escapeGameText, escapeHtml, iconMaskStyle, gameText, setGameHtml, game } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { decisionTooltipAttrs } from "../decision-tip.ts";
import { helpButton, panelHead } from "../panel.ts";
import { nationOverviewBody, nationStats } from "../nation-info.ts";
import { vassalIndependenceIcon, vassalTypeIcon } from "../vassal.ts";
import { nationFlagHtmlFor } from "../flags.ts";
import { TRADE_KIND_LABEL, cadenceToken, proposalCooldownTip, resourceNames, transferList } from "../trade.ts";
import { t } from "../../i18n/index.ts";

/** Pending-request copy: one row per kind, so a new request never means a new branch. */
const REQUEST_TITLE: Record<DiplomaticRequestKind, (from: string, request: DiplomaticRequest) => string> = {
    vassalize: (from, request) => request.demand
        ? t("panels.diplomacy.request.title.demand", { from })
        : t("panels.diplomacy.request.title.offer", { from }),
    alliance: (from) => t("panels.diplomacy.request.title.alliance", { from }),
    upgrade: (from) => t("panels.diplomacy.request.title.upgrade", { from }),
    call: (from) => t("panels.diplomacy.request.title.call", { from }),
    aid: (from) => t("panels.diplomacy.request.title.aid", { from }),
    trade: (from, request) => t("panels.diplomacy.request.title.trade", {
        from, kind: TRADE_KIND_LABEL[request.tradeKind ?? "exchange"],
    }),
};

const REQUEST_DETAIL: Record<DiplomaticRequestKind, (state: GameState, request: DiplomaticRequest) => string> = {
    vassalize: (_state, request) => {
        const profile = VASSAL_PROFILES[request.vassalType ?? "autonomous"];
        const demand = request.demand
            ? t("panels.diplomacy.request.demand")
            : t("panels.diplomacy.request.contract");
        return t("panels.diplomacy.request.detail.vassal", {
            demand, profile: profile.name, blurb: profile.blurb,
        });
    },
    alliance: (state, request) => {
        const alliance = state.alliances.find((entry) => entry.id === request.allianceId);
        const leader = alliance
            ? state.nations[alliance.leader]?.name ?? "?"
            : state.nations[request.from]?.name ?? "?";
        return t("panels.diplomacy.request.detail.alliance", { leader, count: alliance?.members.length ?? 0 });
    },
    upgrade: (_state, request) => {
        const profile = VASSAL_PROFILES[request.vassalType ?? "cooperative"];
        return t("panels.diplomacy.request.detail.upgrade", {
            profile: profile.name, blurb: profile.blurb, cost: VASSAL_UPGRADE_COST,
        });
    },
    call: (state, request) => {
        const fallback = t("panels.diplomacy.enemy.fallback");
        const enemy = typeof request.enemy === "number" ? state.nations[request.enemy]?.name ?? fallback : fallback;
        return t("panels.diplomacy.request.detail.call", { enemy });
    },
    aid: (state, request) => {
        const overlord = overlordOf(state, request.from);
        const type = vassalTypeOf(state, request.from);
        const contract = type
            ? t("panels.diplomacy.vassal.contract", { name: VASSAL_PROFILES[type].name })
            : t("panels.diplomacy.vassal.generic");
        const overlordNote = overlord >= 0
            ? t("panels.diplomacy.aid.overlord", { name: state.nations[overlord].name })
            : "";
        return t("panels.diplomacy.request.detail.aid", { overlordNote, contract });
    },
    trade: (_state, request) => t("panels.diplomacy.request.detail.trade", {
        kind: TRADE_KIND_LABEL[request.tradeKind ?? "exchange"],
    }),
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

        setGameHtml(this.el, `
            ${panelHead({
                title: t("panels.diplomacy.title"),
                help: { title: t("panels.diplomacy.help.title"), body: t("panels.diplomacy.help.body") },
                helpAttrs: 'data-diplo-focus="objective"',
                status: gameText(`[[politics:${Math.floor(player.politicalPower)}]]`),
            })}
            <div class="panel-body diplo-body">
                ${this.relationsHtml()}
            </div>`);

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
        const from = this.engine.state.nations[request.from]?.name ?? t("panels.diplomacy.nation.fallback");
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
            lines.push(`<div class="trade-request-line"><span class="trade-side-label">${t("panels.diplomacy.trade.request.give")}</span>${transferList(receive, "out")}</div>`);
        } else {
            if (give.length) lines.push(`<div class="trade-request-line"><span class="trade-side-label">${t("panels.diplomacy.trade.provides")}</span>${transferList(give, "in")}</div>`);
            if (receive.length) lines.push(`<div class="trade-request-line"><span class="trade-side-label">${t("panels.diplomacy.trade.weProvide")}</span>${transferList(receive, "out")}</div>`);
        }
        lines.push(game`<p class="trade-request-note">${t("panels.diplomacy.trade.request.note", {
            cadence: cadenceToken("monthly"), days: TRADE_AGREEMENT_DAYS,
        })}</p>`);
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
                escapeGameText(t("panels.diplomacy.status.war.all", {
                    name: nation.name,
                    enemies: enemies.map((enemy) => enemy.name).join(t("common.listSeparator")),
                })),
            )}>${nationFlagHtmlFor(state, nationId, 18)}</span>`;
            const flags = enemies.map((enemy) => `<span class="diplo-status-flag" ${tooltipAttrs(
                escapeGameText(enemy.name),
                escapeGameText(t("panels.diplomacy.status.war.one", { name: nation.name, enemy: enemy.name })),
            )}>${nationFlagHtmlFor(state, enemy.id, 18)}</span>`).join("");
            rows.push(`<div class="diplo-status-row"><span class="icon-glyph diplo-status-icon diplo-status-icon--war" aria-hidden="true" ${iconMaskStyle("war")}></span><span class="diplo-status-items">${self}${flags}</span></div>`);
        }
        if (partners.length) {
            const flags = partners.map((partnerId) => {
                const partner = state.nations[partnerId];
                if (!partner) return "";
                const kinds = tradeResourceKinds(state, nationId, partnerId);
                const body = t("panels.diplomacy.status.trade", {
                    name: nation.name, partner: partner.name, count: kinds.length, kinds: resourceNames(kinds),
                });
                return `<span class="diplo-status-flag" ${tooltipAttrs(escapeGameText(partner.name), escapeGameText(body))}>${nationFlagHtmlFor(state, partnerId, 18)}</span>`;
            }).join("");
            rows.push(`<div class="diplo-status-row"><span class="icon-glyph diplo-status-icon diplo-status-icon--trade" aria-hidden="true" ${iconMaskStyle("trade")}></span><span class="diplo-status-items">${flags}</span></div>`);
        }
        if (overlord >= 0 || vassals.length) {
            const bits: string[] = [];
            if (overlord >= 0) {
                const lord = state.nations[overlord];
                bits.push(`<span class="diplo-status-vassal">${vassalTypeIcon(state, nationId)}<span class="diplo-status-flag" ${tooltipAttrs(
                    escapeGameText(lord?.name ?? t("panels.diplomacy.overlord.fallback")),
                    escapeGameText(t("panels.diplomacy.status.vassal.of", {
                        name: nation.name,
                        lord: lord?.name ?? "?",
                        type: VASSAL_PROFILES[vassalTypeOf(state, nationId) ?? "autonomous"].name,
                    })),
                )}>${nationFlagHtmlFor(state, overlord, 18)}</span></span>`);
            }
            for (const vassalId of vassals) {
                const vassal = state.nations[vassalId];
                if (!vassal) continue;
                bits.push(`<span class="diplo-status-vassal">${vassalTypeIcon(state, vassalId)}<span class="diplo-status-flag" ${tooltipAttrs(
                    escapeGameText(vassal.name),
                    escapeGameText(t("panels.diplomacy.status.vassal.of", {
                        name: vassal.name,
                        lord: nation.name,
                        type: VASSAL_PROFILES[vassalTypeOf(state, vassalId) ?? "autonomous"].name,
                    })),
                )}>${nationFlagHtmlFor(state, vassalId, 18)}</span></span>`);
            }
            rows.push(`<div class="diplo-status-row"><span class="diplo-status-items">${bits.join("")}</span></div>`);
        }
        return rows.length ? `<div class="diplo-status" aria-label="${t("panels.diplomacy.status.label")}">${rows.join("")}</div>` : "";
    }

    private requestsHtml(): string {
        const state = this.engine.state;
        const requests = state.diplomaticRequests.filter((request) => request.to === 0 && request.expiresDay > state.day);
        if (!requests.length) return "";
        const rows = requests.map((request) => {
            const from = state.nations[request.from];
            if (!from) return "";
            return game`<div class="diplo-request" data-request-id="${request.id}">
                <div class="diplo-request-head">${nationFlagHtmlFor(state, request.from, 20)}<b>${escapeHtml(this.requestTitle(request))}</b>
                    <span class="diplo-request-days">${t("panels.diplomacy.time.remaining", { days: Math.max(0, request.expiresDay - state.day) })}</span></div>
                <div class="diplo-request-body">${request.kind === "trade" ? this.tradeRequestDetailHtml(request) : escapeHtml(this.requestDetail(request))}</div>
                <div class="diplo-request-actions">
                    <button class="btn btn-primary" data-action="respond-request" data-request="${request.id}" data-accept="1" ${state.winner === null ? "" : "disabled"}>${t("panels.diplomacy.request.accept")}</button>
                    <button class="btn btn-outline" data-action="respond-request" data-request="${request.id}" data-accept="0" ${state.winner === null ? "" : "disabled"}>${t("panels.diplomacy.request.reject")}</button>
                </div>
            </div>`;
        }).join("");
        return `<div class="diplo-requests"><div class="diplo-requests-head">${t("panels.diplomacy.request.head")}</div>${rows}</div>`;
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
                upgradeTip = tooltipAttrs(t("panels.diplomacy.upgrade.label"), proposalCooldownTip(upgradeCooldown));
            } else if (upgradeTarget) {
                upgradeTip = canUpgrade
                    ? decisionTooltipAttrs(
                        t("panels.diplomacy.upgrade.confirmBody", {
                            lord: escapeGameText(state.nations[overlord]?.name ?? t("panels.diplomacy.overlord.fallback")),
                            profile: VASSAL_PROFILES[upgradeTarget].name,
                            cost: VASSAL_UPGRADE_COST,
                        }),
                        [{ decision: decideUpgrade(state, overlord, 0) }],
                    )
                    : tooltipAttrs(t("panels.diplomacy.upgrade.label"), t("panels.diplomacy.upgrade.requirement", {
                        cost: VASSAL_UPGRADE_COST, profile: VASSAL_PROFILES[upgradeTarget].name,
                    }));
            }
            const upgrade = upgradeTarget
                ? `<button class="btn btn-outline${upgradeCooldown > 0 ? " cooldown" : ""}" data-action="request-upgrade" ${upgradeCooldown > 0 ? 'aria-disabled="true"' : canUpgrade ? "" : "disabled"} ${upgradeTip}>${t("panels.diplomacy.upgrade.label")}</button>`
                : "";
            const tributeControl = type === "cooperative"
                ? `<div class="diplo-vassal-tribute"><span class="vassal-tribute-label">${t("panels.diplomacy.vassal.tributeLabel")}</span> ${Math.round(rate * 100)}%
                    <button class="btn btn-outline" data-action="tribute-rate" data-delta="-0.05" ${rate <= profile.resourceMin + 1e-9 ? "disabled" : ""}>-5%</button>
                    <button class="btn btn-outline" data-action="tribute-rate" data-delta="0.05" ${rate >= profile.resourceMax - 1e-9 ? "disabled" : ""}>+5%</button></div>`
                : "";
            return `<div class="diplo-vassal-self">
                <div class="diplo-vassal-head">${nationFlagHtmlFor(state, overlord, 22)}
                    <b>${t("panels.diplomacy.vassal.vassalOf", { name: escapeHtml(state.nations[overlord].name) })}</b>
                    ${vassalTypeIcon(state, 0)}
                    ${vassalIndependenceIcon(state, 0)}
                    ${helpButton({ title: t("panels.diplomacy.vassal.help.title"), body: VASSAL_HELP_BODY })}
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
                <button class="btn btn-outline" data-action="diplo-target" data-nation="${id}" data-diplo-focus="vassal-view-${id}" ${tooltipAttrs(t("panels.diplomacy.vassal.view"), t("panels.diplomacy.vassal.viewTip", { name: state.nations[id].name }))}>${t("panels.diplomacy.vassal.view")}</button>
            </div>`).join("");
        return `<div class="diplo-vassal-self">
            <div class="diplo-vassal-head">
                <b>${t("panels.diplomacy.vassal.owned", { count: vassals.length })}</b>
                ${helpButton({ title: t("panels.diplomacy.vassal.help.title"), body: VASSAL_HELP_BODY })}
                <button type="button" class="diplo-vassal-caret" data-vassal-collapse data-diplo-focus="vassal-collapse" aria-label="${this.vassalListCollapsed ? t("panels.diplomacy.vassal.expand") : t("panels.diplomacy.vassal.collapse")}">${this.vassalListCollapsed ? "▸" : "▾"}</button>
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
            const members = alliance.members.map((id) => state.nations[id]?.name ?? "?").join(t("common.listSeparator"));
            return `<div class="diplo-alliance">
                <div class="diplo-alliance-head"><b>${t("panels.diplomacy.alliance.label")}</b><span class="status-pill ready">${t("panels.diplomacy.alliance.memberCount", { count: alliance.members.length })}</span>${helpButton({ title: t("panels.diplomacy.alliance.help.title"), body: ALLIANCE_HELP_BODY })}</div>
                <p class="diplo-note">${t("panels.diplomacy.alliance.summary", { leader: escapeHtml(leader?.name ?? "?"), members: escapeHtml(members) })}</p>
                <button class="btn btn-outline" data-action="leave-alliance" ${tooltipAttrs(t("panels.diplomacy.alliance.leave"), t("panels.diplomacy.alliance.leave.tip", { days: REQUEST_COOLDOWN_DAYS }))}>${t("panels.diplomacy.alliance.leave")}</button>
            </div>`;
        }
        if (!canCreateAlliance(state, 0)) return "";
        return `<div class="diplo-alliance">
            <div class="diplo-alliance-head"><b>${t("panels.diplomacy.alliance.none")}</b>${helpButton({ title: t("panels.diplomacy.alliance.help.title"), body: ALLIANCE_HELP_BODY })}</div>
            <p class="diplo-note">${t("panels.diplomacy.alliance.create.note", { cost: ALLIANCE_CREATE_COST })}</p>
            <button class="btn btn-outline" data-action="create-alliance" ${tooltipAttrs(t("panels.diplomacy.alliance.create.label"), t("panels.diplomacy.alliance.create.tip", { cost: ALLIANCE_CREATE_COST }))}>${t("panels.diplomacy.alliance.create.label")}</button>
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
            const status = !nation.alive ? t("panels.diplomacy.status.dead")
                : war ? t("panels.diplomacy.status.atWar")
                    : truce ? t("panels.diplomacy.status.truce") : t("panels.diplomacy.status.ai");
            const controlledStates = state.states.filter((region) =>
                region.provinces.some((site) => state.provinces[site].owner === nation.id)).length;
            const tip = t("panels.diplomacy.nation.tip", {
                status,
                tendency: tendencyProfileOf(nation.tendency).name,
                armies: nationArmyCount(state, nation.id),
                states: controlledStates,
                provinces: nationProvinceCount(state, nation.id),
            });
            const color = nationDisplayColor(state, nation.id);
            return `<button class="diplo-swatch${selected ? " selected" : ""}${nation.alive ? "" : " dead"}${war ? " war" : ""}${truce ? " truce" : ""}" role="tab" aria-selected="${selected}"
                aria-label="${escapeHtml(t("panels.diplomacy.nation.swatchLabel", { name: nation.name, status }))}" style="--pc:${escapeHtml(color)}"
                data-action="diplo-target" data-nation="${nation.id}" data-diplo-focus="nation-${nation.id}"
                ${tooltipAttrs(escapeGameText(nation.name), tip)}>${nationFlagHtmlFor(state, nation.id, 22)}</button>`;
        }).join("");
        return `
            <div class="diplo-overview-stats">
                <span class="status-pill ready">${t("panels.diplomacy.overview.annexed", { count: conquered, total: others.length })}</span>
                <span class="status-pill ${wars ? "war" : "idle"}">${t("panels.diplomacy.overview.wars", { count: wars })}</span>
                <span class="status-pill ${ready ? "ready" : "idle"}">${t("panels.diplomacy.overview.ready", { count: ready })}</span>
            </div>
            ${this.requestsHtml()}
            ${this.selfVassalHtml()}
            ${this.selfAllianceHtml()}
            <div class="diplo-swatches" role="tablist" aria-label="${t("panels.diplomacy.overview.targets")}">${tabs}</div>
            ${state.winner !== null ? `<p class="diplo-requirement">${t("panels.diplomacy.overview.ended")}</p>` : ""}
            ${this.target !== null ? this.nationHtml(this.target) : `<p class="diplo-note">${t("panels.diplomacy.overview.noTarget")}</p>`}`;
    }

    private stateName(stateId: number | null): string {
        return stateId === null ? t("panels.diplomacy.state.unspecified")
            : this.engine.state.states[stateId]?.name ?? t("panels.diplomacy.state.invalid");
    }

    private actionLabel(action: DiplomaticAction): string {
        const scope = action.kind === "annex"
            ? this.engine.state.nations[action.target]?.name ?? t("panels.diplomacy.nation.targetFallback")
            : this.stateName(action.stateId);
        return t("panels.diplomacy.action.fullLabel", { label: DIPLOMATIC_PROFILES[action.kind].label, scope });
    }

    private projectsHtml(target: number): string {
        const state = this.engine.state;
        const projects = state.diplomaticActions.filter((action) => action.nation === 0 && action.target === target);
        if (!projects.length) return "";
        const chips = projects.map((action) => {
            const preparing = state.day < action.readyDay;
            const expired = state.day >= action.expiresDay;
            const ready = !preparing && !expired;
            const short = action.kind === "annex"
                ? t("panels.diplomacy.project.annex")
                : t("panels.diplomacy.project.conquest", { name: this.stateName(action.stateId) });
            const time = expired ? t("panels.diplomacy.project.expired")
                : preparing ? t("panels.diplomacy.time.remaining", { days: action.readyDay - state.day })
                    : t("panels.diplomacy.time.readyRemaining", { days: action.expiresDay - state.day });
            const status = expired ? t("panels.diplomacy.project.tip.expired")
                : preparing ? t("panels.diplomacy.project.tip.preparing")
                    : t("panels.diplomacy.project.tip.ready");
            const tip = t("panels.diplomacy.project.tip", {
                label: this.actionLabel(action), status,
                cancelHint: t("panels.diplomacy.project.cancelHint"),
            });
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
                tip: tooltipAttrs(t("panels.diplomacy.request.tooFrequent"), proposalCooldownTip(days)),
            }
            : { blocked: false, attrs: "", tip: normalTip };
    }

    /** Aid tooltip: qualitative reasons plus the verdict from the request's own decision function. */
    private aidTooltipAttrs(nationId: number): string {
        const state = this.engine.state;
        const nation = state.nations[nationId];
        const overlord = overlordOf(state, 0);
        const fallback = t("panels.diplomacy.overlord.fallback");
        const overlordName = overlord >= 0 ? state.nations[overlord]?.name ?? fallback : fallback;
        const description = t("panels.diplomacy.aid.tip", {
            nation: escapeGameText(nation.name),
            overlord: escapeGameText(overlordName),
            days: REQUEST_COOLDOWN_DAYS,
        });
        return decisionTooltipAttrs(description, [{ decision: decideAid(state, 0, nationId) }]);
    }

    private nationHtml(nationId: number): string {
        const state = this.engine.state;
        const nation = state.nations[nationId];
        const atWar = isAtWar(state, 0, nationId);
        const hasOffer = state.peaceOffers.includes(nationId);
        const truce = truceDays(state, 0, nationId);
        const status = !nation.alive ? t("panels.diplomacy.status.dead")
            : atWar ? t("panels.diplomacy.status.atWarDays", { days: warDuration(state, 0, nationId) })
                : truce > 0 ? t("panels.diplomacy.status.truceDays", { days: truce })
                    : t("panels.diplomacy.status.ai");
        const summary = nationStats(state, nationId);
        const head = `<div class="diplo-head">${nationFlagHtmlFor(state, nation.id, 26)}<span class="diplo-name">${escapeHtml(nation.name)}</span><span class="status-pill ${!nation.alive ? "dead" : atWar ? "war" : "idle"}">${status}</span></div>`;
        const stats = nationOverviewBody(state, summary, " diplo-kv");
        const base = `${head}${stats}<div class="diplo-divider"></div>`;
        if (!nation.alive) return `<div class="diplo-row dead diplo-card" data-diplo-card="${nationId}" tabindex="-1">${base}${this.projectsHtml(nationId)}</div>`;

        const ready = this.readyActions(nationId);
        const claimCount = state.claims.filter((claim) => claim.nation === 0 &&
            state.states[claim.stateId]?.provinces.some((site) => state.provinces[site].legalOwner === nationId)).length;
        const declareTip = ready.length
            ? t("panels.diplomacy.declare.tip.ready")
            : truce > 0 ? t("panels.diplomacy.declare.tip.truce", { days: truce })
                : t("panels.diplomacy.declare.tip.none", { count: claimCount });
        const declareBtn = `<button class="btn btn-primary" data-action="declare-open" data-nation="${nationId}" data-diplo-focus="declare-${nationId}" ${ready.length && state.winner === null ? "" : "disabled"} ${tooltipAttrs(t("panels.diplomacy.declare.label"), declareTip)}>${t("panels.diplomacy.declare.label")}</button>`;

        const preparing = state.diplomaticActions.some((action) => action.nation === 0 && action.target === nationId && state.day < action.readyDay);
        const craftLabel = preparing ? t("panels.diplomacy.craft.stop") : t("panels.diplomacy.craft.start");
        const craftTip = preparing
            ? t("panels.diplomacy.craft.tip.stop")
            : t("panels.diplomacy.craft.tip.start");
        const craftBtn = `<button class="btn btn-outline" data-action="diplo-menu-open" data-nation="${nationId}" data-diplo-focus="menu-${nationId}" ${atWar || state.winner !== null ? "disabled" : ""} ${tooltipAttrs(craftLabel, atWar ? t("panels.diplomacy.craft.tip.atWar") : craftTip)}>${craftLabel}</button>`;

        let goalHtml = "";
        const actionButtons: string[] = [craftBtn];
        if (atWar) {
            const war = state.wars.find((item) => (item.aggressor === 0 && item.defender === nationId) || (item.aggressor === nationId && item.defender === 0));
            if (war) {
                const progress = warGoalProgress(state, war);
                const ours = war.aggressor === 0;
                const goal = war.goal === "annex" ? t("panels.diplomacy.goal.annex")
                    : t("panels.diplomacy.goal.conquest", { name: this.stateName(war.stateId) });
                const requirement = war.goal === "annex"
                    ? t("panels.diplomacy.goal.requirement.annex")
                    : t("panels.diplomacy.goal.requirement.conquest");
                goalHtml = `<div class="diplo-goal" ${tooltipAttrs(t("panels.diplomacy.goal.title"), escapeGameText(requirement))}>${t("panels.diplomacy.goal.summary", {
                    side: ours ? t("panels.diplomacy.goal.ours") : t("panels.diplomacy.goal.theirs"),
                    goal: escapeHtml(goal), held: progress.held, total: progress.total,
                    enforceNote: progress.canEnforce ? t("panels.diplomacy.goal.enforceNote") : "",
                })}</div>`;
                if (ours) actionButtons.push(`<button class="btn btn-outline" data-action="enforce-war-goal" data-nation="${nationId}" data-diplo-focus="enforce-${nationId}" ${progress.canEnforce && state.winner === null ? "" : "disabled"} ${tooltipAttrs(t("panels.diplomacy.goal.enforce.label"), t("panels.diplomacy.goal.enforce.tip"))}>${t("panels.diplomacy.goal.enforce.button")}</button>`);
                if (ours && war.goal === "annex") actionButtons.push(`<button class="btn btn-outline" data-action="enforce-vassal" data-nation="${nationId}" data-diplo-focus="enforce-vassal-${nationId}" ${progress.canEnforce && state.winner === null ? "" : "disabled"} ${tooltipAttrs(t("panels.diplomacy.goal.vassalize.label"), t("panels.diplomacy.goal.vassalize.tip"))}>${t("panels.diplomacy.goal.vassalize.label")}</button>`);
            }
            actionButtons.push(hasOffer
                ? `<button class="btn btn-outline" data-action="accept-peace" data-nation="${nationId}" data-diplo-focus="accept-${nationId}" ${state.winner === null ? "" : "disabled"} ${tooltipAttrs(t("panels.diplomacy.peace.accept.label"), t("panels.diplomacy.peace.accept.tip"))}>${t("panels.diplomacy.peace.accept.label")}</button><button class="btn btn-outline" data-action="reject-peace" data-nation="${nationId}" data-diplo-focus="reject-${nationId}" ${state.winner === null ? "" : "disabled"} ${tooltipAttrs(t("panels.diplomacy.peace.reject.label"), t("panels.diplomacy.peace.reject.tip"))}>${t("panels.diplomacy.peace.reject.button")}</button>`
                : `<button class="btn btn-outline" data-action="propose-peace" data-nation="${nationId}" data-diplo-focus="peace-${nationId}" ${state.winner === null ? "" : "disabled"} ${decisionTooltipAttrs(t("panels.diplomacy.peace.propose.white", { name: escapeGameText(nation.name) }), [{ decision: decidePeace(state, nationId, 0) }])}>${t("panels.diplomacy.peace.propose.label")}</button>`);
        } else {
            actionButtons.push(`<button class="btn btn-outline" data-action="propose-peace" data-nation="${nationId}" data-diplo-focus="peace-${nationId}" disabled ${tooltipAttrs(t("panels.diplomacy.peace.propose.label"), t("panels.diplomacy.peace.propose.disabledTip"))}>${t("panels.diplomacy.peace.propose.label")}</button>`);
            actionButtons.push(declareBtn);
        }
        // All vassal and alliance actions share the card's single 外交行动 row.
        actionButtons.push(...this.vassalActionsHtml(nationId));
        // A vassal's foreign-aid request targets the nation on this card. Only
        // valid helpers qualify — the overlord is never a candidate.
        if (canRequestAid(state, 0) && aidCandidates(state, 0).includes(nationId)) {
            const gate = this.requestGate("aid", nationId, this.aidTooltipAttrs(nationId));
            actionButtons.push(`<button class="btn btn-outline${gate.blocked ? " cooldown" : ""}" data-action="request-aid" data-nation="${nationId}" ${gate.blocked ? gate.attrs : state.winner === null ? "" : "disabled"} ${gate.tip}>${t("panels.diplomacy.aid.label")}</button>`);
        }

        return `<div class="diplo-row diplo-card${hasOffer ? " offer" : ""}" data-diplo-card="${nationId}" tabindex="-1">
            ${base}
            ${this.statusBarHtml(nationId)}
            <div class="diplo-actions-head">${t("panels.diplomacy.actions.head")}</div>
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
                `<button class="btn btn-outline" data-action="release-vassal" data-nation="${nationId}" ${tooltipAttrs(t("panels.diplomacy.vassal.release.label"), t("panels.diplomacy.vassal.release.tip"))}>${t("panels.diplomacy.vassal.release.label")}</button>`,
                `<button class="btn btn-outline" data-action="vassal-type-open" data-nation="${nationId}" data-type="${type ?? ""}" ${tooltipAttrs(t("panels.diplomacy.vassal.changeType.label"), t("panels.diplomacy.vassal.changeType.tip"))}>${t("panels.diplomacy.vassal.changeType.label")}</button>`,
            ];
            if (canAnnexVassal(state, 0, nationId)) {
                actions.push(`<button class="btn btn-outline" data-action="annex-vassal" data-nation="${nationId}" ${tooltipAttrs(t("panels.diplomacy.vassal.annex.label"), t("panels.diplomacy.vassal.annex.tip"))}>${t("panels.diplomacy.vassal.annex.label")}</button>`);
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
                actions.push(`<button class="btn btn-outline cooldown" data-action="vassal-request" data-nation="${nationId}" aria-disabled="true" ${tooltipAttrs(t("panels.diplomacy.vassal.offer.label"), proposalCooldownTip(cooldown))}>${t("panels.diplomacy.vassal.offer.button")}</button>`);
            } else {
                const offerTip = decisionTooltipAttrs(
                    t("panels.diplomacy.vassal.offer.tip", { name: escapeGameText(state.nations[nationId].name) }),
                    [
                        { title: t("panels.diplomacy.vassal.type.cooperative"), decision: decideVassalOffer(state, nationId, 0, "cooperative") },
                        { title: t("panels.diplomacy.vassal.type.autonomous"), decision: decideVassalOffer(state, nationId, 0, "autonomous") },
                    ],
                );
                actions.push(`<details class="diplo-submenu">
                    <summary ${offerTip}>${t("panels.diplomacy.vassal.offer.button")}</summary>
                    <div class="diplo-submenu-body">
                        <label class="diplo-radio"><input type="radio" name="vassal-type-${nationId}" value="cooperative" checked />
                            <span><b>${t("panels.diplomacy.vassal.type.cooperative")}</b>${t("panels.diplomacy.vassal.offer.cooperativeNote")}</span></label>
                        <label class="diplo-radio"><input type="radio" name="vassal-type-${nationId}" value="autonomous" />
                            <span><b>${t("panels.diplomacy.vassal.type.autonomous")}</b>${t("panels.diplomacy.vassal.offer.autonomousNote")}</span></label>
                        <button class="btn btn-primary" data-action="vassal-request" data-nation="${nationId}" ${tooltipAttrs(t("panels.diplomacy.vassal.offer.label"), t("panels.diplomacy.vassal.offer.submitTip"))}>${t("panels.diplomacy.vassal.offer.submit")}</button>
                    </div>
                </details>`);
            }
        }
        if (canDemand) {
            const cooldown = requestCooldownDays(state, "vassalize", nationId);
            const demandTip = cooldown > 0
                ? tooltipAttrs(t("panels.diplomacy.vassal.demand.label"), proposalCooldownTip(cooldown))
                : decisionTooltipAttrs(
                    t("panels.diplomacy.vassal.demand.tip", { name: escapeGameText(state.nations[nationId].name) }),
                    [{ decision: decideVassalDemand(state, 0, nationId) }],
                );
            actions.push(`<button class="btn btn-outline${cooldown > 0 ? " cooldown" : ""}" data-action="vassal-demand" data-nation="${nationId}" ${cooldown > 0 ? 'aria-disabled="true"' : ""} ${demandTip}>${t("panels.diplomacy.vassal.demand.label")}</button>`);
        }
        return actions;
    }

    private allianceActionsHtml(nationId: number): string {
        const state = this.engine.state;
        if (state.winner !== null) return "";
        const myAlliance = allianceOf(state, 0);
        const targetAlliance = allianceOf(state, nationId);
        if (myAlliance && targetAlliance && myAlliance.id === targetAlliance.id) {
            return `<p class="diplo-note">${t("panels.diplomacy.alliance.allyNote")}</p>`;
        }
        if (myAlliance && myAlliance.leader === 0 && canInviteToAlliance(state, 0, nationId)) {
            const inviteTip = decisionTooltipAttrs(
                t("panels.diplomacy.alliance.invite.tip", { name: escapeGameText(state.nations[nationId].name) }),
                [{ decision: decideAllianceInvite(state, 0, nationId) }],
            );
            const gate = this.requestGate("alliance", nationId, inviteTip);
            return `<div class="diplo-alliance-section"><div class="diplo-actions-head">${t("panels.diplomacy.alliance.section")}</div>
                <button class="btn btn-outline${gate.blocked ? " cooldown" : ""}" data-action="invite-alliance" data-nation="${nationId}" ${gate.attrs} ${gate.tip}>${t("panels.diplomacy.alliance.invite.label")}</button>
            </div>`;
        }
        if (!myAlliance && targetAlliance && overlordOf(state, 0) < 0) {
            const leader = state.nations[targetAlliance.leader];
            const joinTip = decisionTooltipAttrs(
                t("panels.diplomacy.alliance.join.tip", {
                    leader: escapeGameText(leader?.name ?? t("panels.diplomacy.alliance.leaderFallback")),
                    days: REQUEST_COOLDOWN_DAYS,
                }),
                [{ decision: decideJoinRequest(state, targetAlliance.leader, 0) }],
            );
            const gate = this.requestGate("alliance", targetAlliance.leader, joinTip);
            return `<div class="diplo-alliance-section"><div class="diplo-actions-head">${t("panels.diplomacy.alliance.section")}</div>
                <button class="btn btn-outline${gate.blocked ? " cooldown" : ""}" data-action="join-alliance" data-leader="${targetAlliance.leader}" ${gate.attrs} ${gate.tip}>${t("panels.diplomacy.alliance.join.label")}</button>
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
        setGameHtml(scrim, `<div class="diplo-menu" role="dialog" aria-label="${t("panels.diplomacy.actions.dialogLabel", { name: escapeHtml(nation.name) })}" tabindex="-1"></div>`);
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
            const time = expired ? t("panels.diplomacy.project.expired")
                : preparing ? t("panels.diplomacy.time.preparingRemaining", { days: action.readyDay - state.day })
                    : t("panels.diplomacy.time.readyRemaining", { days: action.expiresDay - state.day });
            const refundNote = expired ? t("panels.diplomacy.refund.clear")
                : preparing ? t("panels.diplomacy.refund.cancel", { refund, spent })
                    : t("panels.diplomacy.refund.abandon");
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
            return game`<label class="diplo-menu-row">
                <input type="checkbox" data-role="craft" data-kind="conquest" data-state="${region.id}" ${picked ? "checked" : ""} ${allowed ? "" : "disabled"} />
                <span class="diplo-menu-main"><b>${t("panels.diplomacy.craft.conquest", { name: escapeHtml(region.name) })}</b><span>${t("panels.diplomacy.craft.cost", { cost: profile.cost, days: profile.days, upkeep: profile.upkeep })}</span></span>
            </label>`;
        }).join("");
        const annexAllowed = !atWar && this.craftAllowed("annex", nationId, null);
        const annexPicked = this.menuCraft?.kind === "annex";
        const annexProfile = DIPLOMATIC_PROFILES.annex;
        const annexRow = game`<label class="diplo-menu-row">
            <input type="checkbox" data-role="craft" data-kind="annex" ${annexPicked ? "checked" : ""} ${annexAllowed ? "" : "disabled"} />
            <span class="diplo-menu-main"><b>${t("panels.diplomacy.craft.annex", { name: escapeHtml(nation?.name ?? "?") })}</b><span>${t("panels.diplomacy.craft.costAnnex", { cost: annexProfile.cost, days: annexProfile.days, upkeep: annexProfile.upkeep })}</span></span>
        </label>`;

        const craftBlockReason = atWar ? t("panels.diplomacy.craft.block.war")
            : state.winner !== null ? t("panels.diplomacy.craft.block.ended")
                : projects.some((action) => state.day < action.readyDay && !this.menuCancels.has(action.id))
                    ? t("panels.diplomacy.craft.block.busy")
                    : "";
        const delta = (this.menuCraft ? -DIPLOMATIC_PROFILES[this.menuCraft.kind].cost : 0)
            + [...this.menuCancels].reduce((sum, id) => {
                const action = projects.find((item) => item.id === id);
                return sum + (action ? cancelRefund(state, action) : 0);
            }, 0);
        const changed = this.menuCancels.size > 0 || this.menuCraft !== null;

        setGameHtml(card, `
            <div class="diplo-menu-head"><span>${t("panels.diplomacy.actions.dialogLabel", { name: escapeHtml(nation?.name ?? "?") })}</span><button class="diplo-menu-x" data-menu-close aria-label="${t("panels.diplomacy.menu.close")}">×</button></div>
            <p class="diplo-menu-note">${t("panels.diplomacy.menu.note")}</p>
            <div class="diplo-menu-section">${t("panels.diplomacy.menu.section.current")}</div>
            ${projectRows || `<p class="diplo-menu-empty">${t("panels.diplomacy.menu.empty.current")}</p>`}
            <div class="diplo-menu-section">${t("panels.diplomacy.menu.section.new")}</div>
            ${craftBlockReason ? `<p class="diplo-menu-empty">${escapeHtml(craftBlockReason)}</p>` : ""}
            ${craftRows || `<p class="diplo-menu-empty">${t("panels.diplomacy.menu.empty.claims")}</p>`}
            ${annexRow}
            <div class="diplo-menu-foot">
                <span class="diplo-menu-delta ${delta > 0 ? "pos" : delta < 0 ? "neg" : ""}">${t("panels.diplomacy.menu.delta", { sign: delta > 0 ? "+" : "", amount: delta })}</span>
                <button class="btn btn-primary" data-menu-confirm ${changed && state.winner === null ? "" : "disabled"}>${t("panels.diplomacy.menu.confirm")}</button>
                <button class="btn" data-menu-close>${t("panels.diplomacy.menu.cancel")}</button>
            </div>`);
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
        if (cancelled) parts.push(t("panels.diplomacy.toast.cancelled", { count: cancelled }));
        if (crafted) parts.push(t("panels.diplomacy.toast.crafted"));
        this.hooks.toast(parts.length ? parts.join(t("panels.diplomacy.toast.separator")) : t("panels.diplomacy.toast.none"));
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
        pop.setAttribute("aria-label", t("panels.diplomacy.declare.ariaLabel", {
            name: this.engine.state.nations[nationId]?.name ?? t("panels.diplomacy.declare.targetFallback"),
        }));
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
            const scope = action.kind === "annex" ? t("panels.diplomacy.goal.annex")
                : t("panels.diplomacy.goal.conquest", { name: this.stateName(action.stateId) });
            return game`<button class="declare-option${picked ? " picked" : ""}" data-pick="${action.id}" aria-pressed="${picked}">
                <b>${escapeHtml(scope)}</b><span>${t("panels.diplomacy.declare.valid", { days: action.expiresDay - state.day })}</span>
            </button>`;
        }).join("");
        setGameHtml(this.declarePop, `
            <div class="declare-head"><span>${t("panels.diplomacy.declare.title", { name: escapeHtml(nation?.name ?? "?") })}</span><button class="declare-x" data-close aria-label="${t("panels.diplomacy.declare.close")}">×</button></div>
            <p class="declare-hint">${t("panels.diplomacy.declare.hint")}</p>
            <div class="declare-options">${options}</div>
            <button class="btn btn-primary declare-confirm" data-action="declare" data-nation="${this.declareNation}" ${this.declarePick === null ? "disabled" : `data-diplomatic-id="${this.declarePick}"`}>${t("panels.diplomacy.declare.confirm")}</button>`);
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