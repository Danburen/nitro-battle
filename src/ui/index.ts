import type { GameEngine } from "../game/engine.ts";
import { BUILDING_KINDS, BUILDING_PROFILES } from "../game/types.ts";
import type { BuildingKind } from "../game/types.ts";
import { provinceBuildingCapacity, stateBuildingCapacity } from "../game/economy.ts";
import type { SoundManager } from "../audio.ts";
import type { UIContext, UICallbacks } from "./context.ts";
import { TopBar } from "./topbar.ts";
import { GlobalTooltip } from "./tooltip.ts";
import { BattleFeed } from "./feed.ts";
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

    private readonly topbar: TopBar;
    private readonly tooltip: GlobalTooltip;
    private readonly feed: BattleFeed;
    private readonly intel: IntelPanel;
    private readonly armies: ArmyListPanel;
    private readonly detail: ArmyDetailPanel;
    private readonly deploy: DeployPanel;
    private readonly construction: ConstructionPanel;
    private readonly policy: PolicyPanel;
    private readonly diplomacy: DiplomacyPanel;
    private readonly expansion: ExpansionPanel;

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

    constructor(engine: GameEngine, sound: SoundManager, callbacks: UICallbacks) {
        this.engine = engine;
        this.sound = sound;
        this.callbacks = callbacks;

        this.tooltip = new GlobalTooltip();
        this.topbar = new TopBar(engine, sound, (text) => this.toast(text));
        this.feed = new BattleFeed(engine);
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
            this.refresh();
        });
        this.setTab("diplomacy");
        this.refresh();
    }

    destroy(): void {
        this.unsubscribe();
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
        this.topbar.destroy();
        this.construction.destroy();
        this.diplomacy.destroy();
        this.tooltip.destroy();
        window.clearTimeout(this.toastTimer);
        this.detail.hide();
        this.dockCollapsed = false;
        this.hud.classList.remove("dock-collapsed", "command-mode", "construction-mode", "layers-collapsed");
        this.armyPanelEl.classList.remove("army-collapsed");
        this.dockToggleBtn.textContent = "«";
        this.multiSelect.clear();
        this.splitChecks.clear();
    }

    toast(text: string): void {
        this.toastEl.textContent = text;
        this.toastEl.classList.add("show");
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 2200);
    }

    refresh(): void {
        const state = this.engine.state;
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

        this.topbar.render();
        this.intel.render(this.mapMode);
        if (this.activeTab === "construction") this.construction.render();
        this.renderLayers();
        this.armies.render();
        this.detail.render();
        this.deploy.render();
        this.policy.render();
        this.diplomacy.render();
        this.expansion.render();
        this.feed.render();
        this.syncConstructionView();
        this.tooltip.refresh();
    }

    private readonly handleEndTurn = (): void => {
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
        const result = this.expansion.toggleClaim(stateId);
        this.sound.play(result.ok ? "recruit" : "error");
        this.toast(result.message);
    }

    centerSite(site: number): void {
        this.callbacks.onCenterSite(site);
    }

    private syncConstructionView(): void {
        const selected = this.construction.selectedKind;
        const kind = this.isConstructionOpen() && selected !== null && BUILDING_PROFILES[selected].scope === this.mapMode && this.engine.state.winner === null
            ? selected : null;
        this.callbacks.onConstructionView(kind);
        this.callbacks.onClaimsOverlay(this.isClaimsOpen() && this.engine.state.winner === null);
        renderModeBar(this.engine, this.modeBar, this.hintEl, this.hud.classList.contains("command-mode"));
        const area = this.mapMode === "state" ? "州" : "省份";
        if (kind) this.hintEl.textContent = `已选${BUILDING_PROFILES[kind].name} · 点击己方${area}加入队列 · 右键 / Esc 取消`;
        else if (this.isConstructionOpen() && this.engine.state.winner === null) this.hintEl.textContent = `先选择左侧建筑，再点击己方${area}加入队列`;
        else if (this.isClaimsOpen() && this.engine.state.winner === null) this.hintEl.textContent = "扩张页：金色闪烁的州即可宣称 · 点击宣称，再点取消并返还政治点 · 已宣称州以我方颜色覆盖 · Esc 取消聚焦";
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
        if (tab !== "expansion") this.expansion.clearFocus();
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
        if (action === "feed-toggle") {
            this.feed.toggle();
            return;
        }

        if (handleEconomyAction(this, action, target)) return;
        if (handleDiplomacyAction(this, action, target)) return;
        handleArmyAction(this, action, target, event);
    }
}