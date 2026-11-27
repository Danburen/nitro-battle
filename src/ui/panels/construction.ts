import type { GameEngine } from "../../game/engine.ts";
import type { GameState } from "../../game/types/state.ts";
import { canBuild, canBuildProvince, constructionPlan, factoryTotals, provinceBuildingCapacity, stateBuildingCapacity } from "../../game/economy.ts";
import { BUILDING_PROFILES, PROVINCE_BUILDING_KINDS, STATE_BUILDING_KINDS } from "../../game/types/building.ts";
import type { BuildingKind, ConstructionOrder } from "../../game/types/building.ts";
import { t } from "../../i18n/index.ts";
import { escapeGameText, game, html, iconMaskStyle, rawHtml, setGameHtml, setGameText } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, PanelShell } from "../panel.ts";
import type { PanelView } from "../panel.ts";
import { gameHtml, scopedTexts } from "../view.ts";

type FactoryTotals = ReturnType<typeof factoryTotals>;
type Capacity = { readonly built: number; readonly pending: number; readonly used: number; readonly limit: number } | null;
type Allocation = { readonly factories: number; readonly pointsPerTurn: number; readonly eta: number | null };

function constructionTexts() {
    const s = scopedTexts("panels.construction.", {
        title: ["title"],
        helpTitle: ["helpTitle"],
        help: ["help"],
        allocationLabel: ["factory.allocationLabel"],
        addIdle: ["factory.addIdle"],
        productionCount: ["factory.productionCount"],
        addProduction: ["factory.addProduction"],
        areaProvince: ["area.province"],
        areaState: ["area.state"],
        buildStep: ["build.step"],
        tabsLabel: ["tabs.label"],
        tabsState: ["tabs.state"],
        tabsStateDetail: ["tabs.stateDetail"],
        tabsProvince: ["tabs.province"],
        tabsProvinceDetail: ["tabs.provinceDetail"],
        factoryTitle: ["factory.title"],
        factoryHint: ["factory.hint"],
        queueTitle: ["queue.title"],
        queueIdleLabel: ["queue.idleLabel"],
        queueHint: ["queue.hint"],
        ended: ["ended"],
        endedShort: ["endedShort"],
        noIdle: ["queue.noIdle"],
        queueEmpty: ["queue.empty"],
        dropEnd: ["queue.dropEnd"],
        listLabel: ["queue.listLabel"],
        factoryTooltipTitle: ["factory.tooltipTitle"],
        estimatePaused: ["estimate.paused"],
        estimateFull: ["estimate.full"],
        estimateInsufficient: ["estimate.insufficient"],
        noTargetDetails: ["build.noTargetDetails"],
        zoomHint: ["build.zoomHint"],
        paused: ["paused"],
        orderWaiting: ["order.waiting"],
    });
    return {
        ...s,
        status: (count: number) => t("panels.construction.status", { count }),
        area: (local: boolean) => local ? s.areaProvince : s.areaState,
        pick: (area: string) => t("panels.construction.build.pick", { area }),
        buildSelect: (name: string) => t("panels.construction.build.select", { name }),
        effects: (kind: BuildingKind, desc: string): string => {
            if (kind === "infrastructure") return t("panels.construction.effects.infrastructure");
            if (kind === "supply") return t("panels.construction.effects.supply", { desc });
            return desc;
        },
        estimate: (enabled: boolean, capacity: Capacity, eta: number | null): string => {
            if (!enabled) return capacity && capacity.used >= capacity.limit ? s.estimateFull : s.estimateInsufficient;
            return eta === null ? s.estimatePaused : t("panels.construction.estimate.eta", { days: eta });
        },
        targetDetails: (params: { area: string; name: string; built: number; limit: number; pending: number; estimate: string }) =>
            t("panels.construction.build.targetDetails", params),
        buildBody: (params: { funds: number; industry: number; points: number; targetDetails: string; effects: string; area: string; zoomHint: string }) =>
            t("panels.construction.build.body", params),
        factoryTooltip: (totals: FactoryTotals) =>
            t("panels.construction.factory.tooltip", { prod: totals.prod, idle: totals.idle, total: totals.total }),
        factoryValueText: (totals: FactoryTotals) =>
            t("panels.construction.factory.valueText", { prod: totals.prod, idle: totals.idle }),
        factorySummary: (totals: FactoryTotals) =>
            t("panels.construction.factory.summary", { prod: totals.prod, idle: totals.idle, total: totals.total }),
        etaText: (eta: number | null) => eta === null ? s.paused : t("panels.construction.order.eta", { days: eta }),
        orderDetails: (params: {
            scope: string; place: string; remaining: string; points: number; factories: number;
            rate: string; etaText: string; desc: string;
        }) => t("panels.construction.order.details", params),
        factoriesLabel: (count: number) => t("panels.construction.order.factoriesLabel", { count }),
        progressLabel: (name: string) => t("panels.construction.order.progressLabel", { name }),
        moveUp: (name: string) => t("panels.construction.order.moveUp", { name }),
        moveDown: (name: string) => t("panels.construction.order.moveDown", { name }),
        cancel: (name: string, place: string) => t("panels.construction.order.cancel", { place, name }),
    };
}
type ConstructionTexts = ReturnType<typeof constructionTexts>;

function icon(kind: BuildingKind): string {
    return `<span class="building-icon" aria-hidden="true" ${iconMaskStyle(BUILDING_PROFILES[kind].icon)}></span>`;
}

function buildButton(state: GameState, kind: BuildingKind, selected: number | null, selectedKind: BuildingKind | null, text: ConstructionTexts): string {
    const province = selected === null ? undefined : state.provinces[selected];
    const region = province ? state.states[province.stateId] : undefined;
    const profile = BUILDING_PROFILES[kind];
    const local = kind === "supply" || kind === "fort";
    const area = text.area(local);
    const site = local ? province?.site : region?.center;
    const capacity: Capacity = local
        ? province ? provinceBuildingCapacity(state, province, kind) : null
        : region ? stateBuildingCapacity(state, region, kind) : null;
    const enabled = local ? site !== undefined && canBuildProvince(state, 0, site, kind)
        : !!region && canBuild(state, 0, region.id, kind);
    const virtual: ConstructionOrder | null = enabled && site !== undefined
        ? { id: -1, nation: 0, site, kind, remainingPoints: profile.constructionPoints, paidFunds: profile.costFunds, paidIndustry: profile.costIndustry }
        : null;
    const eta = virtual ? constructionPlan({ ...state, construction: [...state.construction, virtual] }, 0).find((entry) => entry.orderId === -1)?.eta ?? null : null;
    const estimate = state.winner !== null ? text.endedShort : text.estimate(enabled, capacity, eta);
    const target = local ? province : region;
    const targetDetails = target && site !== undefined && capacity && state.provinces[site].owner === 0 && state.terrain.passable[site]
        ? text.targetDetails({
            area, name: escapeGameText(target.name), built: capacity.built, limit: capacity.limit,
            pending: capacity.pending, estimate,
        })
        : text.noTargetDetails;
    const body = text.buildBody({
        funds: profile.costFunds, industry: profile.costIndustry, points: profile.constructionPoints,
        targetDetails, effects: text.effects(kind, profile.desc), area, zoomHint: local ? text.zoomHint : "",
    });
    const selectable = state.winner === null;
    const selectedNow = selectedKind === kind;
    return html`<button class="construction-icon${selectable ? "" : " unavailable"}${selectedNow ? " selected" : ""}" data-action="construction-kind" data-kind="${kind}" data-focus-key="build-${kind}" aria-label="${text.buildSelect(profile.name)}" aria-disabled="${!selectable}" aria-pressed="${selectedNow}" ${rawHtml(tooltipAttrs(profile.name, body))}>${rawHtml(icon(kind))}<span class="construction-icon-name">${profile.name}</span></button>`;
}

function orderHtml(state: GameState, order: ConstructionOrder, index: number, count: number, allocation: Allocation, text: ConstructionTexts): string {
    const profile = BUILDING_PROFILES[order.kind];
    const province = state.provinces[order.site];
    const place = profile.scope === "state" ? state.states[province.stateId].name : province.name;
    const progress = Math.max(0, Math.min(100, (1 - order.remainingPoints / profile.constructionPoints) * 100));
    const etaText = text.etaText(allocation.eta);
    const eta = rawHtml(gameHtml(game`[[turn:${allocation.eta}]]`));
    const details = text.orderDetails({
        scope: text.area(profile.scope === "province"),
        place: escapeGameText(place),
        remaining: order.remainingPoints.toFixed(2),
        points: profile.constructionPoints,
        factories: allocation.factories,
        rate: allocation.pointsPerTurn.toFixed(2),
        etaText,
        desc: profile.desc,
    });
    const finished = state.winner !== null;
    const rate = allocation.factories
        ? rawHtml(gameHtml(`[[construction:${allocation.pointsPerTurn.toFixed(2)}]]/[[turn]]`))
        : text.orderWaiting;
    const cells = Array.from({ length: 5 }, (_, i) => `<i class="${i < allocation.factories ? "filled" : ""}"></i>`).join("");
    const upDisabled = finished || index === 0 ? " disabled" : "";
    const downDisabled = finished || index === count - 1 ? " disabled" : "";
    const cancelDisabled = finished ? " disabled" : "";
    return html`<div class="construction-order" role="listitem" draggable="${!finished}" data-order-id="${order.id}" ${rawHtml(tooltipAttrs(profile.name, details))}>
        <div class="queue-line"><span class="queue-grip" aria-hidden="true">⠿</span><span class="queue-kind">${rawHtml(icon(order.kind))}</span><button class="queue-place" data-action="construction-jump" data-site="${order.site}" data-mode="${profile.scope}" data-focus-key="jump-${order.id}"><b>${profile.name}</b><span>${place}</span></button><div class="queue-factories" role="img" aria-label="${text.factoriesLabel(allocation.factories)}"><span class="factory-cell-bar" aria-hidden="true">${rawHtml(cells)}</span>${rawHtml(icon("factory"))}</div></div>
        <div class="queue-progress" role="progressbar" aria-label="${text.progressLabel(profile.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div>
        <div class="queue-footer"><span>${rate} · ${eta}</span><div class="queue-actions"><button data-queue-move="up" data-order="${order.id}" data-focus-key="up-${order.id}" aria-label="${text.moveUp(profile.name)}" ${rawHtml(upDisabled)}>↑</button><button data-queue-move="down" data-order="${order.id}" data-focus-key="down-${order.id}" aria-label="${text.moveDown(profile.name)}" ${rawHtml(downDisabled)}>↓</button><button data-action="build-cancel" data-order="${order.id}" aria-label="${text.cancel(profile.name, place)}" ${rawHtml(cancelDisabled)}>×</button></div></div>
    </div>`;
}

export interface ConstructionViewContext {
    readonly state: GameState;
    readonly scope: "state" | "province";
    readonly selectedKind: BuildingKind | null;
}

/** Pure view builder: factory allocation, building picker and construction queue. */
export function constructionView(ctx: ConstructionViewContext): PanelView {
    const text = constructionTexts();
    const { state, scope, selectedKind } = ctx;
    const totals = factoryTotals(state, 0);
    const queue = state.construction.filter((order) => order.nation === 0);
    const allocations = constructionPlan(state, 0);
    const assigned = allocations.reduce((sum, entry) => sum + entry.factories, 0);
    const local = scope === "province";
    const area = text.area(local);
    const kinds = local ? PROVINCE_BUILDING_KINDS : STATE_BUILDING_KINDS;

    const buildings = html`<div class="deploy-head construction-step"><span>${text.buildStep}</span></div>
        <div class="construction-icons" role="group" aria-label="${text.pick(area)}">${rawHtml(kinds.map((kind) => buildButton(state, kind, state.selected, selectedKind, text)).join(""))}</div>`;
    const orderRows = queue.map((order, index) =>
        orderHtml(state, order, index, queue.length, allocations.find((entry) => entry.orderId === order.id)!, text)).join("");
    const orders = orderRows || html`<div class="empty-hint">${text.queueEmpty}</div>`;
    const warning = state.winner !== null
        ? html`<div class="empty-hint">${text.ended}</div>`
        : totals.idle === 0 ? html`<p class="construction-warning">${text.noIdle}</p>` : "";

    const tabs = html`<div class="construction-tabs" role="tablist" aria-label="${text.tabsLabel}">
        <button role="tab" id="construction-state-tab" aria-controls="construction-buildings" aria-selected="${scope === "state"}" data-action="construction-scope" data-mode="state" data-focus-key="scope-state" class="${scope === "state" ? "active" : ""}">${text.tabsState} <span>${text.tabsStateDetail}</span></button>
        <button role="tab" id="construction-province-tab" aria-controls="construction-buildings" aria-selected="${scope === "province"}" data-action="construction-scope" data-mode="province" data-focus-key="scope-province" class="${scope === "province" ? "active" : ""}">${text.tabsProvince} <span>${text.tabsProvinceDetail}</span></button>
    </div>`;
    const head = `${panelHead({
        title: text.title,
        help: { title: text.helpTitle, body: text.help },
        status: text.status(queue.length),
    })}${tabs}`;

    return {
        head,
        bodyClass: "construction-body",
        body: html`<section class="construction-section construction-factories">
            <div class="deploy-head"><span>${text.factoryTitle}</span><span data-factory-summary></span></div>
            <div data-factory-host></div>
            <p class="micro-hint">${text.factoryHint}</p>
        </section>
        <div id="construction-buildings" role="tabpanel" aria-labelledby="construction-${scope}-tab">${rawHtml(buildings)}</div>
        <section class="construction-section construction-queue">
            <div class="deploy-head"><span>${text.queueTitle}</span><span>${assigned} / ${totals.idle} ${text.queueIdleLabel}</span></div>
            <p class="micro-hint">${text.queueHint}</p>
            ${rawHtml(warning)}
            <div class="construction-orders" role="list" aria-label="${text.listLabel}">${rawHtml(orders)}<div class="queue-end" data-drop-end>${text.dropEnd}</div></div>
        </section>`,
    };
}

/** Construction workbench (dock tab 1); dragging and the persistent dial stay in the panel controller. */
export class ConstructionPanel {
    scope: "state" | "province" = "state";
    selectedKind: BuildingKind | null = null;
    private readonly engine: GameEngine;
    private readonly shell = new PanelShell(document.querySelector<HTMLElement>("#construction-panel")!);
    private readonly el = this.shell.el;
    private draggedOrder: number | null = null;
    private dropBefore: number | null = null;
    /** Persistent factory dial so a slider drag survives the panel's full re-render. */
    private readonly allocation = document.createElement("div");
    private readonly production = document.createElement("input");
    private allocationBusy = false;
    private allocationDirty = false;
    private lastWheel = -Infinity;

    constructor(engine: GameEngine) {
        this.engine = engine;
        const text = constructionTexts();
        this.el.addEventListener("dragstart", this.onDragStart);
        this.el.addEventListener("dragover", this.onDragOver);
        this.el.addEventListener("drop", this.onDrop);
        this.el.addEventListener("dragend", this.onDragEnd);
        this.el.addEventListener("click", this.onClick);
        this.allocation.className = "factory-allocation";
        this.allocation.id = "factory-allocation";
        this.allocation.setAttribute("role", "group");
        this.allocation.setAttribute("aria-label", text.allocationLabel);
        setGameHtml(this.allocation, html`<button type="button" class="factory-step" data-factory-step="-1" aria-label="${text.addIdle}">−</button>
            <div class="factory-dial">
                <div class="factory-totals"><span>${"[[production]]"} <b data-factory-prod>0</b></span><span>${"[[idle]]"} <b data-factory-idle>0</b></span></div>
                <input id="factory-production" type="range" min="0" max="0" value="0" step="1" data-focus-key="factory-production" aria-label="${text.productionCount}" />
            </div>
            <button type="button" class="factory-step" data-factory-step="1" aria-label="${text.addProduction}">+</button>`);
        this.production = this.allocation.querySelector<HTMLInputElement>("input")!;
        this.allocation.addEventListener("wheel", this.onAllocationWheel, { passive: false });
        this.allocation.addEventListener("click", this.onAllocationClick);
        this.allocation.addEventListener("pointerdown", this.onAllocationPointerDown);
        this.allocation.addEventListener("keydown", this.onAllocationKeyDown);
        this.production.addEventListener("input", this.onProductionInput);
        document.addEventListener("pointerup", this.onAllocationPointerUp);
        document.addEventListener("keyup", this.onAllocationKeyUp);
    }

    destroy(): void {
        this.el.removeEventListener("dragstart", this.onDragStart);
        this.el.removeEventListener("dragover", this.onDragOver);
        this.el.removeEventListener("drop", this.onDrop);
        this.el.removeEventListener("dragend", this.onDragEnd);
        this.el.removeEventListener("click", this.onClick);
        this.allocation.removeEventListener("wheel", this.onAllocationWheel);
        this.allocation.removeEventListener("click", this.onAllocationClick);
        this.allocation.removeEventListener("pointerdown", this.onAllocationPointerDown);
        this.allocation.removeEventListener("keydown", this.onAllocationKeyDown);
        this.production.removeEventListener("input", this.onProductionInput);
        document.removeEventListener("pointerup", this.onAllocationPointerUp);
        document.removeEventListener("keyup", this.onAllocationKeyUp);
    }

    setHidden(hidden: boolean): void {
        if (hidden) this.shell.hide();
        else this.shell.show();
    }

    render(): void {
        if (this.allocationBusy) {
            this.syncAllocation();
            return;
        }
        const focused = this.el.contains(document.activeElement)
            ? (document.activeElement as HTMLElement).dataset.focusKey : undefined;
        this.shell.render(constructionView({
            state: this.engine.state, scope: this.scope, selectedKind: this.selectedKind,
        }));
        this.el.querySelector("[data-factory-host]")!.appendChild(this.allocation);
        this.syncAllocation();
        // The persistent dial is appended after renderPanel's focus pass.
        if (focused === "factory-production") this.production.focus({ preventScroll: true });
    }

    private syncAllocation(): void {
        const state = this.engine.state;
        const totals = factoryTotals(state, 0);
        const text = constructionTexts();
        this.allocation.setAttribute("aria-label", text.allocationLabel);
        this.allocation.querySelector<HTMLButtonElement>("[data-factory-step='-1']")?.setAttribute("aria-label", text.addIdle);
        this.allocation.querySelector<HTMLButtonElement>("[data-factory-step='1']")?.setAttribute("aria-label", text.addProduction);
        this.production.setAttribute("aria-label", text.productionCount);
        this.allocation.dataset.tooltipTitle = text.factoryTooltipTitle;
        this.allocation.dataset.tooltipBody = text.factoryTooltip(totals);
        this.production.max = String(totals.total);
        this.production.value = String(totals.prod);
        this.production.disabled = state.winner !== null || totals.total === 0;
        this.production.setAttribute("aria-valuetext", text.factoryValueText(totals));
        this.production.style.setProperty("--production-share", `${totals.total ? totals.prod / totals.total * 100 : 0}%`);
        setGameText(this.allocation.querySelector<HTMLElement>("[data-factory-prod]")!, String(totals.prod), "plain");
        setGameText(this.allocation.querySelector<HTMLElement>("[data-factory-idle]")!, String(totals.idle), "plain");
        const summary = this.el.querySelector<HTMLElement>("[data-factory-summary]");
        if (summary) setGameText(summary, text.factorySummary(totals), "plain");
        for (const button of this.allocation.querySelectorAll<HTMLButtonElement>("[data-factory-step]")) {
            button.disabled = state.winner !== null
                || (Number(button.dataset.factoryStep) > 0 ? totals.idle === 0 : totals.prod === 0);
        }
    }

    private readonly onProductionInput = (): void => {
        this.allocationDirty = true;
        this.engine.setFactoryProduction(Number(this.production.value));
        this.syncAllocation();
    };

    private readonly onAllocationWheel = (event: WheelEvent): void => {
        if (event.ctrlKey || event.deltaY === 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.timeStamp - this.lastWheel < 90) return;
        this.lastWheel = event.timeStamp;
        const totals = factoryTotals(this.engine.state, 0);
        this.engine.setFactoryProduction(totals.prod + (event.deltaY < 0 ? 1 : -1));
    };

    private readonly onAllocationClick = (event: MouseEvent): void => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-factory-step]");
        if (!button || button.disabled) return;
        const totals = factoryTotals(this.engine.state, 0);
        this.engine.setFactoryProduction(totals.prod + Number(button.dataset.factoryStep));
        this.syncAllocation();
    };

    private readonly onAllocationPointerDown = (): void => { this.allocationBusy = true; };

    private readonly onAllocationPointerUp = (): void => this.endAllocationInput();

    private readonly onAllocationKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement;
        if (target === this.production || target.closest("[data-factory-step]")) this.allocationBusy = true;
    };

    private readonly onAllocationKeyUp = (): void => this.endAllocationInput();

    private endAllocationInput(): void {
        if (!this.allocationBusy) return;
        this.allocationBusy = false;
        // Rebuild once the gesture ends so deferred renders see the final factory split.
        if (this.allocationDirty) {
            this.allocationDirty = false;
            this.render();
        }
    }

    private readonly onDragStart = (event: DragEvent): void => {
        const target = event.target as HTMLElement;
        const row = target.closest<HTMLElement>("[data-order-id]");
        if (!row || this.engine.state.winner !== null || target.closest("button")) { event.preventDefault(); return; }
        this.draggedOrder = Number(row.dataset.orderId);
        event.dataTransfer?.setData("text/plain", String(this.draggedOrder));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
        this.el.classList.add("queue-dragging");
    };

    private readonly onDragOver = (event: DragEvent): void => {
        if (this.draggedOrder === null) return;
        const target = event.target as HTMLElement;
        const row = target.closest<HTMLElement>("[data-order-id]");
        if (!row && !target.closest("[data-drop-end]")) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        this.el.querySelectorAll(".drop-before,.drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
        this.dropBefore = null;
        if (row) {
            const id = Number(row.dataset.orderId);
            const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
            const queue = this.engine.state.construction.filter((order) => order.nation === 0);
            this.dropBefore = after ? queue[queue.findIndex((order) => order.id === id) + 1]?.id ?? null : id;
            row.classList.add(after ? "drop-after" : "drop-before");
        }
    };

    private readonly onDrop = (event: DragEvent): void => {
        if (this.draggedOrder === null || !(event.target as HTMLElement).closest(".construction-orders")) return;
        event.preventDefault();
        const order = this.draggedOrder;
        const before = this.dropBefore;
        this.onDragEnd();
        this.engine.reorderConstruction(order, before);
    };

    private readonly onDragEnd = (): void => {
        this.draggedOrder = null;
        this.dropBefore = null;
        this.el.classList.remove("queue-dragging");
        this.el.querySelectorAll(".dragging,.drop-before,.drop-after").forEach((el) => el.classList.remove("dragging", "drop-before", "drop-after"));
    };

    private readonly onClick = (event: MouseEvent): void => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-queue-move]");
        if (!button || button.disabled) return;
        const queue = this.engine.state.construction.filter((order) => order.nation === 0);
        const id = Number(button.dataset.order);
        const index = queue.findIndex((order) => order.id === id);
        const before = button.dataset.queueMove === "up" ? queue[index - 1]?.id : queue[index + 2]?.id ?? null;
        if (before !== undefined) this.engine.reorderConstruction(id, before);
    };
}
