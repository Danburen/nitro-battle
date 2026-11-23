import type { GameEngine } from "../../game/engine.ts";
import { isArmyAutoManaged } from "../../game/auto.ts";
import { armyCap, nationDeploymentCount, regimentCountByKind } from "../../game/rules.ts";
import { ORG_MAX, REGIMENT_CAP, UNIT_KINDS, UNIT_PROFILES } from "../../game/types.ts";
import { AUTO_GLOBAL_LOCK_TIP, orgClass, orgPct, statusPill } from "../common.ts";
import { escapeHtml } from "../text.ts";
import { panelHead, renderPanel } from "../panel.ts";
import { tooltipAttrs } from "../tooltip.ts";

const ARMY_LIST_TIP = `点击军团接管指挥（左侧详情窗下达命令）。\nCtrl+点击可多选，随后在顶部合并条中合并；合并要求各军团未行动、未交战，合计不超过 ${REGIMENT_CAP} 团。\n开启标题右侧的齿轮进入全局托管：面板锁定，AI 代为移动、进攻与合并；关闭后可再用行内状态标签右侧的小齿轮单独托管。\n组织度低于 15 时军团溃退；每日按[[supply]]水平恢复。\n行内标签为编制：兵种与团数。`;

const AUTO_SWITCH_TIP = `开启后，你的军团会像 AI 国家一样在每回合自动移动、进攻，并把附近小军团合并。\n全局托管期间军团面板不可用；点击标题右侧齿轮关闭后，可用状态标签右侧的小齿轮单独托管某支军团。\n关闭托管会立即恢复全部军团的手动指挥。`;

const AUTO_ROW_TIP = `该军团已托管：AI 每回合代为移动、进攻并与附近军团合并。`;
const AUTO_GEAR_TIP = `${AUTO_ROW_TIP}\n请先取消托管，再选择当前军团进行合并。`;
const MANUAL_GEAR_TIP = `该军团未托管，由你手动指挥。点击交给 AI 托管。`;

/** Square, centre-symmetric cog so it stays round and spins around its own hub. */
const GEAR_SVG = `<svg class="gear-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
</svg>`;

/** Compact army list (top-right): quick selection + ctrl multi-select merge + AI trusteeship. */
export class ArmyListPanel {
    private readonly engine: GameEngine;
    private readonly multiSelect: Set<number>;
    private readonly el = document.querySelector<HTMLElement>("#army-panel") as HTMLElement;

    constructor(engine: GameEngine, multiSelect: Set<number>) {
        this.engine = engine;
        this.multiSelect = multiSelect;
    }

    render(): void {
        const state = this.engine.state;
        const armies = [...state.armies.values()]
            .filter((army) => army.nation === 0)
            .sort((a, b) => a.id - b.id);
        const cap = armyCap(state, 0);
        const queued = nationDeploymentCount(state, 0);
        const autoOn = state.autoManageArmies === true;

        const rows = armies.map((army) => {
            const selected = state.selectedArmyId === army.id;
            const checked = this.multiSelect.has(army.id);
            const auto = isArmyAutoManaged(state, army);
            const kinds = regimentCountByKind(army);
            const chips = UNIT_KINDS
                .filter((kind) => kinds.has(kind))
                .map((kind) => {
                    const up = UNIT_PROFILES[kind];
                    return `<span class="kind-chip">${up.glyph} ${up.name} ${kinds.get(kind)}</span>`;
                }).join("");

            // GlobalTooltip overwrites data-tooltip-body from a `title` attribute,
            // so locked/managed rows rely on the custom tooltip attrs alone.
            const rowTip = autoOn
                ? tooltipAttrs("全局托管中", AUTO_GLOBAL_LOCK_TIP)
                : auto
                    ? tooltipAttrs("该军团已托管", `请先取消托管，再选择当前军团进行合并。\n${AUTO_ROW_TIP}`)
                    : `title="组织度 ${Math.round(army.org)}/${ORG_MAX} · 点击接管指挥 · Ctrl+点击多选合并"`;
            const gearTip = autoOn
                ? tooltipAttrs("全局托管中", AUTO_GLOBAL_LOCK_TIP)
                : tooltipAttrs(auto ? "托管中" : "未托管", auto ? AUTO_GEAR_TIP : MANUAL_GEAR_TIP);
            // The gear sits just outside the status pill on its right, inside the army
            // row, as a bare cog icon. It is a span(role=button) because .army-row is
            // itself a <button>; a nested <button> closes the row early in HTML parsing.
            const gear = `<span class="army-auto-gear${auto ? " on" : ""}" data-action="army-auto-toggle" data-army="${army.id}"
                    role="button" aria-label="${auto ? "取消托管" : "托管"}${escapeHtml(army.name)}"
                    aria-pressed="${auto}" ${gearTip}>${GEAR_SVG}</span>`;
            const partialLock = !autoOn && auto ? " auto-locked" : "";
            return `
                <div class="army-row-wrap">
                    <button class="army-row army-row-btn compact${selected ? " selected" : ""}${checked ? " checked" : ""}${partialLock}"
                        data-action="select-army" data-army="${army.id}"
                        ${rowTip}>
                        <div class="army-line">
                            <span class="org-v ${orgClass(army.org)}"><i style="height:${orgPct(army.org)}%"></i></span>
                            <b>${checked ? "✓ " : ""}${army.name}</b>
                            <span class="army-count">×${army.regiments.length}</span>
                            <span class="army-loc">${state.provinces[army.province].name}</span>
                            ${statusPill(state, army, true)}
                            ${gear}
                        </div>
                        <div class="army-kinds">${chips}</div>
                    </button>
                </div>`;
        }).join("");

        const mergeBar = this.multiSelect.size >= 2
            ? `<div class="merge-bar">
                    <span>已选 ${this.multiSelect.size} 支军团</span>
                    <button class="btn btn-sm btn-primary" data-action="merge-selected">合并</button>
                    <button class="btn btn-sm" data-action="merge-clear">取消</button>
                </div>`
            : "";

        const collapsed = this.el.classList.contains("army-collapsed");
        const autoSwitch = `<button class="auto-manage-gear${autoOn ? " on" : ""}" data-action="auto-manage-toggle"
            aria-pressed="${autoOn}" aria-label="${autoOn ? "关闭全局托管" : "开启全局托管"}"
            ${tooltipAttrs("托管军队", AUTO_SWITCH_TIP)}>${GEAR_SVG}</button>`;
        renderPanel(this.el, {
            head: panelHead({
                title: "军团",
                titleExtras: autoSwitch,
                help: { title: "军团列表", body: ARMY_LIST_TIP },
                extras: `<span class="objective">${armies.length}/${cap}</span><button class="army-toggle" data-action="army-toggle" aria-expanded="${!collapsed}" aria-label="${collapsed ? "展开军团列表" : "收起军团列表"}">${collapsed ? "▸" : "▾"}</button>`,
            }),
            bodyClass: `army-body${autoOn ? " auto-locked" : ""}`,
            body: `${mergeBar}
                ${rows || `<div class="empty-hint">暂无军团。到「部署」页签训练部队，完成后自动编成。</div>`}
                <p class="micro-hint">点击接管指挥 · Ctrl+点击多选合并${autoOn ? "" : " · ⚙ 可单独托管"}${queued > 0 ? ` · 训练中 ${queued} 个团` : ""}</p>`,
        });
    }
}
