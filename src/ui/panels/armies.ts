import type { GameEngine } from "../../game/engine.ts";
import type { GameState } from "../../game/types/state.ts";
import { isArmyAutoManaged } from "../../game/auto.ts";
import { armyCap, nationDeploymentCount, regimentCountByKind } from "../../game/rules.ts";
import { ORG_MAX } from "../../game/types/organization.ts";
import { REGIMENT_CAP, UNIT_KINDS, UNIT_PROFILES } from "../../game/types/unit.ts";
import { t } from "../../i18n/index.ts";
import { autoGlobalLockTip, orgClass, orgPct, statusPill } from "../common.ts";
import { escapeHtml, html, rawHtml } from "../text.ts";
import { panelHead, renderPanel } from "../panel.ts";
import type { PanelView } from "../panel.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { scopedTexts } from "../view.ts";

/** Square, centre-symmetric cog so it stays round and spins around its own hub. */
const GEAR_SVG = `<svg class="gear-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 2 2 2 0 0 1-2.83 0l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
</svg>`;

function armyTexts() {
    const base = scopedTexts("panels.armies.", {
        title: ["title"],
        listHelpTitle: ["listHelpTitle"],
        help: ["help", { regimentCap: REGIMENT_CAP }],
        autoHelp: ["autoHelp"],
        autoRowTip: ["autoRowTip"],
        autoGearSuffix: ["autoGearSuffix"],
        manualGearTip: ["manualGearTip"],
        globalLock: ["globalLock"],
        autoRowTitle: ["autoRowTitle"],
        autoManaged: ["autoManaged"],
        manualManaged: ["manualManaged"],
        merge: ["merge"],
        cancel: ["cancel"],
        empty: ["empty"],
        hint: ["hint"],
        singleHint: ["singleHint"],
        autoSwitchTitle: ["autoSwitchTitle"],
        expandList: ["expandList"],
        collapseList: ["collapseList"],
    });
    return {
        ...base,
        rowTitle: (org: number) => t("panels.armies.rowTitle", { org: Math.round(org), max: ORG_MAX }),
        gearTitle: (auto: boolean) => t(auto ? "panels.armies.autoManaged" : "panels.armies.manualManaged"),
        gearLabel: (name: string, auto: boolean) => t(auto ? "panels.armies.unmanage" : "panels.armies.manage", { name }),
        selected: (count: number) => t("panels.armies.selected", { count }),
        globalLabel: (autoOn: boolean) => t(autoOn ? "panels.armies.disableGlobal" : "panels.armies.enableGlobal"),
        toggleLabel: (collapsed: boolean) => t(collapsed ? "panels.armies.expandList" : "panels.armies.collapseList"),
        training: (count: number) => t("panels.armies.training", { count }),
    };
}
type ArmyTexts = ReturnType<typeof armyTexts>;

export interface ArmyViewContext {
    readonly state: GameState;
    readonly multiSelect: ReadonlySet<number>;
    readonly armyCollapsed: boolean;
}

/** Pure view builder: quick selection + ctrl multi-select merge + AI trusteeship. */
export function armyListView(ctx: ArmyViewContext): PanelView {
    const { state, multiSelect } = ctx;
    const text: ArmyTexts = armyTexts();
    const armies = [...state.armies.values()]
        .filter((army) => army.nation === 0)
        .sort((a, b) => a.id - b.id);
    const cap = armyCap(state, 0);
    const queued = nationDeploymentCount(state, 0);
    const autoOn = state.autoManageArmies === true;
    const autoRowTip = `${text.autoRowTip}\n${text.autoGearSuffix}`;

    const rows = armies.map((army) => {
        const selected = state.selectedArmyId === army.id;
        const checked = multiSelect.has(army.id);
        const auto = isArmyAutoManaged(state, army);
        const kinds = regimentCountByKind(army);
        const chips = UNIT_KINDS
            .filter((kind) => kinds.has(kind))
            .map((kind) => {
                const profile = UNIT_PROFILES[kind];
                return html`<span class="kind-chip">${profile.glyph} ${profile.name} ${kinds.get(kind)}</span>`;
            }).join("");

        // GlobalTooltip overwrites data-tooltip-body from a `title` attribute,
        // so locked/managed rows rely on the custom tooltip attrs alone.
        const rowTip = autoOn
            ? tooltipAttrs(text.globalLock, autoGlobalLockTip())
            : auto
                ? tooltipAttrs(text.autoRowTitle, autoRowTip)
                : `title="${escapeHtml(text.rowTitle(army.org))}"`;
        const gearTip = autoOn
            ? tooltipAttrs(text.globalLock, autoGlobalLockTip())
            : tooltipAttrs(text.gearTitle(auto), auto ? autoRowTip : text.manualGearTip);
        // The gear sits just outside the status pill on its right, inside the army
        // row, as a bare cog icon. It is a span(role=button) because .army-row is
        // itself a <button>; a nested <button> closes the row early in HTML parsing.
        const gear = html`<span class="army-auto-gear${auto ? " on" : ""}" data-action="army-auto-toggle" data-army="${army.id}"
            role="button" aria-label="${text.gearLabel(army.name, auto)}"
            aria-pressed="${auto}" ${rawHtml(gearTip)}>${rawHtml(GEAR_SVG)}</span>`;
        const partialLock = !autoOn && auto ? " auto-locked" : "";
        return html`<div class="army-row-wrap">
            <button class="army-row army-row-btn compact${selected ? " selected" : ""}${checked ? " checked" : ""}${partialLock}"
                data-action="select-army" data-army="${army.id}" ${rawHtml(rowTip)}>
                <div class="army-line">
                    <span class="org-v ${orgClass(army.org)}"><i style="height:${orgPct(army.org)}%"></i></span>
                    <b>${checked ? "✓ " : ""}${army.name}</b>
                    <span class="army-count">×${army.regiments.length}</span>
                    <span class="army-loc">${state.provinces[army.province].name}</span>
                    ${rawHtml(statusPill(state, army, true))}
                    ${rawHtml(gear)}
                </div>
                <div class="army-kinds">${rawHtml(chips)}</div>
            </button>
        </div>`;
    }).join("");

    const selectedLabel = text.selected(multiSelect.size);
    const mergeBar = multiSelect.size >= 2
        ? html`<div class="merge-bar">
            <span>${selectedLabel}</span>
            <button class="btn btn-sm btn-primary" data-action="merge-selected">${text.merge}</button>
            <button class="btn btn-sm" data-action="merge-clear">${text.cancel}</button>
        </div>`
        : html``;

    const globalLabel = text.globalLabel(autoOn);
    const autoSwitch = html`<button class="auto-manage-gear${autoOn ? " on" : ""}" data-action="auto-manage-toggle"
        aria-pressed="${autoOn}" aria-label="${globalLabel}"
        ${rawHtml(tooltipAttrs(text.autoSwitchTitle, text.autoHelp))}>${rawHtml(GEAR_SVG)}</button>`;
    const toggleLabel = text.toggleLabel(ctx.armyCollapsed);
    const extras = html`<span class="objective">${armies.length}/${cap}</span><button class="army-toggle" data-action="army-toggle"
        aria-expanded="${!ctx.armyCollapsed}" aria-label="${toggleLabel}">${ctx.armyCollapsed ? "▸" : "▾"}</button>`;
    const hintTail = autoOn ? "" : ` · ${text.singleHint}`;
    const training = queued > 0 ? ` · ${text.training(queued)}` : "";

    return {
        head: panelHead({
            title: text.title,
            titleExtras: autoSwitch,
            help: { title: text.listHelpTitle, body: text.help },
            extras,
        }),
        bodyClass: `army-body${autoOn ? " auto-locked" : ""}`,
        body: html`${rawHtml(mergeBar)}
            ${rows ? rawHtml(rows) : rawHtml(html`<div class="empty-hint">${text.empty}</div>`)}
            <p class="micro-hint">${text.hint}${hintTail}${training}</p>`,
    };
}

/** Compact army list (top-right): delegates rendering to the pure `armyListView`. */
export class ArmyListPanel {
    private readonly engine: GameEngine;
    private readonly multiSelect: Set<number>;
    private readonly el = document.querySelector<HTMLElement>("#army-panel") as HTMLElement;

    constructor(engine: GameEngine, multiSelect: Set<number>) {
        this.engine = engine;
        this.multiSelect = multiSelect;
    }

    render(): void {
        renderPanel(this.el, armyListView({
            state: this.engine.state,
            multiSelect: this.multiSelect,
            armyCollapsed: this.el.classList.contains("army-collapsed"),
        }));
    }
}
