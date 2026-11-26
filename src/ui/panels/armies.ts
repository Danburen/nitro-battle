import type { GameEngine } from "../../game/engine.ts";
import { isArmyAutoManaged } from "../../game/auto.ts";
import { armyCap, nationDeploymentCount, regimentCountByKind } from "../../game/rules.ts";
import { ORG_MAX } from "../../game/types/organization.ts";
import { REGIMENT_CAP, UNIT_KINDS, UNIT_PROFILES } from "../../game/types/unit.ts";
import { AUTO_GLOBAL_LOCK_TIP, orgClass, orgPct, statusPill } from "../common.ts";
import { escapeHtml } from "../text.ts";
import { panelHead, renderPanel } from "../panel.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { t } from "../../i18n/index.ts";

const ARMY_LIST_TIP = {
    get body(): string { return t("panels.armies.help", { regimentCap: REGIMENT_CAP }); },
};

const AUTO_SWITCH_TIP = {
    get body(): string { return t("panels.armies.autoHelp"); },
};

const AUTO_ROW_TIP = {
    get body(): string { return t("panels.armies.autoRowTip"); },
};
const AUTO_GEAR_TIP = {
    get body(): string { return `${AUTO_ROW_TIP.body}\n${t("panels.armies.autoGearSuffix")}`; },
};
const MANUAL_GEAR_TIP = {
    get body(): string { return t("panels.armies.manualGearTip"); },
};

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
                ? tooltipAttrs(t("panels.armies.globalLock"), AUTO_GLOBAL_LOCK_TIP)
                : auto
                    ? tooltipAttrs(t("panels.armies.autoRowTitle"), `${t("panels.armies.autoGearSuffix")}\n${AUTO_ROW_TIP.body}`)
                    : `title="${t("panels.armies.rowTitle", { org: Math.round(army.org), max: ORG_MAX })}"`;
            const gearTip = autoOn
                ? tooltipAttrs(t("panels.armies.globalLock"), AUTO_GLOBAL_LOCK_TIP)
                : tooltipAttrs(t(auto ? "panels.armies.autoManaged" : "panels.armies.manualManaged"), auto ? AUTO_GEAR_TIP.body : MANUAL_GEAR_TIP.body);
            // The gear sits just outside the status pill on its right, inside the army
            // row, as a bare cog icon. It is a span(role=button) because .army-row is
            // itself a <button>; a nested <button> closes the row early in HTML parsing.
            const gear = `<span class="army-auto-gear${auto ? " on" : ""}" data-action="army-auto-toggle" data-army="${army.id}"
                    role="button" aria-label="${t(auto ? "panels.armies.unmanage" : "panels.armies.manage", { name: escapeHtml(army.name) })}"
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
                    <span>${t("panels.armies.selected", { count: this.multiSelect.size })}</span>
                    <button class="btn btn-sm btn-primary" data-action="merge-selected">${t("panels.armies.merge")}</button>
                    <button class="btn btn-sm" data-action="merge-clear">${t("panels.armies.cancel")}</button>
                </div>`
            : "";

        const collapsed = this.el.classList.contains("army-collapsed");
        const autoSwitch = `<button class="auto-manage-gear${autoOn ? " on" : ""}" data-action="auto-manage-toggle"
            aria-pressed="${autoOn}" aria-label="${t(autoOn ? "panels.armies.disableGlobal" : "panels.armies.enableGlobal")}"
            ${tooltipAttrs(t("panels.armies.autoSwitchTitle"), AUTO_SWITCH_TIP.body)}>${GEAR_SVG}</button>`;
        renderPanel(this.el, {
            head: panelHead({
                title: t("panels.armies.title"),
                titleExtras: autoSwitch,
                help: { title: t("panels.armies.listHelpTitle"), body: ARMY_LIST_TIP.body },
                extras: `<span class="objective">${armies.length}/${cap}</span><button class="army-toggle" data-action="army-toggle" aria-expanded="${!collapsed}" aria-label="${t(collapsed ? "panels.armies.expandList" : "panels.armies.collapseList")}">${collapsed ? "▸" : "▾"}</button>`,
            }),
            bodyClass: `army-body${autoOn ? " auto-locked" : ""}`,
            body: `${mergeBar}
                ${rows || `<div class="empty-hint">${t("panels.armies.empty")}</div>`}
                <p class="micro-hint">${t("panels.armies.hint")}${autoOn ? "" : ` · ${t("panels.armies.singleHint")}`}${queued > 0 ? ` · ${t("panels.armies.training", { count: queued })}` : ""}</p>`,
        });
    }
}
