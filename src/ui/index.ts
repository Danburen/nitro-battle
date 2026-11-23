import type { GameEngine } from "../game/engine.ts";
import { BUILDING_KINDS, BUILDING_PROFILES } from "../game/types/building.ts";
import { POLICY_SWITCH_COST, POLICY_SWITCH_DAYS, POLICY_SWITCH_UPKEEP } from "../game/types/policy.ts";
import type { BuildingKind } from "../game/types/building.ts";
import type { PolicyCategory } from "../game/types/policy.ts";
import { nationDisplayColor } from "../game/access.ts";
import { POLICY_LABELS, policyOption } from "../game/policy.ts";
import { CLAIM_COST } from "../game/diplomacy.ts";
import { provinceBuildingCapacity, stateBuildingCapacity } from "../game/economy.ts";
import { CONSTRUCTION_BLOCKED_COLOR, CONSTRUCTION_COLORS } from "../render/index.ts";
import type { SoundManager } from "../audio/index.ts";
import type { UIContext, UICallbacks } from "./context.ts";
import { TopBar } from "./topbar.ts";
import { GlobalTooltip } from "./tooltip.ts";
import { BattleReport } from "./report/feed.ts";
import { Briefing } from "./briefing.ts";
import { IntelPanel } from "./panels/intel.ts";
import { ArmyListPanel } from "./panels/armies.ts";
import { ArmyDetailPanel } from "./panels/armyDetail.ts";
import { DeployPanel } from "./panels/deploy.ts";
import { ConstructionPanel } from "./panels/construction.ts";
import { PolicyPanel } from "./panels/policy.ts";
import { DiplomacyPanel } from "./panels/diplomacy.ts";
import { ExpansionPanel } from "./panels/expansion.ts";
import { renderModeBar } from "./modeBar.ts";
import { showEndOverlay } from "./endOverlay.ts";
import { handleArmyAction, handleDiplomacyAction, handleEconomyAction } from "./actions.ts";
import { ConfirmDialog } from "./confirm.ts";
import type { ConfirmSpec } from "./confirm.ts";
import { MapLegend } from "./mapLegend.ts";
import { setGameText, textToken } from "./text.ts";

type TabId = "deploy" | "construction" | "policy" | "diplomacy" | "expansion";

/** UI controller: event delegation, selection mode and refresh orchestration. */
export class GameUI implements UIContext {
    readonly engine: GameEngine;
    readonly sound: SoundManager;
    readonly multiSelect = new Set<number>();
    readonly splitChecks = new Set<number>();
    private readonly callbacks: UICallbacks;
    private readonly unsubscribe: () => void;
    private toastTimer = 0;
    private dockCollapsed = false;
    private activeTab: TabId = "diplomacy";
    private mapMode: "province" | "state" = "province";
    private layersCollapsed = false;
    private settingsOpen = false;
    private refreshFrame = 0;
    private refreshTasks: (() => void)[] = [];
    private refreshAgain = false;

    private readonly topbar: TopBar;
    private readonly tooltip: GlobalTooltip;
    private readonly feed: BattleReport;
    readonly briefing: Briefing;
    private readonly intel: IntelPanel;
    private readonly armies: ArmyListPanel;
    private readonly detail: ArmyDetailPanel;
    private readonly deploy: DeployPanel;
    private readonly construction: ConstructionPanel;
    private readonly policy: PolicyPanel;
    private readonly diplomacy: DiplomacyPanel;
    private readonly expansion: ExpansionPanel;
    private readonly confirmDialog: ConfirmDialog;
    private readonly legend: MapLegend;

    private readonly hud = document.querySelector<HTMLElement>("#hud") as HTMLElement;
    private readonly armyPanelEl = document.querySelector<HTMLElement>("#army-panel") as HTMLElement;
    private readonly narrowQuery = window.matchMedia("(max-width: 820px)");
    private readonly infoTabs = document.querySelector<HTMLElement>("#info-tabs") as HTMLElement;
    private readonly dockToggleBtn = document.querySelector<HTMLButtonElement>("#btn-dock") as HTMLButtonElement;
    private readonly endOverlay = document.querySelector<HTMLElement>("#end-overlay") as HTMLElement;
    private readonly toastEl = document.querySelector<HTMLElement>("#toast") as HTMLElement;
    private readonly modeBar = document.querySelector<HTMLElement>("#mode-bar") as HTMLElement;
    private readonly hintEl = document.querySelector<HTMLElement>("#hint") as HTMLElement;
    private readonly menuBtn = document.querySelector<HTMLButtonElement>("#btn-menu");
    private readonly homeBtn = document.querySelector<HTMLButtonElement>("#btn-home");
    private readonly settingsBtn = document.querySelector<HTMLButtonElement>("#btn-settings") as HTMLButtonElement;
    private readonly settingsPop = document.querySelector<HTMLElement>("#settings-pop") as HTMLElement;
    private readonly claimBanner = document.querySelector<HTMLElement>("#claim-manage-banner") as HTMLElement;

    constructor(engine: GameEngine, sound: SoundManager, callbacks: UICallbacks) {
        this.engine = engine;
        this.sound = sound;
        this.callbacks = callbacks;

        this.tooltip = new GlobalTooltip();
        this.topbar = new TopBar(engine, sound, (text) => this.toast(text));
        this.feed = new BattleReport(engine);
        this.briefing = new Briefing(engine, {
            inspect: (nationId) => this.callbacks.onBriefingInspect(nationId),
            start: (nationId) => this.callbacks.onBriefingEnd(nationId),
        });
        this.intel = new IntelPanel(engine);
        this.armies = new ArmyListPanel(engine, this.multiSelect);
        this.detail = new ArmyDetailPanel(engine, this.splitChecks);
        this.deploy = new DeployPanel(engine);
        this.construction = new ConstructionPanel(engine);
        this.policy = new PolicyPanel(engine);
        this.diplomacy = new DiplomacyPanel(engine, { toast: (message) => this.toast(message), sound: this.sound });
        this.expansion = new ExpansionPanel(engine, {
            focus: (stateId) => this.callbacks.onClaimFocus(stateId),
        });
        this.confirmDialog = new ConfirmDialog(this.hud);
        this.legend = new MapLegend(document.querySelector<HTMLElement>("#map-legend") as HTMLElement);

        this.topbar.endTurnBtn.addEventListener("click", this.handleEndTurn);
        this.topbar.soundBtn.addEventListener("click", this.handleSound);
        this.menuBtn?.addEventListener("click", this.handleMenu);
        this.homeBtn?.addEventListener("click", this.handleHome);
        this.settingsBtn.addEventListener("click", this.handleSettingsToggle);
        document.addEventListener("pointerdown", this.onSettingsPointerDown, true);
        window.addEventListener("resize", this.onSettingsResize);

        this.hud.addEventListener("click", this.handleSidebar);
        this.narrowQuery.addEventListener("change", this.handleNarrow);
        if (this.narrowQuery.matches) this.armyPanelEl.classList.add("army-collapsed");
        this.hud.addEventListener("change", this.handleSidebarChange);
        this.hud.addEventListener("input", this.handleSidebarInput);
        this.infoTabs.addEventListener("click", this.handleTabs);
        this.endOverlay.addEventListener("click", this.handleEndOverlay);
        document.addEventListener("keydown", this.handleKey);

        this.unsubscribe = engine.subscribe((event) => {
            if (event.type === "gameover") showEndOverlay(engine, sound, event.winner);
            this.scheduleRefresh();
        });
        this.setTab("diplomacy");
        this.refresh();
    }

    destroy(): void {
        this.unsubscribe();
        this.cancelRefreshFrame();
        this.refreshTasks.length = 0;
        this.topbar.endTurnBtn.removeEventListener("click", this.handleEndTurn);
        this.topbar.soundBtn.removeEventListener("click", this.handleSound);
        this.menuBtn?.removeEventListener("click", this.handleMenu);
        this.homeBtn?.removeEventListener("click", this.handleHome);
        this.settingsBtn.removeEventListener("click", this.handleSettingsToggle);
        document.removeEventListener("pointerdown", this.onSettingsPointerDown, true);
        window.removeEventListener("resize", this.onSettingsResize);
        this.closeSettings();
        this.hud.removeEventListener("click", this.handleSidebar);
        this.narrowQuery.removeEventListener("change", this.handleNarrow);
        this.hud.removeEventListener("change", this.handleSidebarChange);
        this.hud.removeEventListener("input", this.handleSidebarInput);
        this.infoTabs.removeEventListener("click", this.handleTabs);
        this.endOverlay.removeEventListener("click", this.handleEndOverlay);
        document.removeEventListener("keydown", this.handleKey);
        this.endOverlay.classList.add("hidden");
        this.feed.destroy();
        this.briefing.destroy();
        this.topbar.destroy();
        this.construction.destroy();
        this.diplomacy.destroy();
        this.expansion.cancelDraft();
        this.claimBanner.classList.add("hidden");
        this.hud.classList.remove("claim-managing");
        this.confirmDialog.close();
        this.legend.set(null);
        this.tooltip.destroy();
        window.clearTimeout(this.toastTimer);
        this.detail.hide();
        this.dockCollapsed = false;
        this.hud.classList.remove("dock-collapsed", "command-mode", "construction-mode", "layers-collapsed", "focus-mode");
        this.armyPanelEl.classList.remove("army-collapsed");
        this.dockToggleBtn.textContent = "«";
        this.multiSelect.clear();
        this.splitChecks.clear();
    }

    toast(text: string): void {
        setGameText(this.toastEl, text);
        this.toastEl.classList.add("show");
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 2200);
    }

    /** Enter the pre-game inspection mode: map + nation detail only. */
    startBriefing(nationId: number): void {
        this.briefing.start(nationId);
    }

    confirm(spec: ConfirmSpec): void {
        this.confirmDialog.show(spec);
    }

    /** Full synchronous refresh; used for direct UI actions that need an immediate result. */
    refresh(): void {
        this.cancelRefreshFrame();
        this.refreshTasks.length = 0;
        this.refreshAgain = false;
        for (const task of this.buildRefreshTasks()) task();
    }

    /**
     * Engine events arrive in bursts (end turn resolves every army). Coalesce
     * them to one refresh, then spread panels over frames under a time budget
     * so a large war resolution never blocks a single frame.
     */
    private scheduleRefresh(): void {
        if (this.refreshFrame !== 0) {
            this.refreshAgain = true;
            return;
        }
        this.refreshFrame = requestAnimationFrame(this.runRefreshSlice);
    }

    private cancelRefreshFrame(): void {
        if (this.refreshFrame !== 0) cancelAnimationFrame(this.refreshFrame);
        this.refreshFrame = 0;
    }

    private readonly runRefreshSlice = (): void => {
        this.refreshFrame = 0;
        if (this.refreshTasks.length === 0) this.refreshTasks = this.buildRefreshTasks();

        const deadline = performance.now() + 5;
        while (this.refreshTasks.length > 0) {
            this.refreshTasks.shift()!();
            if (performance.now() >= deadline) break;
        }

        if (this.refreshTasks.length > 0) {
            this.refreshFrame = requestAnimationFrame(this.runRefreshSlice);
        } else if (this.refreshAgain) {
            this.refreshAgain = false;
            this.refreshFrame = requestAnimationFrame(this.runRefreshSlice);
        }
    };

    /** Housekeeping runs up front; panel renders are returned as individual slices. */
    private buildRefreshTasks(): (() => void)[] {
        const state = this.engine.state;
        // Briefing shows the map and one nation panel only; keep hidden HUD work off the frame.
        if (this.briefing?.isActive()) return [() => this.topbar.render()];
        for (const id of [...this.multiSelect]) {
            if (!state.armies.has(id)) this.multiSelect.delete(id);
        }
        const army = this.engine.selectedArmy();
        if (army) {
            const valid = new Set(army.regiments.map((regiment) => regiment.id));
            for (const id of [...this.splitChecks]) {
                if (!valid.has(id)) this.splitChecks.delete(id);
            }
        } else {
            this.splitChecks.clear();
        }

        // Command mode: an army is selected, so the global dock and province
        // panel yield the left side to the detail window.
        const commandMode = army !== null && state.winner === null;
        this.hud.classList.toggle("command-mode", commandMode);
        if (commandMode && this.mapMode !== "province") this.changeMapMode("province");

        const tasks: (() => void)[] = [
            () => this.topbar.render(),
            () => this.intel.render(this.mapMode),
        ];
        if (this.activeTab === "construction") tasks.push(() => this.construction.render());
        tasks.push(
            () => this.renderLayers(),
            () => this.armies.render(),
            () => this.detail.render(),
            () => this.deploy.render(),
            () => this.policy.render(),
            () => this.diplomacy.render(),
            () => {
                this.expansion.render();
                this.syncClaimBanner();
            },
            () => this.feed.render(),
            () => this.syncConstructionView(),
            () => this.tooltip.refresh(),
        );
        return tasks;
    }

    private readonly handleEndTurn = (): void => {
        if (this.briefing.isActive()) {
            this.sound.play("select");
            // Committing may tear this UI down and build the campaign UI; do nothing after it.
            this.briefing.finish();
            return;
        }
        if (this.engine.state.winner !== null) return;
        this.sound.play("endTurn");
        this.engine.endTurn();
    };
    private readonly handleSound = (): void => this.topbar.toggleSound();
    private readonly handleMenu = (): void => this.callbacks.onNewGame();
    private readonly handleHome = (): void => this.callbacks.onHome();
    private readonly handleSidebar = (event: Event): void => this.handleSidebarClick(event);
    private readonly handleTabs = (event: Event): void => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-tab]");
        if (!button) return;
        this.setTab(button.dataset.tab as TabId);
    };

    isConstructionOpen(): boolean {
        return this.activeTab === "construction" && !this.dockCollapsed && this.engine.selectedArmy() === null;
    }

    isClaimsOpen(): boolean {
        return this.activeTab === "expansion" && !this.dockCollapsed && this.mapMode === "state"
            && this.engine.selectedArmy() === null;
    }

    handleClaimsMapClick(site: number): void {
        const stateId = this.engine.state.provinces[site]?.stateId ?? -1;
        if (stateId < 0) return;
        this.expansion.focusFromMap(stateId);
        this.engine.select(site);
        if (!this.expansion.isManaging()) {
            this.sound.play("select");
            this.toast("点击「管理宣称」进入管理：在地图上标记新增或取消");
            return;
        }
        const result = this.expansion.toggleDraft(stateId);
        this.sound.play(result.ok ? "recruit" : "error");
        this.toast(result.message);
    }

    centerSite(site: number): void {
        this.callbacks.onCenterSite(site);
    }

    /**
     * Focus/edit mode for the two map-authoring workflows (construction and
     * claims): the battle feed and army list step aside so the map and the
     * working panel get the room. Driven by the same conditions as the hints.
     */
    private syncFocusMode(): void {
        const focus = this.engine.state.winner === null &&
            (this.isConstructionOpen() || this.isClaimsOpen());
        this.hud.classList.toggle("focus-mode", focus);
    }

    private syncConstructionView(): void {
        this.syncFocusMode();
        const selected = this.construction.selectedKind;
        const kind = this.isConstructionOpen() && selected !== null && BUILDING_PROFILES[selected].scope === this.mapMode && this.engine.state.winner === null
            ? selected : null;
        this.callbacks.onConstructionView(kind);
        this.callbacks.onClaimsOverlay(this.isClaimsOpen() && this.engine.state.winner === null);
        renderModeBar(this.engine, this.modeBar, this.hintEl, this.hud.classList.contains("command-mode"));
        const area = this.mapMode === "state" ? "州" : "省份";
        if (kind) this.hintEl.textContent = `已选${BUILDING_PROFILES[kind].name} · 点击己方${area}加入队列 · 右键 / Esc 取消`;
        else if (this.isConstructionOpen() && this.engine.state.winner === null) this.hintEl.textContent = `先选择左侧建筑，再点击己方${area}加入队列`;
        else if (this.isClaimsOpen() && this.engine.state.winner === null) this.hintEl.textContent = "扩张页：进入「管理宣称」后点击金色闪烁州标记新增 · 已宣称州以我方颜色覆盖 · Esc 确认退出";
        this.syncMapLegend();
    }

    /** Legend mirrors whichever panel currently owns a special map render mode. */
    private syncMapLegend(): void {
        const state = this.engine.state;
        if (state.winner !== null) {
            this.legend.set(null);
            return;
        }
        if (this.isClaimsOpen()) {
            this.legend.set({
                title: "扩张 · 州图例",
                items: [
                    { label: "可宣称", pulse: true },
                    { label: "已宣称", overlay: nationDisplayColor(state, 0) },
                    { label: "聚焦州", ring: true },
                ],
                note: "金色闪烁可点击宣称 · 再次点击取消并返还[[politics]]",
            });
            return;
        }
        const kind = this.construction.selectedKind;
        if (this.isConstructionOpen() && kind !== null && BUILDING_PROFILES[kind].scope === this.mapMode) {
            const local = BUILDING_PROFILES[kind].scope === "province";
            this.legend.set({
                title: `建造 · ${BUILDING_PROFILES[kind].name}`,
                items: [
                    { label: "空闲", color: CONSTRUCTION_COLORS.empty },
                    ...(local ? [] : [
                        { label: "较少", color: CONSTRUCTION_COLORS.low },
                        { label: "较多", color: CONSTRUCTION_COLORS.high },
                    ]),
                    { label: "已满", color: CONSTRUCTION_COLORS.full },
                    { label: "不可建造", color: CONSTRUCTION_BLOCKED_COLOR },
                ],
                note: `地图＝已建＋在建 / 上限 · ${local ? "省份" : "州"}容量；绿色数字与阴影＝施工中`,
            });
            return;
        }
        this.legend.set(null);
    }

    cancelConstructionSelection(): boolean {
        if (!this.isConstructionOpen() || this.construction.selectedKind === null) return false;
        this.construction.selectedKind = null;
        this.tooltip.hide();
        this.refresh();
        return true;
    }

    handleConstructionMapClick(site: number): void {
        this.selectConstructionSite(site);
        const kind = this.construction.selectedKind;
        const state = this.engine.state;
        if (!kind || BUILDING_PROFILES[kind].scope !== this.mapMode || state.winner !== null) {
            this.sound.play("select");
            return;
        }
        const province = state.provinces[site];
        const region = state.states[province.stateId];
        const local = kind === "supply" || kind === "fort";
        const area = local ? "省份" : "州";
        if (!state.terrain.passable[site] || province.owner !== 0 || (!local && (!region || state.provinces[region.center].owner !== 0))) {
            this.sound.play("error");
            this.toast(`只能在己方控制的陆地${area}内建造`);
            return;
        }
        const queued = local ? this.engine.queueProvinceBuild(site, kind) : this.engine.queueBuild(region.id, kind);
        if (queued) {
            this.sound.play("recruit");
            this.toast(`${local ? province.name : region.name}：${BUILDING_PROFILES[kind].name}已加入施工队列`);
        } else {
            this.sound.play("error");
            const { used, limit } = local ? provinceBuildingCapacity(state, province, kind) : stateBuildingCapacity(state, region, kind);
            this.toast(used >= limit ? `该${area}已满（包含在建），请选择其他${area}` : "资金或工业不足，无法建造");
        }
    }

    selectConstructionSite(site: number): void {
        this.engine.select(site);
    }

    private setTab(tab: TabId): void {
        this.tooltip.hide();
        if (tab === "construction" && this.activeTab !== tab) this.construction.selectedKind = null;
        this.activeTab = tab;
        this.hud.classList.toggle("construction-mode", tab === "construction");
        for (const button of this.infoTabs.querySelectorAll<HTMLElement>("[data-tab]")) {
            button.classList.toggle("active", button.dataset.tab === tab);
        }
        this.deploy.setHidden(tab !== "deploy");
        this.construction.setHidden(tab !== "construction");
        this.policy.setHidden(tab !== "policy");
        this.diplomacy.setHidden(tab !== "diplomacy");
        this.expansion.setHidden(tab !== "expansion");
        if (tab === "construction") this.changeMapMode(this.construction.scope);
        if (tab === "expansion") this.changeMapMode("state");
        if (tab !== "expansion") {
            this.expansion.clearFocus();
            if (this.expansion.isManaging()) {
                this.expansion.cancelDraft();
                this.syncClaimBanner();
                this.toast("已退出宣称管理，未确认的宣称变更已丢弃");
            }
        }
        this.syncConstructionView();
    }

    private changeMapMode(mode: "province" | "state"): void {
        this.tooltip.hide();
        this.mapMode = mode;
        if (this.construction.selectedKind && BUILDING_PROFILES[this.construction.selectedKind].scope !== mode) this.construction.selectedKind = null;
        this.construction.scope = mode;
        this.callbacks.onMapMode(mode);
        if (mode === "state") {
            this.multiSelect.clear();
            this.splitChecks.clear();
            if (this.engine.state.selectedArmyId !== null || this.engine.state.redeployArmyId !== null) {
                this.engine.select(this.engine.state.selected);
                return;
            }
            this.armies.render();
        }
        this.intel.render(mode);
        if (this.activeTab === "construction") this.construction.render();
        this.renderLayers();
        this.syncConstructionView();
    }

    private renderLayers(): void {
        const options = document.querySelector<HTMLElement>("#map-layer-options")!;
        options.classList.toggle("hidden", this.layersCollapsed);
        document.querySelector("#map-layers")!.classList.toggle("collapsed", this.layersCollapsed);
        this.hud.classList.toggle("layers-collapsed", this.layersCollapsed);
        document.querySelector("[data-action='layers-toggle']")!.setAttribute("aria-expanded", String(!this.layersCollapsed));
        document.querySelector("#map-layer-name")!.textContent = this.mapMode === "state" ? "州" : "省份";
        document.querySelector("#map-layer-chevron")!.textContent = this.layersCollapsed ? "▸" : "▾";
        for (const button of options.querySelectorAll<HTMLElement>("[data-mode]")) {
            const active = button.dataset.mode === this.mapMode;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        this.syncSettings();
    }

    private syncSettings(): void {
        const colorMode = this.callbacks.getColorMode();
        for (const button of this.settingsPop.querySelectorAll<HTMLElement>("[data-color]")) {
            const active = button.dataset.color === colorMode;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        const deepZoom = this.callbacks.getDeepZoom();
        const threshold = this.settingsPop.querySelector<HTMLInputElement>("#color-threshold")!;
        threshold.value = String(deepZoom);
        threshold.disabled = colorMode === "uniform";
        this.settingsPop.querySelector<HTMLElement>("#color-threshold-value")!.textContent = deepZoom.toFixed(2);
    }

    private readonly handleSettingsToggle = (): void => {
        if (this.settingsOpen) this.closeSettings();
        else this.openSettings();
    };

    private openSettings(): void {
        this.settingsOpen = true;
        this.settingsPop.classList.remove("hidden");
        this.settingsBtn.setAttribute("aria-expanded", "true");
        this.syncSettings();
        this.positionSettings();
        this.sound.play("select");
    }

    private closeSettings(): boolean {
        if (!this.settingsOpen) return false;
        this.settingsOpen = false;
        this.settingsPop.classList.add("hidden");
        this.settingsBtn.setAttribute("aria-expanded", "false");
        return true;
    }

    private readonly onSettingsPointerDown = (event: PointerEvent): void => {
        const target = event.target as HTMLElement;
        if (this.settingsOpen && !this.settingsPop.contains(target) && !this.settingsBtn.contains(target)) this.closeSettings();
    };

    private readonly onSettingsResize = (): void => {
        if (this.settingsOpen) this.positionSettings();
    };

    private positionSettings(): void {
        const rect = this.settingsBtn.getBoundingClientRect();
        const width = this.settingsPop.offsetWidth;
        const height = this.settingsPop.offsetHeight;
        let left = rect.right - width;
        left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8));
        let top = rect.bottom + 8;
        if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
        this.settingsPop.style.left = `${Math.round(left)}px`;
        this.settingsPop.style.top = `${Math.round(top)}px`;
    }

    private readonly handleSidebarInput = (event: Event): void => {
        const target = event.target as HTMLInputElement;
        if (target.id === "color-threshold") {
            this.callbacks.onDeepZoom(Number(target.value));
            this.syncSettings();
        }
    };

    private readonly handleSidebarChange = (event: Event): void => {
        const target = event.target as HTMLElement;
        const select = target.closest<HTMLSelectElement>("[data-action='train-target']");
        if (select) {
            const orderId = Number(select.dataset.order);
            const site = select.value === "" ? null : Number(select.value);
            this.engine.setTrainDestination(orderId, site);
            return;
        }
        const check = target.closest<HTMLInputElement>("[data-action='split-check']");
        if (check) {
            const regimentId = Number(check.dataset.reg);
            if (check.checked) this.splitChecks.add(regimentId);
            else this.splitChecks.delete(regimentId);
            this.detail.render();
        }
    };

    private readonly handleEndOverlay = (event: Event): void => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-end]");
        if (!target) return;
        if (target.dataset.end === "restart") this.callbacks.onRestart();
        else {
            this.endOverlay.classList.add("hidden");
            this.callbacks.onNewGame();
        }
    };

    private handleKey = (event: KeyboardEvent): void => {
        const tag = (event.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (tag === "BUTTON" && event.key === " ")) return;
        if (!document.querySelector("#start-overlay")?.classList.contains("hidden")) return;
        if (document.querySelector("#guide-overlay")?.classList.contains("open")) return;
        if (this.briefing.isActive()) {
            if (event.key === "e" || event.key === "E" || event.key === " ") {
                event.preventDefault();
                this.handleEndTurn();
            }
            return;
        }
        if (this.confirmDialog.isOpen) {
            if (event.key === "Escape") {
                event.preventDefault();
                this.confirmDialog.close();
            }
            return;
        }
        if ((event.target as HTMLElement).dataset.action === "construction-scope" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            const mode = event.key === "ArrowLeft" ? "state" : "province";
            this.changeMapMode(mode);
            document.querySelector<HTMLElement>(`[data-action="construction-scope"][data-mode="${mode}"]`)?.focus();
            return;
        }
        if (event.key === "e" || event.key === "E" || event.key === " ") {
            event.preventDefault();
            this.handleEndTurn();
        } else if (event.key === "Escape") {
            if (this.diplomacy.closeActionMenu()) return;
            if (this.closeSettings()) return;
            if (this.diplomacy.closeDeclare()) return;
            if (this.expansion.isManaging()) {
                event.preventDefault();
                this.requestClaimExit();
                return;
            }
            if (this.cancelConstructionSelection()) return;
            if (this.isClaimsOpen() && this.expansion.clearFocus()) return;
            this.multiSelect.clear();
            this.splitChecks.clear();
            this.engine.cancelModes();
            this.engine.select(null);
        } else if (event.key === "m" || event.key === "M") {
            this.topbar.toggleSound();
        }
    };

    private readonly handleNarrow = (event: MediaQueryListEvent): void => {
        this.armyPanelEl.classList.toggle("army-collapsed", event.matches);
        this.armies.render();
    };

    /** Policy chips go through a confirm card; a pending target click cancels its switch. */
    private requestPolicySwitch(target: HTMLElement): void {
        const state = this.engine.state;
        const player = state.nations[0];
        const category = target.dataset.category as PolicyCategory | undefined;
        const value = target.dataset.value ?? "";
        if (!category || !value || !POLICY_LABELS[category] || state.winner !== null) return;
        const currentName = policyOption(category, player.policies[category])?.name ?? player.policies[category];
        const transition = player.policyTransitions?.[category];

        if (transition) {
            if (transition.to !== value) {
                this.sound.play("error");
                this.toast(`该组政策正在切换：先点击带时钟的「${policyOption(category, transition.to)?.name ?? transition.to}」取消`);
                return;
            }
            const remaining = Math.max(0, transition.readyDay - state.day);
            const targetName = policyOption(category, transition.to)?.name ?? transition.to;
            this.confirmDialog.show({
                title: `取消${POLICY_LABELS[category]}政策切换`,
                body: `「${currentName} → ${targetName}」还需 ${textToken("turn", remaining)}。\n取消后回到「${currentName}」；已支付的 ${textToken("politics", POLICY_SWITCH_COST)} 与每日维护不返还，重新切换仍需 ${textToken("turn", POLICY_SWITCH_DAYS)}。`,
                danger: true,
                onConfirm: () => {
                    if (this.engine.cancelPolicySwitch(category)) {
                        this.sound.play("select");
                        this.toast(`已取消${POLICY_LABELS[category]}政策切换，已花费[[politics]]不返还`);
                    } else {
                        this.sound.play("error");
                    }
                },
            });
            return;
        }

        if (player.policies[category] === value) return;
        if (player.politicalPower < POLICY_SWITCH_COST) {
            this.sound.play("error");
            this.toast(`${textToken("politics", POLICY_SWITCH_COST)}不足，无法开始切换`);
            return;
        }
        const nextName = policyOption(category, value)?.name ?? value;
        this.confirmDialog.show({
            title: `切换${POLICY_LABELS[category]}政策`,
            body: `${currentName} → ${nextName}\n开始支付 ${textToken("politics", POLICY_SWITCH_COST)}，切换期间每日维护 ${textToken("politics", -POLICY_SWITCH_UPKEEP)}。\n需 ${textToken("turn", POLICY_SWITCH_DAYS)} 完成，增益按进度逐步生效；期间再次点击目标可取消，已花费[[politics]]不返还。`,
            onConfirm: () => {
                if (this.engine.startPolicySwitch(category, value)) {
                    this.sound.play("select");
                    this.toast(`已开始${POLICY_LABELS[category]}政策切换（${textToken("politics", -POLICY_SWITCH_COST)}）`);
                } else {
                    this.sound.play("error");
                    this.toast("无法开始切换：[[politics]]不足或目标无效");
                }
            },
        });
    }

    private enterClaimManagement(): void {
        if (this.engine.state.winner !== null) {
            this.sound.play("error");
            this.toast("战役已结束，无法管理宣称");
            return;
        }
        if (!this.expansion.enterManage()) return;
        this.sound.play("select");
        this.syncClaimBanner();
        this.toast("已进入宣称管理：点击地图州标记新增 / 取消，按 Esc 确认退出");
    }

    /** Esc / exit button: summarize the cached claim changes before committing them. */
    private requestClaimExit(): void {
        if (!this.expansion.isManaging()) return;
        const { adds, cancels } = this.expansion.draft();
        const names = (ids: number[]): string => ids.map((id) => this.engine.state.states[id]?.name ?? "未知州").join("、");
        if (adds.length === 0 && cancels.length === 0) {
            this.confirmDialog.show({
                title: "退出宣称管理",
                body: "当前没有待确认的宣称变更。\n退出不会修改任何宣称。",
                onConfirm: () => {
                    this.expansion.cancelDraft();
                    this.syncClaimBanner();
                    this.toast("已退出宣称管理");
                },
            });
            return;
        }
        const net = (adds.length - cancels.length) * CLAIM_COST;
        this.confirmDialog.show({
            title: "确认宣称变更",
            body: `${adds.length ? `新增宣称：${names(adds)}` : ""}${adds.length && cancels.length ? "\n" : ""}${cancels.length ? `取消宣称：${names(cancels)}` : ""}\n\n确认后一次性提交；${textToken("politics", net > 0 ? -net : `+${-net}`)}。取消的宣称每项返还 ${textToken("politics", CLAIM_COST)}，交战中可能取消失败。`,
            onConfirm: () => {
                const result = this.expansion.applyDraft();
                this.syncClaimBanner();
                this.sound.play(result.failed ? "error" : "select");
                const parts = [`新增 ${result.added}`, `取消 ${result.cancelled}`];
                if (result.failed) parts.push(`失败 ${result.failed}`);
                this.toast(`宣称变更已提交：${parts.join(" · ")}`);
            },
        });
    }

    private syncClaimBanner(): void {
        const managing = this.expansion.isManaging();
        this.claimBanner.classList.toggle("hidden", !managing);
        this.hud.classList.toggle("claim-managing", managing);
        this.syncFocusMode();
    }

    private handleSidebarClick(event: Event): void {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (!target) return;
        const action = target.dataset.action;
        if (!action || action === "split-check") return;

        if (action === "dock-toggle") {
            this.dockCollapsed = !this.dockCollapsed;
            this.hud.classList.toggle("dock-collapsed", this.dockCollapsed);
            this.dockToggleBtn.textContent = this.dockCollapsed ? "»" : "«";
            this.dockToggleBtn.setAttribute("aria-label", this.dockCollapsed ? "展开面板" : "收起面板");
            this.syncConstructionView();
            return;
        }

        if (action === "army-toggle") {
            this.armyPanelEl.classList.toggle("army-collapsed");
            this.sound.play("select");
            this.armies.render();
            return;
        }
        if (action === "select-army" && !(event as MouseEvent).ctrlKey && !(event as MouseEvent).metaKey
            && this.narrowQuery.matches) {
            this.armyPanelEl.classList.add("army-collapsed");
        }
        if (action === "layers-toggle") {
            this.layersCollapsed = !this.layersCollapsed;
            this.renderLayers();
            return;
        }
        if (action === "map-mode" || action === "construction-scope") {
            const mode = target.dataset.mode;
            if (mode !== "province" && mode !== "state") return;
            this.changeMapMode(mode);
            return;
        }
        if (action === "settings-close") {
            this.closeSettings();
            return;
        }
        if (action === "color-mode") {
            this.callbacks.onColorMode(target.dataset.color === "uniform" ? "uniform" : "gradient");
            this.sound.play("select");
            this.renderLayers();
            return;
        }
        if (action === "color-reset") {
            this.callbacks.onColorMode("gradient");
            this.callbacks.onDeepZoom(0.8);
            this.sound.play("select");
            this.renderLayers();
            this.toast("染色已恢复默认（渐变 · 阈值 0.8）");
            return;
        }
        if (action === "construction-kind") {
            const kind = target.dataset.kind as BuildingKind;
            if (this.engine.state.winner !== null || !BUILDING_KINDS.includes(kind)) return;
            this.construction.selectedKind = kind;
            this.changeMapMode(BUILDING_PROFILES[kind].scope);
            this.tooltip.refresh();
            return;
        }
        if (action === "construction-jump") {
            const site = Number(target.dataset.site);
            this.selectConstructionSite(site);
            this.changeMapMode(target.dataset.mode === "province" ? "province" : "state");
            return;
        }
        if (action === "open-construction") {
            this.dockCollapsed = false;
            this.hud.classList.remove("dock-collapsed");
            this.dockToggleBtn.textContent = "«";
            this.dockToggleBtn.setAttribute("aria-label", "收起面板");
            this.setTab("construction");
            return;
        }

        if (action === "vassal-goto") {
            const nationId = Number(target.dataset.nation);
            if (Number.isInteger(nationId) && this.engine.state.nations[nationId] && !this.engine.state.nations[nationId].isPlayer) {
                this.topbar.closeCountryMenu();
                this.setTab("diplomacy");
                this.diplomacy.setTarget(nationId);
                this.sound.play("select");
            }
            return;
        }
        if (action === "diplo-target") {
            const nationId = Number(target.dataset.nation);
            if (Number.isInteger(nationId) && this.engine.state.nations[nationId] && !this.engine.state.nations[nationId].isPlayer) {
                this.diplomacy.setTarget(nationId);
                this.sound.play("select");
            }
            return;
        }
        if (action === "declare-open") {
            const nationId = Number(target.dataset.nation);
            if (Number.isInteger(nationId)) {
                this.diplomacy.openDeclare(nationId);
                this.sound.play("select");
            }
            return;
        }
        if (action === "diplo-menu-open") {
            const nationId = Number(target.dataset.nation);
            if (Number.isInteger(nationId)) {
                this.diplomacy.openActionMenu(nationId);
                this.sound.play("select");
            }
            return;
        }
        if (action === "claim-focus") {
            const stateId = Number(target.dataset.state);
            if (!Number.isInteger(stateId) || !this.engine.state.states[stateId]) return;
            this.expansion.focusFromMap(stateId);
            this.engine.select(this.engine.state.states[stateId].center);
            this.sound.play("select");
            return;
        }
        if (action === "claim-manage") {
            this.enterClaimManagement();
            return;
        }
        if (action === "claim-manage-exit") {
            this.requestClaimExit();
            return;
        }
        if (action === "claim-draft") {
            const stateId = Number(target.dataset.state);
            if (!Number.isInteger(stateId)) return;
            const result = this.expansion.toggleDraft(stateId);
            this.sound.play(result.ok ? "recruit" : "error");
            this.toast(result.message);
            return;
        }
        if (action === "feed-toggle") {
            this.feed.toggle();
            return;
        }
        if (action === "policy") {
            this.requestPolicySwitch(target);
            return;
        }

        if (handleEconomyAction(this, action, target)) return;
        if (handleDiplomacyAction(this, action, target)) return;
        handleArmyAction(this, action, target, event);
    }
}