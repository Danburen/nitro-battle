import type { GameEngine } from "../../game/engine.ts";
import { canBuild, canBuildProvince, constructionPlan, factoryTotals, provinceBuildingCapacity, stateBuildingCapacity } from "../../game/economy.ts";
import { BUILDING_PROFILES, PROVINCE_BUILDING_KINDS, STATE_BUILDING_KINDS } from "../../game/types/building.ts";
import type { BuildingKind, ConstructionOrder } from "../../game/types/building.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { escapeGameText, escapeHtml, iconMaskStyle, gameText, setGameHtml, setGameText, game } from "../text.ts";
import { panelHead } from "../panel.ts";
import { t } from "../../i18n/index.ts";

const CONSTRUCTION_TIP = {
    get body(): string { return t("panels.construction.help"); },
};

function icon(kind: BuildingKind): string {
    return `<span class="building-icon" aria-hidden="true" ${iconMaskStyle(BUILDING_PROFILES[kind].icon)}></span>`;
}

export class ConstructionPanel {
    scope: "state" | "province" = "state";
    selectedKind: BuildingKind | null = null;
    private readonly engine: GameEngine;
    private readonly el = document.querySelector<HTMLElement>("#construction-panel")!;
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
        this.el.addEventListener("dragstart", this.onDragStart);
        this.el.addEventListener("dragover", this.onDragOver);
        this.el.addEventListener("drop", this.onDrop);
        this.el.addEventListener("dragend", this.onDragEnd);
        this.el.addEventListener("click", this.onClick);
        this.allocation.className = "factory-allocation";
        this.allocation.id = "factory-allocation";
        this.allocation.setAttribute("role", "group");
        this.allocation.setAttribute("aria-label", t("panels.construction.factory.allocationLabel"));
        setGameHtml(this.allocation, `<button type="button" class="factory-step" data-factory-step="-1" aria-label="${t("panels.construction.factory.addIdle")}">−</button>
            <div class="factory-dial">
                <div class="factory-totals"><span>${"[[production]]"} <b data-factory-prod>0</b></span><span>${"[[idle]]"} <b data-factory-idle>0</b></span></div>
                <input id="factory-production" type="range" min="0" max="0" value="0" step="1" data-focus-key="factory-production" aria-label="${t("panels.construction.factory.productionCount")}" />
            </div>
            <button type="button" class="factory-step" data-factory-step="1" aria-label="${t("panels.construction.factory.addProduction")}">+</button>`);
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

    setHidden(hidden: boolean): void { this.el.classList.toggle("hidden", hidden); }

    render(): void {
        if (this.allocationBusy) {
            this.syncAllocation();
            return;
        }
        const scrollTop = this.el.querySelector(".panel-body")?.scrollTop ?? 0;
        const focused = this.el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focusKey : undefined;
        const state = this.engine.state;
        const totals = factoryTotals(state, 0);
        const queue = state.construction.filter((order) => order.nation === 0);
        const allocations = constructionPlan(state, 0);
        const assigned = allocations.reduce((sum, entry) => sum + entry.factories, 0);
        const finished = state.winner !== null;
        const local = this.scope === "province";
        const area = t(local ? "panels.construction.area.province" : "panels.construction.area.state");
        const kinds = local ? PROVINCE_BUILDING_KINDS : STATE_BUILDING_KINDS;
        const buildings = `<div class="deploy-head construction-step"><span>${t("panels.construction.build.step")}</span></div>
            <div class="construction-icons" role="group" aria-label="${t("panels.construction.build.pick", { area })}">${kinds.map((entry) => this.buildButton(entry, state.selected)).join("")}</div>`;
        setGameHtml(this.el, `${panelHead({
            title: t("panels.construction.title"),
            help: { title: t("panels.construction.helpTitle"), body: CONSTRUCTION_TIP.body },
            status: t("panels.construction.status", { count: queue.length }),
        })}
            <div class="construction-tabs" role="tablist" aria-label="${t("panels.construction.tabs.label")}">
                <button role="tab" id="construction-state-tab" aria-controls="construction-buildings" aria-selected="${this.scope === "state"}" data-action="construction-scope" data-mode="state" data-focus-key="scope-state" class="${this.scope === "state" ? "active" : ""}">${t("panels.construction.tabs.state")} <span>${t("panels.construction.tabs.stateDetail")}</span></button>
                <button role="tab" id="construction-province-tab" aria-controls="construction-buildings" aria-selected="${this.scope === "province"}" data-action="construction-scope" data-mode="province" data-focus-key="scope-province" class="${this.scope === "province" ? "active" : ""}">${t("panels.construction.tabs.province")} <span>${t("panels.construction.tabs.provinceDetail")}</span></button>
            </div>
            <div class="panel-body construction-body">
                <section class="construction-section construction-factories">
                    <div class="deploy-head"><span>${t("panels.construction.factory.title")}</span><span data-factory-summary></span></div>
                    <div data-factory-host></div>
                    <p class="micro-hint">${t("panels.construction.factory.hint")}</p>
                </section>
                <div id="construction-buildings" role="tabpanel" aria-labelledby="construction-${this.scope}-tab">${buildings}</div>
                <section class="construction-section construction-queue">
                    <div class="deploy-head"><span>${t("panels.construction.queue.title")}</span><span>${assigned} / ${totals.idle} ${t("panels.construction.queue.idleLabel")}</span></div>
                    <p class="micro-hint">${t("panels.construction.queue.hint")}</p>
                    ${finished ? `<div class="empty-hint">${t("panels.construction.ended")}</div>` : totals.idle === 0 ? `<p class="construction-warning">${t("panels.construction.queue.noIdle")}</p>` : ""}
                    <div class="construction-orders" role="list" aria-label="${t("panels.construction.queue.listLabel")}">${queue.map((order, index) => this.orderHtml(order, index, queue.length, allocations.find((entry) => entry.orderId === order.id)!)).join("") || `<div class="empty-hint">${t("panels.construction.queue.empty")}</div>`}<div class="queue-end" data-drop-end>${t("panels.construction.queue.dropEnd")}</div></div>
                </section>
            </div>`);
        this.el.querySelector("[data-factory-host]")!.appendChild(this.allocation);
        this.syncAllocation();
        this.el.querySelector(".panel-body")!.scrollTop = scrollTop;
        if (focused) this.el.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    }

    private syncAllocation(): void {
        const state = this.engine.state;
        const totals = factoryTotals(state, 0);
        this.allocation.dataset.tooltipTitle = t("panels.construction.factory.tooltipTitle");
        this.allocation.dataset.tooltipBody = t("panels.construction.factory.tooltip", { prod: totals.prod, idle: totals.idle, total: totals.total });
        this.production.max = String(totals.total);
        this.production.value = String(totals.prod);
        this.production.disabled = state.winner !== null || totals.total === 0;
        this.production.setAttribute("aria-valuetext", t("panels.construction.factory.valueText", { prod: totals.prod, idle: totals.idle }));
        this.production.style.setProperty("--production-share", `${totals.total ? totals.prod / totals.total * 100 : 0}%`);
        setGameText(this.allocation.querySelector<HTMLElement>("[data-factory-prod]")!, String(totals.prod), "plain");
        setGameText(this.allocation.querySelector<HTMLElement>("[data-factory-idle]")!, String(totals.idle), "plain");
        const summary = this.el.querySelector<HTMLElement>("[data-factory-summary]");
        if (summary) setGameText(summary, t("panels.construction.factory.summary", { prod: totals.prod, idle: totals.idle, total: totals.total }), "plain");
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

    private buildButton(kind: BuildingKind, selected: number | null): string {
        const state = this.engine.state;
        const province = selected === null ? undefined : state.provinces[selected];
        const region = province ? state.states[province.stateId] : undefined;
        const profile = BUILDING_PROFILES[kind];
        const local = kind === "supply" || kind === "fort";
        const area = t(local ? "panels.construction.area.province" : "panels.construction.area.state");
        const site = local ? province?.site : region?.center;
        const capacity = local ? province ? provinceBuildingCapacity(state, province, kind) : null
            : region ? stateBuildingCapacity(state, region, kind) : null;
        const enabled = local ? site !== undefined && canBuildProvince(state, 0, site, kind)
            : !!region && canBuild(state, 0, region.id, kind);
        const virtual: ConstructionOrder | null = enabled && site !== undefined ? { id: -1, nation: 0, site, kind, remainingPoints: profile.constructionPoints, paidFunds: profile.costFunds, paidIndustry: profile.costIndustry } : null;
        const eta = virtual ? constructionPlan({ ...state, construction: [...state.construction, virtual] }, 0).find((entry) => entry.orderId === -1)?.eta ?? null : null;
        const selectable = state.winner === null;
        const effects = kind === "infrastructure"
            ? t("panels.construction.effects.infrastructure")
            : kind === "supply"
                ? t("panels.construction.effects.supply", { desc: profile.desc })
                : profile.desc;
        const estimate = state.winner !== null ? t("panels.construction.endedShort") : enabled ? eta === null ? t("panels.construction.estimate.paused") : t("panels.construction.estimate.eta", { days: eta })
            : capacity && capacity.used >= capacity.limit ? t("panels.construction.estimate.full") : t("panels.construction.estimate.insufficient");
        const target = local ? province : region;
        const targetDetails = target && site !== undefined && capacity && state.provinces[site].owner === 0 && state.terrain.passable[site]
            ? t("panels.construction.build.targetDetails", { area, name: escapeGameText(target.name), built: capacity.built, limit: capacity.limit, pending: capacity.pending, estimate })
            : t("panels.construction.build.noTargetDetails");
        const body = t("panels.construction.build.body", {
            funds: profile.costFunds, industry: profile.costIndustry, points: profile.constructionPoints,
            targetDetails, effects, area, zoomHint: local ? t("panels.construction.build.zoomHint") : "",
        });
        return `<button class="construction-icon${selectable ? "" : " unavailable"}${this.selectedKind === kind ? " selected" : ""}" data-action="construction-kind" data-kind="${kind}" data-focus-key="build-${kind}" aria-label="${t("panels.construction.build.select", { name: profile.name })}" aria-disabled="${!selectable}" aria-pressed="${this.selectedKind === kind}" ${tooltipAttrs(profile.name, body)}>${icon(kind)}<span class="construction-icon-name">${profile.name}</span></button>`;
    }

    private orderHtml(order: ConstructionOrder, index: number, count: number, allocation: { factories: number; pointsPerTurn: number; eta: number | null }): string {
        const state = this.engine.state;
        const profile = BUILDING_PROFILES[order.kind];
        const province = state.provinces[order.site];
        const place = profile.scope === "state" ? state.states[province.stateId].name : province.name;
        const progress = Math.max(0, Math.min(100, (1 - order.remainingPoints / profile.constructionPoints) * 100));
        const etaText = allocation.eta === null ? t("panels.construction.paused") : t("panels.construction.order.eta", { days: allocation.eta });
        const eta = allocation.eta === null ? t("panels.construction.paused") : gameText(game`[[turn:${allocation.eta}]]`);
        const details = t("panels.construction.order.details", {
            scope: t(profile.scope === "state" ? "panels.construction.area.state" : "panels.construction.area.province"),
            place: escapeGameText(place),
            remaining: order.remainingPoints.toFixed(2), points: profile.constructionPoints,
            factories: allocation.factories, rate: allocation.pointsPerTurn.toFixed(2),
            etaText, desc: profile.desc,
        });
        const finished = state.winner !== null;
        return `<div class="construction-order" role="listitem" draggable="${!finished}" data-order-id="${order.id}" ${tooltipAttrs(profile.name, details)}>
            <div class="queue-line"><span class="queue-grip" aria-hidden="true">⠿</span><span class="queue-kind">${icon(order.kind)}</span><button class="queue-place" data-action="construction-jump" data-site="${order.site}" data-mode="${profile.scope}" data-focus-key="jump-${order.id}"><b>${profile.name}</b><span>${escapeHtml(place)}</span></button><div class="queue-factories" role="img" aria-label="${t("panels.construction.order.factoriesLabel", { count: allocation.factories })}"><span class="factory-cell-bar" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<i class="${i < allocation.factories ? "filled" : ""}"></i>`).join("")}</span>${icon("factory")}</div></div>
            <div class="queue-progress" role="progressbar" aria-label="${t("panels.construction.order.progressLabel", { name: profile.name })}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div>
            <div class="queue-footer"><span>${allocation.factories ? gameText(`[[construction:${allocation.pointsPerTurn.toFixed(2)}]]/[[turn]]`) : t("panels.construction.order.waiting")} · ${eta}</span><div class="queue-actions"><button data-queue-move="up" data-order="${order.id}" data-focus-key="up-${order.id}" aria-label="${t("panels.construction.order.moveUp", { name: profile.name })}" ${finished || index === 0 ? "disabled" : ""}>↑</button><button data-queue-move="down" data-order="${order.id}" data-focus-key="down-${order.id}" aria-label="${t("panels.construction.order.moveDown", { name: profile.name })}" ${finished || index === count - 1 ? "disabled" : ""}>↓</button><button data-action="build-cancel" data-order="${order.id}" aria-label="${t("panels.construction.order.cancel", { place, name: profile.name })}" ${finished ? "disabled" : ""}>×</button></div></div>
        </div>`;
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
