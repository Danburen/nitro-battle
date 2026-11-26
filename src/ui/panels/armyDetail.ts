import type { GameEngine } from "../../game/engine.ts";
import { isArmyAutoManaged } from "../../game/auto.ts";
import { battleForecast } from "../../game/battle.ts";
import { armyCap, armyMp, nationArmyCount, redeployTargets, regimentHp } from "../../game/rules.ts";
import { MAX_HP, REGIMENT_CAP, UNIT_PROFILES } from "../../game/types/unit.ts";
import { ORG_MAX } from "../../game/types/organization.ts";
import { orgClass, orgPct, statusPill } from "../common.ts";
import { iconMaskStyle, setGameHtml } from "../text.ts";
import { panelHead } from "../panel.ts";
import { t } from "../../i18n/index.ts";

const ARMY_DETAIL_TIP = {
    get body(): string { return t("panels.armyDetail.help"); },
};

/** Per-regiment command window (top-left, command mode only). */
export class ArmyDetailPanel {
    private readonly engine: GameEngine;
    private readonly splitChecks: Set<number>;
    private readonly el = document.querySelector<HTMLElement>("#army-detail") as HTMLElement;

    constructor(engine: GameEngine, splitChecks: Set<number>) {
        this.engine = engine;
        this.splitChecks = splitChecks;
    }

    hide(): void {
        this.el.classList.add("hidden");
        setGameHtml(this.el, "");
    }

    render(): void {
        const state = this.engine.state;
        const army = this.engine.selectedArmy();
        if (!army || army.nation !== 0 || state.winner !== null) {
            this.hide();
            return;
        }
        this.el.classList.remove("hidden");

        const auto = isArmyAutoManaged(state, army);
        const battle = state.battles.find(
            (entry) => entry.attackerId === army.id || entry.defenderId === army.id,
        );
        const redeploying = state.redeployArmyId === army.id;
        const canRedeploy = !auto && !army.moved && !army.acted && !battle && redeployTargets(state, army).size > 0;
        const canSplit = !auto && !battle && !army.moved && !army.acted
            && this.splitChecks.size > 0 && this.splitChecks.size < army.regiments.length
            && nationArmyCount(state, 0) < armyCap(state, 0);

        const regRows = army.regiments.map((regiment) => {
            const up = UNIT_PROFILES[regiment.kind];
            const hpPct = Math.max(0, Math.min(100, (regiment.hp / MAX_HP) * 100));
            const checked = this.splitChecks.has(regiment.id);
            return `
                <label class="reg-row" title="${t("panels.armyDetail.regTitle", { name: up.name, hp: regiment.hp, maxHp: MAX_HP, org: Math.round(army.org), maxOrg: ORG_MAX, autoNote: auto ? t("panels.armyDetail.noSplitAuto") : "" })}">
                    <input type="checkbox" data-action="split-check" data-reg="${regiment.id}" ${checked ? "checked" : ""} ${auto || battle || army.moved || army.acted ? "disabled" : ""} aria-label="${t("panels.armyDetail.selectForSplit", { name: up.name })}" />
                    <span class="reg-glyph">${up.glyph}</span>
                    <span class="reg-name">${up.name}</span>
                    <span class="reg-hp"><i style="width:${hpPct}%"></i></span>
                    <span class="reg-hp-num">${regiment.hp}</span>
                    <span class="reg-stats">${t("panels.armyDetail.regStats", { atk: up.atk, def: up.def, mp: up.mp })}</span>
                    <span class="reg-org">${Math.round(army.org)}</span>
                </label>`;
        }).join("");

        const marchHtml = army.march
            ? `<div class="march-note">
                    ${t(army.march.attack ? "panels.armyDetail.attack" : "panels.armyDetail.marchTo")} ${state.provinces[army.march.target].name}
                    ${auto ? "" : `<button class="btn btn-sm" data-action="march-cancel">${t("panels.armyDetail.cancelMarch")}</button>`}
                </div>`
            : "";

        const targets = auto || battle ? [] : this.engine.targetsFor(army);
        const attackHtml = targets.map((target) => {
            const forecast = battleForecast(state, army, target);
            const favorable = forecast.attackPower >= forecast.defensePower;
            const occupied = this.engine.battleAt(target) !== null;
            return `
                <button class="btn assault-btn${favorable ? " favorable" : " risky"}" data-action="attack" data-site="${target}" ${occupied ? "disabled" : ""}>
                    <span>${t("panels.armyDetail.attackTarget", { name: state.provinces[target].name })}</span>
                    <span class="assault-odds">${t("panels.armyDetail.odds", { attack: Math.round(forecast.attackPower), defense: Math.round(forecast.defensePower), occupiedNote: occupied ? t("panels.armyDetail.battleHere") : "" })}</span>
                </button>`;
        }).join("");

        const autoNote = auto ? `<div class="auto-manage-note">
                <b>${t("panels.armyDetail.autoTitle")}</b>
                <span>${t("panels.armyDetail.autoNote")}</span>
                <button class="btn btn-sm" data-action="army-auto-toggle" data-army="${army.id}">${t("panels.armyDetail.unmanage")}</button>
            </div>` : "";
        const splitRow = auto ? "" : `<div class="split-row">
                    <button class="btn btn-sm" data-action="split" ${canSplit ? "" : "disabled"}>${t("panels.armyDetail.split")}${this.splitChecks.size > 0 ? ` ${t("panels.armyDetail.splitCount", { count: this.splitChecks.size })}` : ""}</button>
                    <span class="micro-hint">${t("panels.armyDetail.splitHint")}</span>
                </div>`;
        const actionRow = auto ? "" : `<div class="action-row">
                    <button class="btn" data-action="wait" ${army.acted ? "disabled" : ""}>${t("panels.armyDetail.wait")}</button>
                    <button class="btn" data-action="${redeploying ? "redeploy-cancel" : "redeploy"}" ${redeploying || canRedeploy ? "" : "disabled"}>
                        ${t(redeploying ? "panels.armyDetail.cancelRedeploy" : "panels.armyDetail.redeploy")}
                    </button>
                    <button class="btn" data-action="disband" ${battle ? "disabled" : ""}>${t("panels.armyDetail.disband")}</button>
                </div>`;
        const assault = auto
            ? `<p class="micro-hint">${t("panels.armyDetail.autoCannotAttack")}</p>`
            : attackHtml
                ? `<div class="assault-list">${attackHtml}</div>`
                : battle
                    ? ""
                    : `<p class="micro-hint">${t("panels.armyDetail.noTargets")}</p>`;
        const mergeHint = auto ? "" : `<p class="micro-hint">${t("panels.armyDetail.mergeHint")}</p>`;

        setGameHtml(this.el, `
            ${panelHead({
                title: army.name,
                help: { title: t("panels.armyDetail.helpTitle"), body: ARMY_DETAIL_TIP.body },
                extras: `${statusPill(state, army, false)}${auto ? `<span class="status-pill auto">${t("panels.armyDetail.managedPill")}</span>` : ""}<button class="detail-close" data-action="detail-close" title="${t("panels.armyDetail.close")}" aria-label="${t("panels.armyDetail.close")}">✕</button>`,
            })}
            <div class="panel-body">
                ${autoNote}
                <div class="detail-org">
                    <span class="org-v big ${orgClass(army.org)}" title="${t("panels.armyDetail.orgTitle", { org: Math.round(army.org), max: ORG_MAX })}"><i style="height:${orgPct(army.org)}%"></i></span>
                    <div class="detail-org-info">
                        <b>${t("panels.armyDetail.orgLabel", { org: Math.round(army.org), max: ORG_MAX })}</b>
                        <span>${t("panels.armyDetail.orgHint")}</span>
                    </div>
                    <span class="army-meta">${t("panels.armyDetail.armyMeta", { count: army.regiments.length, cap: REGIMENT_CAP, hp: regimentHp(army), mobility: armyMp(army) })}</span>
                </div>
                <div class="detail-loc"><span class="icon-glyph detail-loc-icon" aria-hidden="true" ${iconMaskStyle("location")}></span>${state.provinces[army.province].name}</div>
                <div class="reg-list">${regRows}</div>
                ${splitRow}
                ${marchHtml}
                ${actionRow}
                ${assault}
                ${mergeHint}
            </div>`);
    }
}
