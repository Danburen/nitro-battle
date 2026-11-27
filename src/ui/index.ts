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
import { RESOURCE_MAP_COLORS } from "../render/resources.ts";
import type { ColorMode } from "../render/types.ts";
import type { SoundManager } from "../audio/index.ts";
import type { UIContext, UICallbacks, TabId, UIDispatchData, UIDispatchOptions } from "./context.ts";
import { TopBar } from "./topbar.ts";
import { GlobalTooltip } from "./tooltip.ts";
import { BattleReport } from "./report/feed.ts";
import { Briefing } from "./briefing.ts";
import { IntelPanel } from "./panels/intel.ts";
import { DeployPanel } from "./panels/deploy.ts";
import { ConstructionPanel } from "./panels/construction.ts";
import { PolicyPanel } from "./panels/policy.ts";
import { DiplomacyPanel } from "./panels/diplomacy.ts";
import { TradePanel } from "./panels/trade.ts";
import { ExpansionPanel } from "./panels/expansion.ts";
import { showEndOverlay } from "./endOverlay.ts";
import { handleDiplomacyAction, handleEconomyAction } from "./actions.ts";
import { ConfirmDialog } from "./confirm.ts";
import type { ConfirmSpec } from "./confirm.ts";
import { MapLegend } from "./mapLegend.ts";
import { setGameText } from "./text.ts";
import { defaultHint } from "./layout.ts";
import { t } from "../i18n/index.ts";
import { clearActiveTokenContext, setActiveTokenContext } from "./tokenValues.ts";

const TAB_IDS: readonly TabId[] = ["deploy", "construction", "policy", "diplomacy", "trade", "expansion"];

/** UI controller: event delegation, selection mode and refresh orchestration. */
export class GameUI implements UIContext {
    readonly engine: GameEngine;
    readonly sound: SoundManager;
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
    private readonly deploy: DeployPanel;
    private readonly construction: ConstructionPanel;
    private readonly policy: PolicyPanel;
    private readonly diplomacy: DiplomacyPanel;
    private readonly trade: TradePanel;
    private readonly expansion: ExpansionPanel;
    private readonly confirmDialog: ConfirmDialog;
    private readonly legend: MapLegend;

    private readonly hud = document.querySelector<HTMLElement>("#hud") as HTMLElement;
    private readonly infoTabs = document.querySelector<HTMLElement>("#info-tabs") as HTMLElement;
    private readonly dockToggleBtn = document.querySelector<HTMLButtonElement>("#btn-dock") as HTMLButtonElement;
    private readonly endOverlay = document.querySelector<HTMLElement>("#end-overlay") as HTMLElement;
    private readonly toastEl = document.querySelector<HTMLElement>("#toast") as HTMLElement;
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

        // `~` tokens read a derived view of engine.state; getters keep it live
        // across engine swaps and selection changes without a second store.
        const ui = this;
        const player = Math.max(0, engine.state.nations.findIndex((nation) => nation.isPlayer));
        setActiveTokenContext({
            get state() { return ui.engine.state; },
            player,
            get selectedSite() { return ui.engine.state.selected; },
            get selectedState() {
                const site = ui.engine.state.selected;
                return site === null ? null : ui.engine.state.provinces[site]?.stateId ?? null;
            },
        });

        this.tooltip = new GlobalTooltip();
        this.topbar = new TopBar(engine, sound, (text) => this.toast(text));
        this.feed = new BattleReport(engine);
        this.briefing = new Briefing(engine, {
            inspect: (nationId) => this.callbacks.onBriefingInspect(nationId),
            start: (nationId) => this.callbacks.onBriefingEnd(nationId),
        });
        this.intel = new IntelPanel(engine);
        this.deploy = new DeployPanel(engine);
        this.construction = new ConstructionPanel(engine);
        this.policy = new PolicyPanel(engine);
        this.diplomacy = new DiplomacyPanel(engine, { toast: (message) => this.toast(message), sound: this.sound });
        this.trade = new TradePanel(engine, { toast: (message) => this.toast(message), sound: this.sound });
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
        clearActiveTokenContext();
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
        this.trade.destroy();
        this.expansion.cancelDraft();
        this.claimBanner.classList.add("hidden");
        this.hud.classList.remove("claim-managing");
        this.confirmDialog.close();
        this.legend.set(null);
        this.tooltip.destroy();
        window.clearTimeout(this.toastTimer);
        this.dockCollapsed = false;
        this.hud.classList.remove("dock-collapsed", "command-mode", "construction-mode", "layers-collapsed", "focus-mode");
        setGameText(this.dockToggleBtn, "«", "plain");
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
        // Briefing shows the map and one nation panel only; keep hidden HUD work off the frame.
        if (this.briefing?.isActive()) return [() => this.topbar.render()];
        this.hud.classList.remove("command-mode");

        const tasks: (() => void)[] = [
            () => this.topbar.render(),
            () => this.intel.render(this.mapMode),
        ];
        if (this.activeTab === "construction") tasks.push(() => this.construction.render());
        tasks.push(
            () => this.renderLayers(),
            () => this.deploy.render(),
            () => this.policy.render(),
            () => this.diplomacy.render(),
            () => this.trade.render(),
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

    private readonly handleEndTurn = (): void => this.endTurn();

    /** Real turn entry point, shared by the DOM button, hotkey and debug console. */
    endTurn(): void {
        if (this.briefing.isActive()) {
            this.sound.play("select");
            // Committing may tear this UI down and build the campaign UI; do nothing after it.
            this.briefing.finish();
            return;
        }
        if (this.engine.state.winner !== null) return;
        this.sound.play("endTurn");
        this.engine.endTurn();
    }
    private readonly handleSound = (): void => this.topbar.toggleSound();
    private readonly handleMenu = (): void => this.callbacks.onNewGame();
    private readonly handleHome = (): void => this.callbacks.onHome();
    private readonly handleSidebar = (event: Event): void => this.handleSidebarClick(event);
    private readonly handleTabs = (event: Event): void => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-tab]");
        if (!button) return;
        this.dispatchAction("tab", { tab: button.dataset.tab });
    };

    isConstructionOpen(): boolean {
        return this.activeTab === "construction" && !this.dockCollapsed;
    }

    isClaimsOpen(): boolean {
        return this.activeTab === "expansion" && !this.dockCollapsed && this.mapMode === "state";
    }

    handleClaimsMapClick(site: number): void {
        const stateId = this.engine.state.provinces[site]?.stateId ?? -1;
        if (stateId < 0) return;
        this.expansion.focusFromMap(stateId);
        this.engine.select(site);
        if (!this.expansion.isManaging()) {
            this.sound.play("select");
            this.toast(t("misc.index.claims.mapClickHint"));
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
        const area = t(this.mapMode === "state" ? "misc.common.area.state" : "misc.common.area.province");
        if (kind) setGameText(this.hintEl, t("misc.index.hint.selected", { name: BUILDING_PROFILES[kind].name, area }), "plain");
        else if (this.isConstructionOpen() && this.engine.state.winner === null) setGameText(this.hintEl, t("misc.index.hint.selectFirst", { area }), "plain");
        else if (this.isClaimsOpen() && this.engine.state.winner === null) setGameText(this.hintEl, t("misc.index.hint.claims"), "plain");
        else setGameText(this.hintEl, defaultHint(), "plain");
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
                title: t("misc.index.legend.claimsTitle"),
                items: [
                    { label: t("misc.index.legend.claimable"), pulse: true },
                    { label: t("misc.index.legend.claimed"), overlay: nationDisplayColor(state, 0) },
                    { label: t("misc.index.legend.focus"), ring: true },
                ],
            });
            return;
        }
        const kind = this.construction.selectedKind;
        if (this.isConstructionOpen() && kind !== null && BUILDING_PROFILES[kind].scope === this.mapMode) {
            const local = BUILDING_PROFILES[kind].scope === "province";
            const area = t(local ? "misc.common.area.province" : "misc.common.area.state");
            this.legend.set({
                title: t("misc.index.legend.buildTitle", { name: BUILDING_PROFILES[kind].name }),
                items: [
                    { label: t("misc.index.legend.idle"), color: CONSTRUCTION_COLORS.empty },
                    ...(local ? [] : [
                        { label: t("misc.index.legend.low"), color: CONSTRUCTION_COLORS.low },
                        { label: t("misc.index.legend.high"), color: CONSTRUCTION_COLORS.high },
                    ]),
                    { label: t("misc.index.legend.full"), color: CONSTRUCTION_COLORS.full },
                    { label: t("misc.index.legend.blocked"), color: CONSTRUCTION_BLOCKED_COLOR },
                ],
                note: t("misc.index.legend.buildNote", { area }),
            });
            return;
        }
        if (this.callbacks.getColorMode() === "resource") {
            this.legend.set({
                title: t("misc.index.legend.resourceTitle"),
                items: [
                    { label: t("misc.index.legend.raw"), icons: [{ name: "raw", color: RESOURCE_MAP_COLORS.raw }] },
                    { label: t("misc.index.legend.strategic"), icons: [{ name: "strategic", color: RESOURCE_MAP_COLORS.strategic }] },
                    {
                        label: t("misc.index.legend.both"),
                        icons: [
                            { name: "raw", color: RESOURCE_MAP_COLORS.raw },
                            { name: "strategic", color: RESOURCE_MAP_COLORS.strategic },
                        ],
                    },
                    { label: t("misc.index.legend.foodOrNone"), icons: [{ name: "food", color: RESOURCE_MAP_COLORS.food }] },
                ],
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
        const area = t(local ? "misc.common.area.province" : "misc.common.area.state");
        if (!state.terrain.passable[site] || province.owner !== 0 || (!local && (!region || state.provinces[region.center].owner !== 0))) {
            this.sound.play("error");
            this.toast(t("misc.index.build.onlyOwnLand", { area }));
            return;
        }
        const queued = local ? this.engine.queueProvinceBuild(site, kind) : this.engine.queueBuild(region.id, kind);
        if (queued) {
            this.sound.play("recruit");
            this.toast(t("misc.index.build.queued", {
                place: local ? province.name : region.name,
                building: BUILDING_PROFILES[kind].name,
            }));
        } else {
            this.sound.play("error");
            const { used, limit } = local ? provinceBuildingCapacity(state, province, kind) : stateBuildingCapacity(state, region, kind);
            this.toast(used >= limit
                ? t("misc.index.build.full", { area })
                : t("misc.index.build.insufficient"));
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
        this.trade.setHidden(tab !== "trade");
        this.expansion.setHidden(tab !== "expansion");
        if (tab === "construction") this.changeMapMode(this.construction.scope);
        if (tab === "expansion") this.changeMapMode("state");
        if (tab !== "expansion") {
            this.expansion.clearFocus();
            if (this.expansion.isManaging()) {
                this.expansion.cancelDraft();
                this.syncClaimBanner();
                this.toast(t("misc.index.claims.discarded"));
            }
        }
        this.syncConstructionView();
    }

    private changeMapMode(mode: "province" | "state"): void {
        if (mode === "state" && this.callbacks.getColorMode() === "resource") this.callbacks.onColorMode("gradient");
        this.tooltip.hide();
        this.mapMode = mode;
        if (this.construction.selectedKind && BUILDING_PROFILES[this.construction.selectedKind].scope !== mode) this.construction.selectedKind = null;
        this.construction.scope = mode;
        this.callbacks.onMapMode(mode);
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
        const resourceMode = this.callbacks.getColorMode() === "resource";
        setGameText(document.querySelector("#map-layer-name")!, resourceMode
            ? t("misc.colorMode.resource")
            : t(this.mapMode === "state" ? "misc.common.area.state" : "misc.common.area.province"), "plain");
        setGameText(document.querySelector("#map-layer-chevron")!, this.layersCollapsed ? "▸" : "▾", "plain");
        for (const button of options.querySelectorAll<HTMLElement>("[data-mode]")) {
            const active = button.dataset.mode === this.mapMode;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        const resourceButton = options.querySelector<HTMLElement>("[data-color='resource']");
        if (resourceButton) {
            resourceButton.classList.toggle("active", resourceMode);
            resourceButton.setAttribute("aria-pressed", String(resourceMode));
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
        setGameText(this.settingsPop.querySelector<HTMLElement>("#color-threshold-value")!, deepZoom.toFixed(2), "plain");
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
            if (this.trade.closeBuilder()) return;
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
            this.engine.select(null);
        } else if (event.key === "m" || event.key === "M") {
            this.topbar.toggleSound();
        }
    };

    /** Policy chips go through a confirm card; a pending target click cancels its switch. */
    private requestPolicySwitch(data: UIDispatchData): void {
        const state = this.engine.state;
        const player = state.nations[0];
        const category = data.category as PolicyCategory | undefined;
        const value = data.value ?? "";
        if (!category || !value || !POLICY_LABELS[category] || state.winner !== null) return;
        const currentName = policyOption(category, player.policies[category])?.name ?? player.policies[category];
        const transition = player.policyTransitions?.[category];

        if (transition) {
            if (transition.to !== value) {
                this.sound.play("error");
                this.toast(t("misc.index.policy.switching", {
                    name: policyOption(category, transition.to)?.name ?? transition.to,
                }));
                return;
            }
            const remaining = Math.max(0, transition.readyDay - state.day);
            const targetName = policyOption(category, transition.to)?.name ?? transition.to;
            this.confirmDialog.show({
                title: t("misc.index.policy.cancelTitle", { category: POLICY_LABELS[category] }),
                body: t("misc.index.policy.cancelBody", {
                    current: currentName,
                    target: targetName,
                    days: remaining,
                    cost: POLICY_SWITCH_COST,
                    switchDays: POLICY_SWITCH_DAYS,
                }),
                danger: true,
                onConfirm: () => {
                    if (this.engine.cancelPolicySwitch(category)) {
                        this.sound.play("select");
                        this.toast(t("misc.index.policy.cancelToast", { category: POLICY_LABELS[category] }));
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
            this.toast(t("misc.index.policy.insufficient", { cost: POLICY_SWITCH_COST }));
            return;
        }
        const nextName = policyOption(category, value)?.name ?? value;
        this.confirmDialog.show({
            title: t("misc.index.policy.switchTitle", { category: POLICY_LABELS[category] }),
            body: t("misc.index.policy.switchBody", {
                current: currentName,
                next: nextName,
                cost: POLICY_SWITCH_COST,
                upkeep: -POLICY_SWITCH_UPKEEP,
                days: POLICY_SWITCH_DAYS,
            }),
            onConfirm: () => {
                if (this.engine.startPolicySwitch(category, value)) {
                    this.sound.play("select");
                    this.toast(t("misc.index.policy.startToast", {
                        category: POLICY_LABELS[category],
                        cost: -POLICY_SWITCH_COST,
                    }));
                } else {
                    this.sound.play("error");
                    this.toast(t("misc.index.policy.startFailed"));
                }
            },
        });
    }

    private enterClaimManagement(): void {
        if (this.engine.state.winner !== null) {
            this.sound.play("error");
            this.toast(t("misc.index.claims.ended"));
            return;
        }
        if (!this.expansion.enterManage()) return;
        this.sound.play("select");
        this.syncClaimBanner();
        this.toast(t("misc.index.claims.enter"));
    }

    /** Esc / exit button: summarize the cached claim changes before committing them. */
    private requestClaimExit(): void {
        if (!this.expansion.isManaging()) return;
        const { adds, cancels } = this.expansion.draft();
        const names = (ids: number[]): string => ids.map((id) => this.engine.state.states[id]?.name ?? t("misc.common.unknownState")).join(t("misc.common.listSeparator"));
        if (adds.length === 0 && cancels.length === 0) {
            this.confirmDialog.show({
                title: t("misc.index.claims.exitTitle"),
                body: t("misc.index.claims.exitBody"),
                onConfirm: () => {
                    this.expansion.cancelDraft();
                    this.syncClaimBanner();
                    this.toast(t("misc.index.claims.exitToast"));
                },
            });
            return;
        }
        const net = (adds.length - cancels.length) * CLAIM_COST;
        const addLine = adds.length ? t("misc.index.claims.addList", { names: names(adds) }) : "";
        const cancelLine = cancels.length ? t("misc.index.claims.cancelList", { names: names(cancels) }) : "";
        this.confirmDialog.show({
            title: t("misc.index.claims.confirmTitle"),
            body: t("misc.index.claims.confirmBody", {
                adds: addLine,
                sep: addLine && cancelLine ? "\n" : "",
                cancels: cancelLine,
                net: net > 0 ? -net : `+${-net}`,
                cost: CLAIM_COST,
            }),
            onConfirm: () => {
                const result = this.expansion.applyDraft();
                this.syncClaimBanner();
                this.sound.play(result.failed ? "error" : "select");
                const parts = [
                    t("misc.index.claims.resultAdd", { count: result.added }),
                    t("misc.index.claims.resultCancel", { count: result.cancelled }),
                ];
                if (result.failed) parts.push(t("misc.index.claims.resultFail", { count: result.failed }));
                this.toast(t("misc.index.claims.resultToast", { parts: parts.join(" · ") }));
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
        const select = target.closest<HTMLElement>("[data-diplo-card]")?.querySelector<HTMLSelectElement>("[data-diplo-state]");
        const mouse = event as MouseEvent;
        this.dispatchAction(action, target.dataset, {
            ctrlKey: mouse.ctrlKey,
            metaKey: mouse.metaKey,
            inMapLayerOptions: target.closest("#map-layer-options") !== null,
            cooldown: target.classList.contains("cooldown"),
            cooldownTooltip: target.dataset.tooltipBody ?? null,
            selectedState: select && select.value !== "" ? Number(select.value) : null,
        });
    }

    /** Expand the left dock; every panel-opening path funnels through here. */
    private expandDock(): void {
        if (!this.dockCollapsed) return;
        this.dockCollapsed = false;
        this.hud.classList.remove("dock-collapsed");
        setGameText(this.dockToggleBtn, "«", "plain");
        this.dockToggleBtn.setAttribute("aria-label", t("misc.layout.dock.collapse"));
    }

    /** Open a dock panel with all dock/map-mode side effects applied. */
    openPanel(tab: TabId): void {
        this.expandDock();
        this.setTab(tab);
    }

    /** Single router for UI actions, driven by both DOM clicks and debug commands. */
    dispatchAction(action: string, data: UIDispatchData = {}, options: UIDispatchOptions = {}): boolean {
        if (!action || action === "split-check") return false;

        if (action === "tab") {
            const tab = data.tab as TabId | undefined;
            if (!tab || !TAB_IDS.includes(tab)) return false;
            this.openPanel(tab);
            return true;
        }
        if (action === "dock-toggle") {
            this.dockCollapsed = !this.dockCollapsed;
            this.hud.classList.toggle("dock-collapsed", this.dockCollapsed);
            setGameText(this.dockToggleBtn, this.dockCollapsed ? "»" : "«", "plain");
            this.dockToggleBtn.setAttribute("aria-label", t(this.dockCollapsed ? "misc.layout.dock.expand" : "misc.layout.dock.collapse"));
            this.syncConstructionView();
            return true;
        }
        if (action === "dock-expand" || action === "dock-collapse") {
            const collapsed = action === "dock-collapse";
            if (collapsed !== this.dockCollapsed) this.dispatchAction("dock-toggle");
            return true;
        }
        if (action === "layers-toggle") {
            this.layersCollapsed = !this.layersCollapsed;
            this.renderLayers();
            return true;
        }
        if (action === "map-mode" || action === "construction-scope") {
            const mode = data.mode;
            if (mode !== "province" && mode !== "state") return false;
            this.changeMapMode(mode);
            return true;
        }
        if (action === "settings-close") {
            this.closeSettings();
            return true;
        }
        if (action === "color-mode") {
            const picked = data.color;
            if (picked !== "uniform" && picked !== "gradient" && picked !== "resource") return false;
            let color: ColorMode = picked;
            if (color === "resource" && this.callbacks.getColorMode() === "resource" && options.inMapLayerOptions) color = "gradient";
            this.callbacks.onColorMode(color);
            this.sound.play("select");
            this.renderLayers();
            this.syncMapLegend();
            return true;
        }
        if (action === "color-reset") {
            this.callbacks.onColorMode("gradient");
            this.callbacks.onDeepZoom(0.8);
            this.sound.play("select");
            this.renderLayers();
            this.syncMapLegend();
            this.toast(t("misc.index.colorResetToast", { threshold: 0.8 }));
            return true;
        }
        if (action === "construction-kind") {
            const kind = data.kind as BuildingKind;
            if (this.engine.state.winner !== null || !BUILDING_KINDS.includes(kind)) return false;
            this.construction.selectedKind = kind;
            this.changeMapMode(BUILDING_PROFILES[kind].scope);
            this.tooltip.refresh();
            return true;
        }
        if (action === "construction-jump") {
            const site = Number(data.site);
            this.selectConstructionSite(site);
            this.changeMapMode(data.mode === "province" ? "province" : "state");
            return true;
        }
        if (action === "open-construction") {
            this.openPanel("construction");
            return true;
        }
        if (action === "trade-goto") {
            const nationId = Number(data.nation);
            if (Number.isInteger(nationId) && this.engine.state.nations[nationId] && !this.engine.state.nations[nationId].isPlayer) {
                this.openPanel("trade");
                this.trade.setTarget(nationId);
                this.sound.play("select");
            }
            return true;
        }
        if (action === "diplo-target") {
            const nationId = Number(data.nation);
            if (Number.isInteger(nationId) && this.engine.state.nations[nationId] && !this.engine.state.nations[nationId].isPlayer) {
                this.diplomacy.setTarget(nationId);
                this.sound.play("select");
            }
            return true;
        }
        if (action === "declare-open") {
            const nationId = Number(data.nation);
            if (Number.isInteger(nationId)) {
                this.diplomacy.openDeclare(nationId);
                this.sound.play("select");
            }
            return true;
        }
        if (action === "diplo-menu-open") {
            const nationId = Number(data.nation);
            if (Number.isInteger(nationId)) {
                this.diplomacy.openActionMenu(nationId);
                this.sound.play("select");
            }
            return true;
        }
        if (action === "claim-focus") {
            const stateId = Number(data.state);
            if (!Number.isInteger(stateId) || !this.engine.state.states[stateId]) return false;
            this.expansion.focusFromMap(stateId);
            this.engine.select(this.engine.state.states[stateId].center);
            this.sound.play("select");
            return true;
        }
        if (action === "claim-manage") {
            this.enterClaimManagement();
            return true;
        }
        if (action === "claim-manage-exit") {
            this.requestClaimExit();
            return true;
        }
        if (action === "claim-draft") {
            const stateId = Number(data.state);
            if (!Number.isInteger(stateId)) return false;
            const result = this.expansion.toggleDraft(stateId);
            this.sound.play(result.ok ? "recruit" : "error");
            this.toast(result.message);
            return true;
        }
        if (action === "feed-toggle") {
            this.feed.toggle();
            return true;
        }
        if (action === "policy") {
            this.requestPolicySwitch(data);
            return true;
        }

        if (handleEconomyAction(this, action, data)) return true;
        if (this.trade.handleAction(action, data)) return true;
        return handleDiplomacyAction(this, action, data, options);
    }
}