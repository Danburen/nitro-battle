import type { GameEngine } from "../../game/engine.ts";
import { armyCap, nationDeploymentCount, regimentCountByKind } from "../../game/rules.ts";
import { ORG_MAX, UNIT_KINDS, UNIT_PROFILES } from "../../game/types.ts";
import { orgClass, orgPct, statusPill } from "../common.ts";

/** Compact army list (top-right): quick selection + ctrl multi-select merge. */
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

        const rows = armies.map((army) => {
            const selected = state.selectedArmyId === army.id;
            const checked = this.multiSelect.has(army.id);
            const kinds = regimentCountByKind(army);
            const chips = UNIT_KINDS
                .filter((kind) => kinds.has(kind))
                .map((kind) => {
                    const up = UNIT_PROFILES[kind];
                    return `<span class="kind-chip" title="${up.name} ×${kinds.get(kind)}">${up.glyph} ${up.name} ${kinds.get(kind)}</span>`;
                }).join("");
            return `
                <button class="army-row army-row-btn compact${selected ? " selected" : ""}${checked ? " checked" : ""}"
                    data-action="select-army" data-army="${army.id}"
                    title="组织度 ${Math.round(army.org)}/${ORG_MAX} · 点击接管指挥 · Ctrl+点击多选合并">
                    <div class="army-line">
                        <span class="org-v ${orgClass(army.org)}"><i style="height:${orgPct(army.org)}%"></i></span>
                        <b>${checked ? "✓ " : ""}${army.name}</b>
                        <span class="army-count">×${army.regiments.length}</span>
                        <span class="army-loc">${state.provinces[army.province].name}</span>
                        ${statusPill(state, army, true)}
                    </div>
                    <div class="army-kinds">${chips}</div>
                </button>`;
        }).join("");

        const mergeBar = this.multiSelect.size >= 2
            ? `<div class="merge-bar">
                    <span>已选 ${this.multiSelect.size} 支军团</span>
                    <button class="btn btn-sm btn-primary" data-action="merge-selected">合并</button>
                    <button class="btn btn-sm" data-action="merge-clear">取消</button>
                </div>`
            : "";

        const collapsed = this.el.classList.contains("army-collapsed");
        this.el.innerHTML = `
            <div class="panel-head"><h2>军团</h2><span class="objective">${armies.length}/${cap}</span>
                <button class="army-toggle" data-action="army-toggle" aria-expanded="${!collapsed}" aria-label="${collapsed ? "展开军团列表" : "收起军团列表"}">${collapsed ? "▸" : "▾"}</button>
            </div>
            <div class="panel-body army-body">
                ${mergeBar}
                ${rows || `<div class="empty-hint">暂无军团。到「部署」页签训练部队，完成后自动编成。</div>`}
                <p class="micro-hint">点击接管指挥 · Ctrl+点击多选合并${queued > 0 ? ` · 训练中 ${queued} 个团` : ""}</p>
            </div>`;
    }
}