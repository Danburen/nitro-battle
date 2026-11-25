import type { GameEngine } from "../../game/engine.ts";
import { isArmyAutoManaged } from "../../game/auto.ts";
import { battleForecast } from "../../game/battle.ts";
import { armyCap, armyMp, nationArmyCount, redeployTargets, regimentHp } from "../../game/rules.ts";
import { MAX_HP, REGIMENT_CAP, UNIT_PROFILES } from "../../game/types/unit.ts";
import { ORG_MAX } from "../../game/types/organization.ts";
import { orgClass, orgPct, statusPill } from "../common.ts";
import { iconMaskStyle } from "../text.ts";
import { panelHead } from "../panel.ts";

const ARMY_DETAIL_TIP = `勾选团后点击拆分编组，新军团进驻相邻空省；合并需移动到友军省份，或在右侧军团列表 Ctrl+多选后合并。\n组织度每日按[[supply]]恢复，低于 15 溃退；欠饷会降低全军组织度。\n进攻相邻敌军省份前需先宣战；按钮上的战力对比按攻击/防御与地形估算。\n战略转移将未行动军团撤往后方；待命结束本回合行动。\n解散军团后所属团复员，无法恢复。\n已托管的军团仅可查看；点击「取消托管」后恢复手动指挥。`;

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
                <label class="reg-row" title="${up.name} · HP ${regiment.hp}/${MAX_HP} · 组织度 ${Math.round(army.org)}/${ORG_MAX}（军团共享）${auto ? " · 托管中无法拆分" : ""}">
                    <input type="checkbox" data-action="split-check" data-reg="${regiment.id}" ${checked ? "checked" : ""} ${auto || battle || army.moved || army.acted ? "disabled" : ""} aria-label="选择${up.name}用于拆分" />
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
                    ${auto ? "" : `<button class="btn btn-sm" data-action="march-cancel">撤销</button>`}
                </div>`
            : "";

        const targets = auto || battle ? [] : this.engine.targetsFor(army);
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

        const autoNote = auto ? `<div class="auto-manage-note">
                <b>该军团已托管</b>
                <span>AI 每回合代为移动、进攻，并与附近军团合并。取消托管后才可手动下达命令。</span>
                <button class="btn btn-sm" data-action="army-auto-toggle" data-army="${army.id}">取消托管</button>
            </div>` : "";
        const splitRow = auto ? "" : `<div class="split-row">
                    <button class="btn btn-sm" data-action="split" ${canSplit ? "" : "disabled"}>拆分编组${this.splitChecks.size > 0 ? `（${this.splitChecks.size} 团）` : ""}</button>
                    <span class="micro-hint">勾选团拆分，新军团进驻相邻空省</span>
                </div>`;
        const actionRow = auto ? "" : `<div class="action-row">
                    <button class="btn" data-action="wait" ${army.acted ? "disabled" : ""}>待命</button>
                    <button class="btn" data-action="${redeploying ? "redeploy-cancel" : "redeploy"}" ${redeploying || canRedeploy ? "" : "disabled"}>
                        ${redeploying ? "取消转移" : "战略转移"}
                    </button>
                    <button class="btn" data-action="disband" ${battle ? "disabled" : ""}>解散</button>
                </div>`;
        const assault = auto
            ? `<p class="micro-hint">托管军团由 AI 指挥，无法手动进攻。</p>`
            : attackHtml
                ? `<div class="assault-list">${attackHtml}</div>`
                : battle
                    ? ""
                    : `<p class="micro-hint">相邻无可进攻目标。点击远处省份可下达多日行军；进攻他国需先宣战。</p>`;
        const mergeHint = auto ? "" : `<p class="micro-hint">合并：移动到友军省份，或在右侧列表 Ctrl+多选后合并。</p>`;

        this.el.innerHTML = `
            ${panelHead({
                title: army.name,
                help: { title: "指挥窗口", body: ARMY_DETAIL_TIP },
                extras: `${statusPill(state, army, false)}${auto ? `<span class="status-pill auto">托管</span>` : ""}<button class="detail-close" data-action="detail-close" title="关闭详情" aria-label="关闭详情">✕</button>`,
            })}
            <div class="panel-body">
                ${autoNote}
                <div class="detail-org">
                    <span class="org-v big ${orgClass(army.org)}" title="组织度 ${Math.round(army.org)}/${ORG_MAX}"><i style="height:${orgPct(army.org)}%"></i></span>
                    <div class="detail-org-info">
                        <b>组织度 ${Math.round(army.org)}/${ORG_MAX}</b>
                        <span>每日按补给恢复 · 低于 15 溃退</span>
                    </div>
                    <span class="army-meta">${army.regiments.length}/${REGIMENT_CAP} 团 · ${regimentHp(army)} HP · 机动 ${armyMp(army)}</span>
                </div>
                <div class="detail-loc"><span class="icon-glyph detail-loc-icon" aria-hidden="true" ${iconMaskStyle("location")}></span>${state.provinces[army.province].name}</div>
                <div class="reg-list">${regRows}</div>
                ${splitRow}
                ${marchHtml}
                ${actionRow}
                ${assault}
                ${mergeHint}
            </div>`;
    }
}
