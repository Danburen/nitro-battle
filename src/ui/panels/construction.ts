import type { GameEngine } from "../../game/engine.ts";
import { canBuild, canBuildProvince, constructionPlan, factoryTotals, provinceBuildingCapacity, stateBuildingCapacity } from "../../game/economy.ts";
import { BUILDING_PROFILES, PROVINCE_BUILDING_KINDS, STATE_BUILDING_KINDS } from "../../game/types/building.ts";
import type { BuildingKind, ConstructionOrder } from "../../game/types/building.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { escapeGameText, escapeHtml, iconMaskStyle, renderGameText, textToken } from "../text.ts";
import { panelHead } from "../panel.ts";

const CONSTRUCTION_TIP = `2 · 选择建筑后，点击地图中的己方州；省份建筑点击己方省份。\n每次点击加入一项，可连续选址。\n地图显示「已建+在建 / 上限」：在建数字为绿色，正在施工的地块会覆盖绿色阴影；不可建造的地块统一为灰色。\n颜色图例：空闲 / 较少 / 较多 / 已满；省份建筑仅空闲 / 已满。\n右键或 Esc 取消当前建筑选择。\n\n州建筑仅作用于州中心及其同属省份；省份建筑每省每种限 1 座，放大地图显示容量数字。\n施工消耗[[idle]][[factory]]，每项最多 5 座，按队列顺序分配，多余工厂顺延；无[[idle]][[factory]]时施工暂停。\n取消未完成项目返还半数已付资源。`;

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
        this.allocation.setAttribute("aria-label", "全国工厂调配");
        this.allocation.innerHTML = `<button type="button" class="factory-step" data-factory-step="-1" aria-label="增加闲置工厂">−</button>
            <div class="factory-dial">
                <div class="factory-totals"><span>${renderGameText("[[production]]")} <b data-factory-prod>0</b></span><span>${renderGameText("[[idle]]")} <b data-factory-idle>0</b></span></div>
                <input id="factory-production" type="range" min="0" max="0" value="0" step="1" data-focus-key="factory-production" aria-label="生产工厂数量" />
            </div>
            <button type="button" class="factory-step" data-factory-step="1" aria-label="增加生产工厂">+</button>`;
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
        const area = local ? "省份" : "州";
        const kinds = local ? PROVINCE_BUILDING_KINDS : STATE_BUILDING_KINDS;
        const buildings = `<div class="deploy-head construction-step"><span>1 · 选择建筑</span></div>
            <div class="construction-icons" role="group" aria-label="选择${area}建筑类型">${kinds.map((entry) => this.buildButton(entry, state.selected)).join("")}</div>`;
        this.el.innerHTML = `${panelHead({
            title: "建造",
            help: { title: "建造说明", body: CONSTRUCTION_TIP },
            status: `${queue.length} 项工程`,
        })}
            <div class="construction-tabs" role="tablist" aria-label="建筑层级">
                <button role="tab" id="construction-state-tab" aria-controls="construction-buildings" aria-selected="${this.scope === "state"}" data-action="construction-scope" data-mode="state" data-focus-key="scope-state" class="${this.scope === "state" ? "active" : ""}">州建筑 <span>经济与管理</span></button>
                <button role="tab" id="construction-province-tab" aria-controls="construction-buildings" aria-selected="${this.scope === "province"}" data-action="construction-scope" data-mode="province" data-focus-key="scope-province" class="${this.scope === "province" ? "active" : ""}">省份建筑 <span>补给与防御</span></button>
            </div>
            <div class="panel-body construction-body">
                <section class="construction-section construction-factories">
                    <div class="deploy-head"><span>工厂调配</span><span data-factory-summary></span></div>
                    <div data-factory-host></div>
                    <p class="micro-hint">滚轮或拖动滑杆调整生产/闲置；闲置工厂按队列顺序投入施工。</p>
                </section>
                <div id="construction-buildings" role="tabpanel" aria-labelledby="construction-${this.scope}-tab">${buildings}</div>
                <section class="construction-section construction-queue">
                    <div class="deploy-head"><span>施工优先级</span><span>${assigned} / ${totals.idle} ${renderGameText("[[idle]]厂")}</span></div>
                    <p class="micro-hint">拖动排序 · 每项最多 5 厂 · 多余工厂顺延</p>
                    ${finished ? '<div class="empty-hint">战役已结束。</div>' : totals.idle === 0 ? '<p class="construction-warning">无闲置工厂，施工暂停。在上方「工厂调配」中把生产转为闲置。</p>' : ""}
                    <div class="construction-orders" role="list" aria-label="施工队列">${queue.map((order, index) => this.orderHtml(order, index, queue.length, allocations.find((entry) => entry.orderId === order.id)!)).join("") || '<div class="empty-hint">暂无施工项目</div>'}<div class="queue-end" data-drop-end>拖到这里移至队尾</div></div>
                </section>
            </div>`;
        this.el.querySelector("[data-factory-host]")!.appendChild(this.allocation);
        this.syncAllocation();
        this.el.querySelector(".panel-body")!.scrollTop = scrollTop;
        if (focused) this.el.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    }

    private syncAllocation(): void {
        const state = this.engine.state;
        const totals = factoryTotals(state, 0);
        this.allocation.dataset.tooltipTitle = "全国[[factory]]调配";
        this.allocation.dataset.tooltipBody = `[[production]] ${totals.prod} · [[idle]] ${totals.idle} · 总计 ${totals.total}\n\n滚轮向上：转为[[production]]；向下：转为[[idle]]。\n也可拖动滑杆、按方向键或使用两侧 − / +。\n\n[[production]][[factory]]产出[[funds]]与[[industry]]；[[idle]][[factory]]按队列顺序投入施工，每项至多 5 座，每厂基础 [[construction:0.5]]/[[turn]]。\n产出同时受来源州[[infrastructure]]影响，施工再乘目标州速度；优先把高产能工厂分配给生产。\n无[[idle]][[factory]]时，施工暂停。`;
        this.production.max = String(totals.total);
        this.production.value = String(totals.prod);
        this.production.disabled = state.winner !== null || totals.total === 0;
        this.production.setAttribute("aria-valuetext", `生产 ${totals.prod}，闲置 ${totals.idle}`);
        this.production.style.setProperty("--production-share", `${totals.total ? totals.prod / totals.total * 100 : 0}%`);
        this.allocation.querySelector<HTMLElement>("[data-factory-prod]")!.textContent = String(totals.prod);
        this.allocation.querySelector<HTMLElement>("[data-factory-idle]")!.textContent = String(totals.idle);
        const summary = this.el.querySelector<HTMLElement>("[data-factory-summary]");
        if (summary) summary.textContent = `生产 ${totals.prod} · 闲置 ${totals.idle} / 总计 ${totals.total}`;
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
        const area = local ? "省份" : "州";
        const site = local ? province?.site : region?.center;
        const capacity = local ? province ? provinceBuildingCapacity(state, province, kind) : null
            : region ? stateBuildingCapacity(state, region, kind) : null;
        const enabled = local ? site !== undefined && canBuildProvince(state, 0, site, kind)
            : !!region && canBuild(state, 0, region.id, kind);
        const virtual: ConstructionOrder | null = enabled && site !== undefined ? { id: -1, nation: 0, site, kind, remainingPoints: profile.constructionPoints, paidFunds: profile.costFunds, paidIndustry: profile.costIndustry } : null;
        const eta = virtual ? constructionPlan({ ...state, construction: [...state.construction, virtual] }, 0).find((entry) => entry.orderId === -1)?.eta ?? null : null;
        const selectable = state.winner === null;
        const effects = kind === "infrastructure"
            ? "L 为州[[infrastructure]]等级（0–8）：\n[[factory]]产能（含[[idle]]）= 80% + 5% × L\n施工速度 = 80% + 5% × L\n军队[[movement]]成本 = 100% − 5% × L\n[[supply]]效率 = 100% + 5% × L\n仅作用于与州中心同属一方的省份。"
            : kind === "supply"
                ? `${profile.desc}\n沿己方陆地向外衰减：u = 1 − 距离/8。\n[[supply]] =（原[[supply]] + 10% × u）×（1 + 20% × u），再乘州[[infrastructure]]补给系数。`
                : profile.desc;
        const estimate = state.winner !== null ? "战役已结束" : enabled ? eta === null ? "暂停：无可分配工厂" : `${textToken("turn", eta)}（含队列等待）`
            : capacity && capacity.used >= capacity.limit ? "该参考目标已满（包含在建）" : "资金或工业不足";
        const target = local ? province : region;
        const targetDetails = target && site !== undefined && capacity && state.provinces[site].owner === 0 && state.terrain.passable[site]
            ? `参考${area} · ${escapeGameText(target.name)}\n已建 ${capacity.built}/${capacity.limit} · 待建 ${capacity.pending}\n预计完成  ${estimate}`
            : "预计完成  选址后按目标基建与队列估算";
        const body = `资源花费  [[funds:${profile.costFunds}]] · [[industry:${profile.costIndustry}]]\n施工需求  [[construction:${profile.constructionPoints}]]\n${targetDetails}\n\n${effects}\n\n先选此建筑，再点击己方${area}直接入队；无需预先选址。地图容量包含在建${local ? "，放大后显示数字" : ""}。\n预估固定当前产能，竣工增益不提前计入。`;
        return `<button class="construction-icon${selectable ? "" : " unavailable"}${this.selectedKind === kind ? " selected" : ""}" data-action="construction-kind" data-kind="${kind}" data-focus-key="build-${kind}" aria-label="选择${profile.name}" aria-disabled="${!selectable}" aria-pressed="${this.selectedKind === kind}" ${tooltipAttrs(profile.name, body)}>${icon(kind)}<span class="construction-icon-name">${profile.name}</span></button>`;
    }

    private orderHtml(order: ConstructionOrder, index: number, count: number, allocation: { factories: number; pointsPerTurn: number; eta: number | null }): string {
        const state = this.engine.state;
        const profile = BUILDING_PROFILES[order.kind];
        const province = state.provinces[order.site];
        const place = profile.scope === "state" ? state.states[province.stateId].name : province.name;
        const progress = Math.max(0, Math.min(100, (1 - order.remainingPoints / profile.constructionPoints) * 100));
        const etaText = allocation.eta === null ? "暂停" : `${textToken("turn", allocation.eta)}（含等待）`;
        const eta = allocation.eta === null ? "暂停" : renderGameText(textToken("turn", allocation.eta));
        const details = `${profile.scope === "state" ? "州" : "省份"} · ${escapeGameText(place)}\n剩余[[construction]] ${order.remainingPoints.toFixed(2)} / ${profile.constructionPoints}\n分配[[factory]] ${allocation.factories}/5 · [[construction:${allocation.pointsPerTurn.toFixed(2)}]]/[[turn]]\n预计完成 ${etaText}\n\n${profile.desc}\n[[factory]]在下一[[turn]]重新分配；取消返还半数已付资源。`;
        const finished = state.winner !== null;
        return `<div class="construction-order" role="listitem" draggable="${!finished}" data-order-id="${order.id}" ${tooltipAttrs(profile.name, details)}>
            <div class="queue-line"><span class="queue-grip" aria-hidden="true">⠿</span><span class="queue-kind">${icon(order.kind)}</span><button class="queue-place" data-action="construction-jump" data-site="${order.site}" data-mode="${profile.scope}" data-focus-key="jump-${order.id}"><b>${profile.name}</b><span>${escapeHtml(place)}</span></button><div class="queue-factories" role="img" aria-label="已分配 ${allocation.factories} 座工厂，共 5 槽"><span class="factory-cell-bar" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<i class="${i < allocation.factories ? "filled" : ""}"></i>`).join("")}</span>${icon("factory")}</div></div>
            <div class="queue-progress" role="progressbar" aria-label="${profile.name}建造进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div>
            <div class="queue-footer"><span>${allocation.factories ? renderGameText(`[[construction:${allocation.pointsPerTurn.toFixed(2)}]]/[[turn]]`) : "等待分配"} · ${eta}</span><div class="queue-actions"><button data-queue-move="up" data-order="${order.id}" data-focus-key="up-${order.id}" aria-label="上移${profile.name}" ${finished || index === 0 ? "disabled" : ""}>↑</button><button data-queue-move="down" data-order="${order.id}" data-focus-key="down-${order.id}" aria-label="下移${profile.name}" ${finished || index === count - 1 ? "disabled" : ""}>↓</button><button data-action="build-cancel" data-order="${order.id}" aria-label="取消${place}${profile.name}施工" ${finished ? "disabled" : ""}>×</button></div></div>
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
