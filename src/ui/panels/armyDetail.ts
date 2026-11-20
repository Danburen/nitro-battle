import type { GameEngine } from "../../game/engine.ts";
import { battleForecast } from "../../game/battle.ts";
import { armyCap, armyMp, nationArmyCount, redeployTargets, regimentHp } from "../../game/rules.ts";
import { MAX_HP, ORG_MAX, REGIMENT_CAP, UNIT_PROFILES } from "../../game/types.ts";
import { orgClass, orgPct, statusPill } from "../common.ts";

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
        this.el.innerHTML = "";
    }

    render(): void {
        const state = this.engine.state;
        const army = this.engine.selectedArmy();
        if (!army || army.nation !== 0 || state.winner !== null) {
            this.hide();
            return;
        }
        this.el.classList.remove("hidden");

        const battle = state.battles.find(
            (entry) => entry.attackerId === army.id || entry.defenderId === army.id,
        );
        const redeploying = state.redeployArmyId === army.id;
        const canRedeploy = !army.moved && !army.acted && !battle && redeployTargets(state, army).size > 0;
        const canSplit = !battle && !army.moved && !army.acted
            && this.splitChecks.size > 0 && this.splitChecks.size < army.regiments.length
            && nationArmyCount(state, 0) < armyCap(state, 0);

        const regRows = army.regiments.map((regiment) => {
            const up = UNIT_PROFILES[regiment.kind];
            const hpPct = Math.max(0, Math.min(100, (regiment.hp / MAX_HP) * 100));
            const checked = this.splitChecks.has(regiment.id);
            return `
                <label class="reg-row" title="${up.name} · HP ${regiment.hp}/${MAX_HP} · 组织度 ${Math.round(army.org)}/${ORG_MAX}（军团共享）">
                    <input type="checkbox" data-action="split-check" data-reg="${regiment.id}" ${checked ? "checked" : ""} ${battle || army.moved || army.acted ? "disabled" : ""} aria-label="选择${up.name}用于拆分" />
                    <span class="reg-glyph">${up.glyph}</span>
                    <span class="reg-name">${up.name}</span>
                    <span class="reg-hp"><i style="width:${hpPct}%"></i></span>
                    <span class="reg-hp-num">${regiment.hp}</span>
                    <span class="reg-stats">攻${up.atk} 防${up.def} 机${up.mp}</span>
                    <span class="reg-org">${Math.round(army.org)}</span>
                </label>`;
        }).join("");

        const marchHtml = army.march
            ? `<div class="march-note">
                    ${army.march.attack ? "进攻" : "开赴"} ${state.provinces[army.march.target].name}
                    <button class="btn btn-sm" data-action="march-cancel">撤销</button>
                </div>`
            : "";

        const targets = battle ? [] : this.engine.targetsFor(army);
        const attackHtml = targets.map((target) => {
            const forecast = battleForecast(state, army, target);
            const favorable = forecast.attackPower >= forecast.defensePower;
            const occupied = this.engine.battleAt(target) !== null;
            return `
                <button class="btn assault-btn${favorable ? " favorable" : " risky"}" data-action="attack" data-site="${target}" ${occupied ? "disabled" : ""}>
                    <span>进攻 ${state.provinces[target].name}</span>
                    <span class="assault-odds">攻 ${Math.round(forecast.attackPower)} / 守 ${Math.round(forecast.defensePower)}${occupied ? " · 已有会战" : ""}</span>
                </button>`;
        }).join("");

        this.el.innerHTML = `
            <div class="panel-head">
                <h2>${army.name}</h2>
                ${statusPill(state, army, false)}
                <button class="detail-close" data-action="detail-close" title="关闭详情" aria-label="关闭详情">✕</button>
            </div>
            <div class="panel-body">
                <div class="detail-org">
                    <span class="org-v big ${orgClass(army.org)}" title="组织度 ${Math.round(army.org)}/${ORG_MAX}"><i style="height:${orgPct(army.org)}%"></i></span>
                    <div class="detail-org-info">
                        <b>组织度 ${Math.round(army.org)}/${ORG_MAX}</b>
                        <span>每日按补给恢复 · 低于 15 溃退</span>
                    </div>
                    <span class="army-meta">${army.regiments.length}/${REGIMENT_CAP} 团 · ${regimentHp(army)} HP · 机动 ${armyMp(army)}</span>
                </div>
                <div class="detail-loc">📍 ${state.provinces[army.province].name}</div>
                <div class="reg-list">${regRows}</div>
                <div class="split-row">
                    <button class="btn btn-sm" data-action="split" ${canSplit ? "" : "disabled"}>拆分编组${this.splitChecks.size > 0 ? `（${this.splitChecks.size} 团）` : ""}</button>
                    <span class="micro-hint">勾选团拆分，新军团进驻相邻空省</span>
                </div>
                ${marchHtml}
                <div class="action-row">
                    <button class="btn" data-action="wait" ${army.acted ? "disabled" : ""}>待命</button>
                    <button class="btn" data-action="${redeploying ? "redeploy-cancel" : "redeploy"}" ${redeploying || canRedeploy ? "" : "disabled"}>
                        ${redeploying ? "取消转移" : "战略转移"}
                    </button>
                    <button class="btn" data-action="disband" ${battle ? "disabled" : ""}>解散</button>
                </div>
                ${attackHtml
                    ? `<div class="assault-list">${attackHtml}</div>`
                    : battle
                        ? ""
                        : `<p class="micro-hint">相邻无可进攻目标。点击远处省份可下达多日行军；进攻他国需先宣战。</p>`}
                <p class="micro-hint">合并：移动到友军省份，或在右侧列表 Ctrl+多选后合并。</p>
            </div>`;
    }
}