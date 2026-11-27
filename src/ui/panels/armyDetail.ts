import type { GameEngine } from "../../game/engine.ts";
import type { GameState } from "../../game/types/state.ts";
import type { Army } from "../../game/types/organization.ts";
import { isArmyAutoManaged } from "../../game/auto.ts";
import { battleForecast } from "../../game/battle.ts";
import { armyCap, armyMp, nationArmyCount, redeployTargets, regimentHp } from "../../game/rules.ts";
import { MAX_HP, REGIMENT_CAP, UNIT_PROFILES } from "../../game/types/unit.ts";
import { ORG_MAX } from "../../game/types/organization.ts";
import { orgClass, orgPct, statusPill } from "../common.ts";
import { html, iconMaskStyle, rawHtml } from "../text.ts";
import { panelHead, PanelShell } from "../panel.ts";
import type { PanelView } from "../panel.ts";
import { scopedTexts } from "../view.ts";
import { t } from "../../i18n/index.ts";

function armyDetailTexts() {
    const s = scopedTexts("panels.armyDetail.", {
        help: ["help"],
        helpTitle: ["helpTitle"],
        noSplitAuto: ["noSplitAuto"],
        attack: ["attack"],
        marchTo: ["marchTo"],
        cancelMarch: ["cancelMarch"],
        battleHere: ["battleHere"],
        autoTitle: ["autoTitle"],
        autoNote: ["autoNote"],
        unmanage: ["unmanage"],
        split: ["split"],
        splitHint: ["splitHint"],
        wait: ["wait"],
        redeploy: ["redeploy"],
        cancelRedeploy: ["cancelRedeploy"],
        disband: ["disband"],
        autoCannotAttack: ["autoCannotAttack"],
        noTargets: ["noTargets"],
        mergeHint: ["mergeHint"],
        managedPill: ["managedPill"],
        close: ["close"],
        orgHint: ["orgHint"],
    });
    return {
        ...s,
        regTitle: (params: { name: string; hp: number; maxHp: number; org: number; maxOrg: number; autoNote: string }) =>
            t("panels.armyDetail.regTitle", params),
        selectForSplit: (name: string) => t("panels.armyDetail.selectForSplit", { name }),
        regStats: (atk: number, def: number, mp: number) => t("panels.armyDetail.regStats", { atk, def, mp }),
        attackTarget: (name: string) => t("panels.armyDetail.attackTarget", { name }),
        odds: (attack: number, defense: number, occupiedNote: string) =>
            t("panels.armyDetail.odds", { attack, defense, occupiedNote }),
        splitCount: (count: number) => t("panels.armyDetail.splitCount", { count }),
        orgTitle: (org: number) => t("panels.armyDetail.orgTitle", { org, max: ORG_MAX }),
        orgLabel: (org: number) => t("panels.armyDetail.orgLabel", { org, max: ORG_MAX }),
        armyMeta: (count: number, hp: number, mobility: number) =>
            t("panels.armyDetail.armyMeta", { count, cap: REGIMENT_CAP, hp, mobility }),
    };
}

export interface ArmyDetailViewContext {
    readonly state: GameState;
    readonly army: Army;
    readonly splitChecks: ReadonlySet<number>;
    readonly targets: readonly number[];
    readonly occupied: ReadonlySet<number>;
}

/** Pure view builder for the per-regiment command window. */
export function armyDetailView(ctx: ArmyDetailViewContext): PanelView {
    const { state, army, splitChecks, targets, occupied } = ctx;
    const text = armyDetailTexts();
    const auto = isArmyAutoManaged(state, army);
    const battle = state.battles.find(
        (entry) => entry.attackerId === army.id || entry.defenderId === army.id,
    );
    const redeploying = state.redeployArmyId === army.id;
    const canRedeploy = !auto && !army.moved && !army.acted && !battle && redeployTargets(state, army).size > 0;
    const canSplit = !auto && !battle && !army.moved && !army.acted
        && splitChecks.size > 0 && splitChecks.size < army.regiments.length
        && nationArmyCount(state, 0) < armyCap(state, 0);

    const regRows = army.regiments.map((regiment) => {
        const up = UNIT_PROFILES[regiment.kind];
        const hpPct = Math.max(0, Math.min(100, (regiment.hp / MAX_HP) * 100));
        const checked = splitChecks.has(regiment.id);
        const disabled = auto || battle || army.moved || army.acted ? " disabled" : "";
        const title = text.regTitle({
            name: up.name, hp: regiment.hp, maxHp: MAX_HP,
            org: Math.round(army.org), maxOrg: ORG_MAX,
            autoNote: auto ? text.noSplitAuto : "",
        });
        return html`<label class="reg-row" title="${title}">
            <input type="checkbox" data-action="split-check" data-reg="${regiment.id}" ${rawHtml(checked ? "checked" : "")} ${rawHtml(disabled)} aria-label="${text.selectForSplit(up.name)}" />
            <span class="reg-glyph">${up.glyph}</span>
            <span class="reg-name">${up.name}</span>
            <span class="reg-hp"><i style="width:${hpPct}%"></i></span>
            <span class="reg-hp-num">${regiment.hp}</span>
            <span class="reg-stats">${text.regStats(up.atk, up.def, up.mp)}</span>
            <span class="reg-org">${Math.round(army.org)}</span>
        </label>`;
    }).join("");

    const marchHtml = army.march ? html`<div class="march-note">
        ${army.march.attack ? text.attack : text.marchTo} ${state.provinces[army.march.target].name}
        ${auto ? "" : rawHtml(html`<button class="btn btn-sm" data-action="march-cancel">${text.cancelMarch}</button>`)}
    </div>` : "";

    const attackHtml = targets.map((target) => {
        const forecast = battleForecast(state, army, target);
        const favorable = forecast.attackPower >= forecast.defensePower;
        const occupiedNow = occupied.has(target);
        return html`<button class="btn assault-btn${favorable ? " favorable" : " risky"}" data-action="attack" data-site="${target}" ${rawHtml(occupiedNow ? " disabled" : "")}>
            <span>${text.attackTarget(state.provinces[target].name)}</span>
            <span class="assault-odds">${text.odds(
                Math.round(forecast.attackPower),
                Math.round(forecast.defensePower),
                occupiedNow ? text.battleHere : "",
            )}</span>
        </button>`;
    }).join("");

    const autoNote = auto ? html`<div class="auto-manage-note">
        <b>${text.autoTitle}</b>
        <span>${text.autoNote}</span>
        <button class="btn btn-sm" data-action="army-auto-toggle" data-army="${army.id}">${text.unmanage}</button>
    </div>` : "";
    const splitRow = auto ? "" : html`<div class="split-row">
        <button class="btn btn-sm" data-action="split" ${rawHtml(canSplit ? "" : " disabled")}>${text.split}${splitChecks.size > 0 ? ` ${text.splitCount(splitChecks.size)}` : ""}</button>
        <span class="micro-hint">${text.splitHint}</span>
    </div>`;
    const actionRow = auto ? "" : html`<div class="action-row">
        <button class="btn" data-action="wait" ${rawHtml(army.acted ? " disabled" : "")}>${text.wait}</button>
        <button class="btn" data-action="${redeploying ? "redeploy-cancel" : "redeploy"}" ${rawHtml(redeploying || canRedeploy ? "" : " disabled")}>${redeploying ? text.cancelRedeploy : text.redeploy}</button>
        <button class="btn" data-action="disband" ${rawHtml(battle ? " disabled" : "")}>${text.disband}</button>
    </div>`;
    const assault = auto
        ? html`<p class="micro-hint">${text.autoCannotAttack}</p>`
        : attackHtml ? html`<div class="assault-list">${rawHtml(attackHtml)}</div>`
            : battle ? "" : html`<p class="micro-hint">${text.noTargets}</p>`;
    const mergeHint = auto ? "" : html`<p class="micro-hint">${text.mergeHint}</p>`;

    const managedPill = auto ? html`<span class="status-pill auto">${text.managedPill}</span>` : "";
    const extras = html`${rawHtml(statusPill(state, army, false))}${rawHtml(managedPill)}<button class="detail-close" data-action="detail-close" title="${text.close}" aria-label="${text.close}">✕</button>`;
    const head = panelHead({
        title: army.name,
        help: { title: text.helpTitle, body: text.help },
        extras: extras,
    });

    return {
        head,
        body: html`${rawHtml(autoNote)}
            <div class="detail-org">
                <span class="org-v big ${orgClass(army.org)}" title="${text.orgTitle(Math.round(army.org))}"><i style="height:${orgPct(army.org)}%"></i></span>
                <div class="detail-org-info">
                    <b>${text.orgLabel(Math.round(army.org))}</b>
                    <span>${text.orgHint}</span>
                </div>
                <span class="army-meta">${text.armyMeta(army.regiments.length, regimentHp(army), armyMp(army))}</span>
            </div>
            <div class="detail-loc"><span class="icon-glyph detail-loc-icon" aria-hidden="true" ${rawHtml(iconMaskStyle("location"))}></span>${state.provinces[army.province].name}</div>
            <div class="reg-list">${rawHtml(regRows)}</div>
            ${rawHtml(splitRow)}
            ${rawHtml(marchHtml)}
            ${rawHtml(actionRow)}
            ${rawHtml(assault)}
            ${rawHtml(mergeHint)}`,
    };
}

/** Per-regiment command window (top-left, command mode only). */
export class ArmyDetailPanel {
    private readonly engine: GameEngine;
    private readonly splitChecks: Set<number>;
    private readonly shell = new PanelShell(document.querySelector<HTMLElement>("#army-detail") as HTMLElement);

    constructor(engine: GameEngine, splitChecks: Set<number>) {
        this.engine = engine;
        this.splitChecks = splitChecks;
    }

    hide(): void {
        this.shell.hide();
        this.shell.clear();
    }

    render(): void {
        const state = this.engine.state;
        const army = this.engine.selectedArmy();
        if (!army || army.nation !== 0 || state.winner !== null) {
            this.hide();
            return;
        }
        const auto = isArmyAutoManaged(state, army);
        const battle = state.battles.some(
            (entry) => entry.attackerId === army.id || entry.defenderId === army.id,
        );
        const targets = auto || battle ? [] : this.engine.targetsFor(army);
        const occupied = new Set(targets.filter((site) => this.engine.battleAt(site) !== null));
        this.shell.show();
        this.shell.render(armyDetailView({ state, army, splitChecks: this.splitChecks, targets, occupied }));
    }
}
