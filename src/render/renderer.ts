import { cellFillColor, drawBiomes } from "../terrain/biome.ts";
import {
    drawWrappedLine,
    fillWrappedPolygon,
    periodicDelta,
    periodicDistanceSq,
} from "../terrain/voronoi/index.ts";
import type { Vec2 } from "../terrain/voronoi/index.ts";
import { claimableStateIds, isAtWar, stateSummary } from "../game/diplomacy.ts";
import { pathTo } from "../game/rules.ts";
import { BUILDING_PROFILES, MAX_HP, NEUTRAL, NEUTRAL_COLOR } from "../game/types.ts";
import type { Army, BuildingKind, EngineEvent, Province, UnitKind } from "../game/types.ts";
import type { GameEngine } from "../game/engine.ts";
import { Camera } from "./camera.ts";
import { buildConstructionOverlay, PROVINCE_CAPACITY_MIN_ZOOM } from "./constructionOverlay.ts";
import type { ConstructionOverlay } from "./constructionOverlay.ts";
import { drawTerrainDecorCell } from "./terrainDecor.ts";
import { BIOME_ZH, garrisonRelation, ownerName } from "../ui/common.ts";
import { chipToken, escapeGameText, textToken } from "../ui/text.ts";
import { MAP_TOOLTIP_DISMISS_EVENT, MAP_TOOLTIP_EVENT } from "../ui/tooltip.ts";
import type { MapTooltipRequest } from "../ui/tooltip.ts";

interface MoveAnim {
    armyId: number;
    points: Vec2[];
    start: number;
    dur: number;
}

interface ProvinceFx {
    kind: "combat" | "capture" | "recruit";
    province: number;
    start: number;
    dur: number;
    color: string;
}

interface FloatText {
    x: number;
    y: number;
    text: string;
    color: string;
    start: number;
    dur: number;
}

interface CounterHit {
    x: number;
    y: number;
    w: number;
    h: number;
    site: number;
    armyId: number;
    nation: number;
}

const MINI_W = 172;
const MAP_HOVER_DELAY = 800;
const MAP_HOVER_SLOP = 6;

export type MapMode = "province" | "state";

export class MapRenderer {
    readonly camera: Camera;
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly engine: GameEngine;
    private base: HTMLCanvasElement;
    private baseCtx: CanvasRenderingContext2D;
    private spare: HTMLCanvasElement;
    private spareCtx: CanvasRenderingContext2D;
    private baseBuild: Generator<void, void, void> | null = null;
    private readonly onCellClick: (site: number) => void;

    private currentMapMode: MapMode = "province";
    private currentConstructionKind: BuildingKind | null = null;
    private constructionOverlay: ConstructionOverlay | null = null;
    private constructionDirty = true;
    private baseDirty = true;
    private readonly dirtySites = new Set<number>();
    private frontlineDirty = true;
    private frontlineSegments: [Vec2, Vec2][] = [];
    private lastSeason = -1;
    private claimSignature = "";
    private claimFocus: number | null = null;
    private claimsOverlay = false;
    private claimableCache: number[] = [];
    private colorMode: "uniform" | "gradient" = "gradient";
    private deepZoom = 0.8;
    private colorLevel = "";
    private hover: number | null = null;
    private tooltipHover: {
        site: number;
        key: number;
        x: number;
        y: number;
        since: number | null;
        cameraX: number;
        cameraY: number;
        zoom: number;
        state: GameEngine["state"];
        title: string | null;
        body: string | null;
    } | null = null;
    private dpr = 1;
    private viewW = 0;
    private viewH = 0;
    private fitted = false;
    private raf = 0;
    private destroyed = false;

    private moveAnims: MoveAnim[] = [];
    private fx: ProvinceFx[] = [];
    private floats: FloatText[] = [];
    private flakes: { x: number; y: number; r: number; vy: number; drift: number; phase: number }[] = [];
    private counterHits: CounterHit[] = [];
    private lastFrame = 0;
    private readonly reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    private pointerDown: {
        x: number;
        y: number;
        lastX: number;
        lastY: number;
        moved: boolean;
        button: number;
    } | null = null;
    private miniDrag = false;
    private readonly resizeObserver: ResizeObserver;
    private readonly unsubscribe: () => void;

    constructor(
        canvas: HTMLCanvasElement,
        engine: GameEngine,
        onCellClick: (site: number) => void,
    ) {
        this.canvas = canvas;
        this.engine = engine;
        this.onCellClick = onCellClick;
        this.readColorSettings();
        this.ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

        const { width, height } = engine.state.graph.domain;
        this.camera = new Camera(width, height);
        this.base = document.createElement("canvas");
        this.base.width = width;
        this.base.height = height;
        this.baseCtx = this.base.getContext("2d") as CanvasRenderingContext2D;
        this.spare = document.createElement("canvas");
        this.spare.width = width;
        this.spare.height = height;
        this.spareCtx = this.spare.getContext("2d") as CanvasRenderingContext2D;
        this.lastSeason = engine.state.seasonIndex;

        this.unsubscribe = engine.subscribe((event) => this.onEngineEvent(event));
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas);
        this.resize();

        canvas.addEventListener("pointerdown", this.handlePointerDown);
        canvas.addEventListener("pointermove", this.handlePointerMove);
        canvas.addEventListener("pointerup", this.handlePointerUp);
        canvas.addEventListener("pointerleave", this.handlePointerLeave);
        canvas.addEventListener("wheel", this.handleWheel, { passive: false });
        canvas.addEventListener("contextmenu", this.handleContextMenu);
        canvas.addEventListener("pointercancel", this.handlePointerCancel);
        canvas.addEventListener("lostpointercapture", this.handlePointerCancel);
        document.addEventListener("pointerover", this.handleDocumentPointer, true);
        document.addEventListener("pointermove", this.handleDocumentPointer, true);
        document.addEventListener("pointerdown", this.resetMapTooltip, true);
        document.addEventListener("wheel", this.resetMapTooltip, { capture: true, passive: true });
        document.addEventListener("scroll", this.resetMapTooltip, true);
        document.addEventListener("dragstart", this.resetMapTooltip, true);
        document.addEventListener("keydown", this.handleTooltipKey, true);
        document.addEventListener(MAP_TOOLTIP_DISMISS_EVENT, this.handleTooltipDismiss);
        window.addEventListener("blur", this.handlePointerCancel);

        this.raf = requestAnimationFrame(this.frame);
    }

    destroy(): void {
        this.destroyed = true;
        this.resetMapTooltip();
        cancelAnimationFrame(this.raf);
        this.unsubscribe();
        this.resizeObserver.disconnect();
        this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
        this.canvas.removeEventListener("pointermove", this.handlePointerMove);
        this.canvas.removeEventListener("pointerup", this.handlePointerUp);
        this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
        this.canvas.removeEventListener("wheel", this.handleWheel);
        this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
        this.canvas.removeEventListener("pointercancel", this.handlePointerCancel);
        this.canvas.removeEventListener("lostpointercapture", this.handlePointerCancel);
        document.removeEventListener("pointerover", this.handleDocumentPointer, true);
        document.removeEventListener("pointermove", this.handleDocumentPointer, true);
        document.removeEventListener("pointerdown", this.resetMapTooltip, true);
        document.removeEventListener("wheel", this.resetMapTooltip, true);
        document.removeEventListener("scroll", this.resetMapTooltip, true);
        document.removeEventListener("dragstart", this.resetMapTooltip, true);
        document.removeEventListener("keydown", this.handleTooltipKey, true);
        document.removeEventListener(MAP_TOOLTIP_DISMISS_EVENT, this.handleTooltipDismiss);
        window.removeEventListener("blur", this.handlePointerCancel);
    }

    public get mapMode(): MapMode {
        return this.currentMapMode;
    }

    public setMapMode(mode: MapMode): void {
        if (mode === this.currentMapMode) return;
        this.resetMapTooltip();
        this.currentMapMode = mode;
        this.constructionDirty = true;
        this.baseDirty = true;
        this.dirtySites.clear();
        this.hover = null;
        this.counterHits = [];
    }

    public get constructionKind(): BuildingKind | null {
        return this.currentConstructionKind;
    }

    public setConstructionView(kind: BuildingKind | null): void {
        if (kind === this.currentConstructionKind) return;
        this.resetMapTooltip();
        this.currentConstructionKind = kind;
        this.constructionDirty = true;
    }

    private get constructionActive(): boolean {
        return this.currentConstructionKind !== null
            && BUILDING_PROFILES[this.currentConstructionKind].scope === this.currentMapMode;
    }

    private refreshConstructionOverlay(): void {
        if (!this.constructionDirty) return;
        this.constructionDirty = false;
        const next = this.constructionActive
            ? buildConstructionOverlay(this.engine.state, this.currentConstructionKind!) : null;
        if (next?.signature !== this.constructionOverlay?.signature) this.baseDirty = true;
        this.constructionOverlay = next;
    }

    centerOnCapital(): void {
        this.resetMapTooltip();
        const capital = this.engine.state.nations[0].capital;
        const site = this.engine.state.graph.sites[capital];
        this.camera.centerOn(site.x, site.y);
        this.camera.zoom = Math.max(this.camera.zoom, 1.1);
    }

    public setClaimFocus(stateId: number | null): void {
        this.claimFocus = stateId;
    }

    public getColorMode(): "uniform" | "gradient" {
        return this.colorMode;
    }

    public getDeepZoom(): number {
        return this.deepZoom;
    }

    public setColorMode(mode: "uniform" | "gradient"): void {
        if (this.colorMode === mode) return;
        this.colorMode = mode;
        try { localStorage.setItem("nitro-color-mode", mode); } catch { /* private mode */ }
        this.baseDirty = true;
    }

    public setDeepZoom(value: number): void {
        const next = Math.min(1.6, Math.max(0.4, value));
        if (this.deepZoom === next) return;
        this.deepZoom = next;
        try { localStorage.setItem("nitro-deep-zoom", String(next)); } catch { /* private mode */ }
        this.baseDirty = true;
    }

    private readColorSettings(): void {
        try {
            const mode = localStorage.getItem("nitro-color-mode");
            if (mode === "uniform" || mode === "gradient") this.colorMode = mode;
            const zoom = Number(localStorage.getItem("nitro-deep-zoom"));
            if (Number.isFinite(zoom) && zoom >= 0.4 && zoom <= 1.6) this.deepZoom = zoom;
        } catch { /* private mode */ }
    }

    private tintAlpha(): number {
        if (this.colorMode === "uniform") return 0.34;
        if (this.camera.zoom <= this.deepZoom) return 0.5;
        return 0.22;
    }

    private landFactor(): number {
        if (this.colorMode === "uniform") return 0.86;
        if (this.camera.zoom <= this.deepZoom) return 0.76;
        return 0.92;
    }

    /** Claims management mode: pulse every claimable state in gold on the state map. */
    public setClaimsOverlay(on: boolean): void {
        if (this.claimsOverlay === on) return;
        this.claimsOverlay = on;
        this.claimableCache = on ? claimableStateIds(this.engine.state, 0) : [];
    }

    public centerOnSite(site: number): void {
        this.resetMapTooltip();
        const point = this.engine.state.graph.sites[site];
        this.camera.centerOn(point.x, point.y);
        this.camera.zoom = Math.max(this.camera.zoom, 1.4);
    }

    public isSiteVisible(site: number): boolean {
        if (this.viewW <= 0 || this.viewH <= 0) return true;
        const point = this.engine.state.graph.sites[site];
        const delta = periodicDelta(
            { x: this.camera.x, y: this.camera.y },
            point,
            this.engine.state.graph.domain,
        );
        return Math.abs(delta.x) <= this.viewW / (2 * this.camera.zoom) &&
            Math.abs(delta.y) <= this.viewH / (2 * this.camera.zoom);
    }

    zoomBy(factor: number): void {
        this.resetMapTooltip();
        this.camera.zoomAt(this.viewW / 2, this.viewH / 2, factor, this.viewW, this.viewH);
    }

    fitMap(): void {
        this.resetMapTooltip();
        this.camera.fit(this.viewW, this.viewH);
    }

    private resize(): void {
        this.resetMapTooltip();
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.viewW = rect.width;
        this.viewH = rect.height;
        this.canvas.width = Math.round(rect.width * this.dpr);
        this.canvas.height = Math.round(rect.height * this.dpr);
        if (!this.fitted) {
            this.camera.fit(this.viewW, this.viewH);
            this.fitted = true;
        }
    }

    // ---- input ----

    private miniRect(): { x: number; y: number; w: number; h: number } {
        const { width, height } = this.engine.state.graph.domain;
        const h = (MINI_W * height) / width;
        return { x: this.viewW - MINI_W - 16, y: this.viewH - h - 16, w: MINI_W, h };
    }

    private hitTest(sx: number, sy: number): number {
        const { graph } = this.engine.state;
        const world = this.camera.screenToWorld(sx, sy, this.viewW, this.viewH);
        const point: Vec2 = {
            x: ((world.x % graph.domain.width) + graph.domain.width) % graph.domain.width,
            y: ((world.y % graph.domain.height) + graph.domain.height) % graph.domain.height,
        };
        let best = 0;
        let bestDist = Infinity;
        for (let site = 0; site < graph.sites.length; site++) {
            const d = periodicDistanceSq(point, graph.sites[site], graph.domain);
            if (d < bestDist) {
                bestDist = d;
                best = site;
            }
        }
        return best;
    }

    private hitTestCounter(sx: number, sy: number): CounterHit | null {
        if (this.currentMapMode !== "province") return null;
        for (let i = this.counterHits.length - 1; i >= 0; i--) {
            const hit = this.counterHits[i];
            if (sx >= hit.x - 2 && sx <= hit.x + hit.w + 2 && sy >= hit.y - 2 && sy <= hit.y + hit.h + 2) {
                return hit;
            }
        }
        return null;
    }

    private handlePointerDown = (event: PointerEvent): void => {
        this.resetMapTooltip();
        const rect = this.canvas.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        const mini = this.miniRect();
        if (sx >= mini.x && sx <= mini.x + mini.w && sy >= mini.y && sy <= mini.y + mini.h) {
            this.miniDrag = true;
            this.jumpMini(sx, sy);
        } else {
            this.pointerDown = { x: sx, y: sy, lastX: sx, lastY: sy, moved: false, button: event.button };
        }
        this.canvas.setPointerCapture(event.pointerId);
    };

    private handlePointerMove = (event: PointerEvent): void => {
        const rect = this.canvas.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;

        if (this.miniDrag) {
            this.jumpMini(sx, sy);
            return;
        }
        const pointer = this.pointerDown;
        if (pointer) {
            const dx = sx - pointer.lastX;
            const dy = sy - pointer.lastY;
            if (Math.abs(sx - pointer.x) + Math.abs(sy - pointer.y) > 5) pointer.moved = true;
            if (pointer.moved) this.camera.pan(dx, dy);
            pointer.lastX = sx;
            pointer.lastY = sy;
            return;
        }
        const mini = this.miniRect();
        if (event.buttons || (sx >= mini.x && sx <= mini.x + mini.w && sy >= mini.y && sy <= mini.y + mini.h)) {
            this.handlePointerLeave();
            return;
        }
        this.hover = this.hitTest(sx, sy);
        if (this.currentConstructionKind !== null) {
            this.resetMapTooltip();
            return;
        }
        const key = this.currentMapMode === "state"
            ? this.engine.state.provinces[this.hover]?.stateId ?? this.hover
            : this.hover;
        const pending = this.tooltipHover;
        if (pending && pending.key === key && this.tooltipViewUnchanged()
            && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= MAP_HOVER_SLOP) return;
        this.resetMapTooltip();
        this.tooltipHover = {
            site: this.hover, key, x: event.clientX, y: event.clientY, since: null,
            cameraX: this.camera.x, cameraY: this.camera.y, zoom: this.camera.zoom,
            state: this.engine.state, title: null, body: null,
        };
    };

    private handlePointerUp = (event: PointerEvent): void => {
        const rect = this.canvas.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        if (this.miniDrag) {
            this.miniDrag = false;
        } else if (this.pointerDown && !this.pointerDown.moved) {
            if (this.pointerDown.button === 2) {
                this.onCellClick(-1);
            } else if (this.constructionActive) {
                this.onCellClick(this.hitTest(sx, sy));
            } else {
                const modeBusy = this.engine.state.redeployArmyId !== null;
                const hit = modeBusy ? null : this.hitTestCounter(sx, sy);
                if (hit && hit.nation === 0) {
                    this.engine.selectArmy(hit.armyId);
                } else {
                    this.onCellClick(this.hitTest(sx, sy));
                }
            }
        }
        this.pointerDown = null;
        this.canvas.releasePointerCapture(event.pointerId);
    };

    private handlePointerLeave = (): void => {
        this.hover = null;
        this.resetMapTooltip();
    };

    private handlePointerCancel = (): void => {
        this.pointerDown = null;
        this.miniDrag = false;
        this.handlePointerLeave();
    };

    private handleWheel = (event: WheelEvent): void => {
        this.resetMapTooltip();
        event.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        this.camera.zoomAt(
            event.clientX - rect.left,
            event.clientY - rect.top,
            Math.exp(-event.deltaY * 0.0012),
            this.viewW,
            this.viewH,
        );
    };

    private handleContextMenu = (event: Event): void => {
        event.preventDefault();
    };

    private jumpMini(sx: number, sy: number): void {
        this.resetMapTooltip();
        const mini = this.miniRect();
        const { width, height } = this.engine.state.graph.domain;
        const wx = ((sx - mini.x) / mini.w) * width;
        const wy = ((sy - mini.y) / mini.h) * height;
        this.camera.centerOn(wx, wy);
    }

    // ---- delayed map details (one frame clock, no timers or layout polling) ----

    private requestMapTooltip(detail: MapTooltipRequest): void {
        document.dispatchEvent(new CustomEvent<MapTooltipRequest>(MAP_TOOLTIP_EVENT, { detail }));
    }

    private readonly resetMapTooltip = (): void => {
        const shown = this.tooltipHover !== null && this.tooltipHover.title !== null;
        this.tooltipHover = null;
        if (shown) this.requestMapTooltip({ action: "hide", anchor: this.canvas });
    };

    private readonly handleTooltipDismiss = (event: Event): void => {
        if ((event as CustomEvent<{ anchor: HTMLCanvasElement }>).detail?.anchor === this.canvas) this.resetMapTooltip();
    };

    private readonly handleDocumentPointer = (event: PointerEvent): void => {
        if (event.target !== this.canvas || event.buttons) this.handlePointerLeave();
    };

    private readonly handleTooltipKey = (event: KeyboardEvent): void => {
        if (["Escape", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) this.resetMapTooltip();
    };

    private tooltipViewUnchanged(): boolean {
        const pending = this.tooltipHover;
        return pending !== null && pending.state === this.engine.state
            && pending.cameraX === this.camera.x && pending.cameraY === this.camera.y && pending.zoom === this.camera.zoom;
    }

    private updateMapTooltip(now: number): void {
        const pending = this.tooltipHover;
        if (!pending) return;
        if (!this.tooltipViewUnchanged() || this.currentConstructionKind !== null
            || this.hover === null || this.pointerDown || this.miniDrag) {
            this.resetMapTooltip();
            return;
        }
        const state = this.engine.state;
        if (this.currentMapMode === "state") {
            // One-shot aggregate snapshot: computed at hover, never refreshed while shown.
            if (pending.title !== null) return;
            if (state.provinces[this.hover]?.stateId !== pending.key) {
                this.resetMapTooltip();
                return;
            }
            pending.since ??= now;
            if (now - pending.since < MAP_HOVER_DELAY) return;
            const region = state.states[pending.key];
            const summary = region ? stateSummary(state, region.id) : null;
            if (!region || !summary) {
                this.resetMapTooltip();
                return;
            }
            const chips = (ids: number[]): string => ids.length
                ? ids.map((id) => chipToken(state.nations[id].color, state.nations[id].name)).join(" ")
                : "无";
            const control = summary.control.length
                ? summary.control.map((entry) => `${chipToken(state.nations[entry.nation].color, state.nations[entry.nation].name)} ${entry.percent}%`).join(" / ")
                : "无";
            const title = escapeGameText(region.name);
            const body = `核心：${chips(summary.cores)}\n拥有者：${chips(summary.owners)}\n控制明细：${control}\n持有宣称：${chips(summary.claimants)}`;
            pending.title = title;
            pending.body = body;
            this.requestMapTooltip({ action: "show", anchor: this.canvas, x: pending.x, y: pending.y,
                source: { kind: "state", site: pending.site, title, body } });
            return;
        }
        if (this.hover !== pending.site) {
            this.resetMapTooltip();
            return;
        }
        pending.since ??= now;
        if (now - pending.since < MAP_HOVER_DELAY) return;
        const province = state.provinces[pending.site];
        const region = state.states[province.stateId];
        const title = escapeGameText(province.name);
        const relation = garrisonRelation(state, province.owner);
        const body = `所属州：${escapeGameText(region?.name ?? "未属州")}\n控制国：${escapeGameText(ownerName(state, province.owner))}\n正式归属：${escapeGameText(ownerName(state, province.legalOwner))}\n地形：${escapeGameText(BIOME_ZH[state.terrain.biomeAt(province.site)])}\n${textToken(relation)}驻军 ${Math.round(province.garrison)}/${province.garrisonMax}`;
        // Refresh stationary details without repeated DOM writes or measurements.
        if (title === pending.title && body === pending.body) return;
        pending.title = title;
        pending.body = body;
        this.requestMapTooltip({ action: "show", anchor: this.canvas, x: pending.x, y: pending.y,
            source: { kind: "province", site: pending.site, title, body } });
    }

    // ---- engine events ----

    private markDirty(site: number): void {
        // A center capture can recolor an entire state, not just this cell.
        if (this.currentMapMode === "state") this.baseDirty = true;
        this.dirtySites.add(site);
        for (const neighbor of this.engine.state.graph.cells[site].neighbors) {
            this.dirtySites.add(neighbor);
        }
        this.frontlineDirty = true;
    }

    private onEngineEvent(event: EngineEvent): void {
        const now = performance.now();
        const { graph } = this.engine.state;
        switch (event.type) {
            case "state": {
                this.constructionDirty = true;
                const signature = this.engine.state.claims
                    .filter((claim) => claim.nation === 0)
                    .map((claim) => claim.stateId).join(",");
                if (signature !== this.claimSignature) {
                    this.claimSignature = signature;
                    this.baseDirty = true;
                }
                if (this.claimsOverlay) this.claimableCache = claimableStateIds(this.engine.state, 0);
                break;
            }
            case "move": {
                if (event.path.length < 2) break;
                const points: Vec2[] = [];
                let prev: Vec2 = { x: graph.sites[event.path[0]].x, y: graph.sites[event.path[0]].y };
                points.push(prev);
                for (let i = 1; i < event.path.length; i++) {
                    const site = graph.sites[event.path[i]];
                    const delta = periodicDelta(prev, site, graph.domain);
                    prev = { x: prev.x + delta.x, y: prev.y + delta.y };
                    points.push(prev);
                }
                this.moveAnims.push({
                    armyId: event.armyId,
                    points,
                    start: now,
                    dur: Math.min(700, Math.max(220, 110 * (event.path.length - 1))),
                });
                break;
            }
            case "battle-start": {
                this.fx.push({ kind: "combat", province: event.province, start: now, dur: 420, color: "#f85149" });
                break;
            }
            case "combat": {
                const site = graph.sites[event.province];
                this.fx.push({ kind: "combat", province: event.province, start: now, dur: 420, color: "#f85149" });
                const garrisonLoss = Math.max(0, event.garrisonBefore - event.garrisonAfter);
                const title = event.outcome === "captured"
                    ? "防线崩溃"
                    : event.outcome === "repelled"
                        ? "进攻击退"
                        : garrisonLoss > 0
                            ? `驻军 -${garrisonLoss}`
                            : `守军 -${event.defenderLoss}`;
                this.floats.push({ x: site.x + 12, y: site.y - 20, text: title, color: "#f85149", start: now, dur: 1050 });
                if (event.attackerLoss > 0) {
                    this.floats.push({ x: site.x - 16, y: site.y - 8, text: `-${event.attackerLoss}`, color: "#d29922", start: now + 120, dur: 950 });
                }
                break;
            }
            case "capture": {
                this.constructionDirty = true;
                if (event.eliminated !== null) this.baseDirty = true;
                else this.markDirty(event.province);
                const nation = this.engine.state.nations[event.nationId];
                this.fx.push({ kind: "capture", province: event.province, start: now, dur: 650, color: nation.color });
                break;
            }
            case "deploy": {
                this.fx.push({ kind: "recruit", province: event.province, start: now, dur: 340, color: "#3fb950" });
                break;
            }
            case "build": {
                this.constructionDirty = true;
                if (this.constructionActive) break;
                if (BUILDING_PROFILES[event.kind].scope === "state") {
                    this.baseDirty = true;
                    this.dirtySites.clear();
                } else {
                    this.markDirty(event.province);
                }
                break;
            }
            case "war":
            case "peace": {
                this.frontlineDirty = true;
                break;
            }
            case "day": {
                // Snow cover only changes with the season; ordinary days leave
                // the base layer untouched.
                if (event.seasonIndex !== this.lastSeason) {
                    this.lastSeason = event.seasonIndex;
                    this.baseDirty = true;
                }
                break;
            }
            default:
                break;
        }
    }

    // ---- base layer ----

    /** Frame slices stay small enough to keep input and combat FX responsive. */
    private static readonly BASE_BUDGET_MS = 4;
    private static readonly CELL_CHUNK = 24;
    private static readonly PROVINCE_CHUNK = 32;

    private beginBaseRebuild(): void {
        this.baseDirty = false;
        this.dirtySites.clear();
        this.baseBuild = this.rebuildBaseSteps(this.spareCtx);
    }

    /** Advance the staged rebuild within a frame budget; swap buffers only when complete. */
    private advanceBaseRebuild(): void {
        if (!this.baseBuild) return;
        const deadline = performance.now() + MapRenderer.BASE_BUDGET_MS;
        do {
            if (this.baseBuild.next().done) {
                this.baseBuild = null;
                const base = this.base;
                this.base = this.spare;
                this.spare = base;
                const ctx = this.baseCtx;
                this.baseCtx = this.spareCtx;
                this.spareCtx = ctx;
                this.frontlineDirty = true;
                return;
            }
        } while (performance.now() < deadline);
    }

    private *rebuildBaseSteps(ctx: CanvasRenderingContext2D): Generator<void, void, void> {
        const { graph, terrain, provinces, seasonIndex } = this.engine.state;
        const { width, height } = graph.domain;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);

        for (let from = 0; from < graph.cells.length; from += MapRenderer.CELL_CHUNK) {
            drawBiomes(ctx, graph, terrain, width, height, seasonIndex, from, Math.min(graph.cells.length, from + MapRenderer.CELL_CHUNK));
            yield;
        }

        if (this.currentMapMode === "state") {
            for (let from = 0; from < provinces.length; from += MapRenderer.PROVINCE_CHUNK) {
                const to = Math.min(provinces.length, from + MapRenderer.PROVINCE_CHUNK);
                for (let i = from; i < to; i++) this.paintStateProvince(ctx, provinces[i]);
                yield;
            }
            this.drawClaimLand(ctx);
        } else {
            ctx.save();
            ctx.globalAlpha = 0.8;
            for (let from = 0; from < graph.cells.length; from += MapRenderer.CELL_CHUNK) {
                const to = Math.min(graph.cells.length, from + MapRenderer.CELL_CHUNK);
                for (let i = from; i < to; i++) drawTerrainDecorCell(ctx, graph, terrain, graph.cells[i].site);
                yield;
            }
            ctx.restore();
            for (let from = 0; from < provinces.length; from += MapRenderer.PROVINCE_CHUNK) {
                const to = Math.min(provinces.length, from + MapRenderer.PROVINCE_CHUNK);
                for (let i = from; i < to; i++) this.paintProvinceTint(ctx, provinces[i]);
                yield;
            }
            ctx.globalAlpha = 1;
        }

        this.drawConstructionLand(ctx);
        yield;
        this.drawEdges(ctx, provinces.map((province) => province.site));
        yield;
        for (let from = 0; from < provinces.length; from += MapRenderer.PROVINCE_CHUNK) {
            const to = Math.min(provinces.length, from + MapRenderer.PROVINCE_CHUNK);
            for (let i = from; i < to; i++) this.drawProvinceMarkers(ctx, provinces[i].site);
            yield;
        }
    }

    private paintStateProvince(ctx: CanvasRenderingContext2D, province: Province): void {
        const { graph, terrain, provinces, states } = this.engine.state;
        const { width, height } = graph.domain;
        const cell = graph.cells[province.site];
        if (!terrain.passable[province.site] || !cell.bounded) return;
        const region = states[province.stateId];
        const occupied = region && province.owner !== provinces[region.center].owner;
        const owner = occupied || !region ? province.owner : provinces[region.center].owner;
        ctx.fillStyle = this.stateColor(owner, province.stateId, this.landFactor());
        fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
        if (!occupied) return;
        ctx.save();
        ctx.beginPath();
        this.addWrappedPolygonPath(ctx, cell.polygon, width, height);
        ctx.clip();
        ctx.strokeStyle = "rgba(13, 17, 23, 0.28)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = -height; x < width; x += 12) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x + height, height);
        }
        ctx.stroke();
        ctx.restore();
    }

    private paintProvinceTint(ctx: CanvasRenderingContext2D, province: Province): void {
        const { graph, terrain, nations } = this.engine.state;
        const { width, height } = graph.domain;
        if (province.owner === NEUTRAL || !terrain.passable[province.site]) return;
        const cell = graph.cells[province.site];
        if (!cell.bounded) return;
        ctx.globalAlpha = this.tintAlpha();
        ctx.fillStyle = nations[province.owner].color;
        fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
    }

    private stateColor(owner: number, stateId: number, factor = 1): string {
        const color = this.engine.state.nations[owner]?.color ?? NEUTRAL_COLOR;
        const rgb = Number.parseInt(color.slice(1), 16);
        const shade = (((stateId + 1) * 37) % 11 - 5) * 0.022;
        const channel = (shift: number): number => {
            const value = (rgb >> shift) & 255;
            const shaded = shade > 0 ? value + (255 - value) * shade : value * (1 + shade);
            return Math.round(shaded * factor);
        };
        return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
    }

    private drawClaimLand(ctx: CanvasRenderingContext2D): void {
        const { graph, terrain, states, claims, nations } = this.engine.state;
        const { width, height } = graph.domain;
        const color = nations[0].color;
        for (const claim of claims) {
            if (claim.nation !== 0) continue;
            const region = states[claim.stateId];
            if (!region) continue;
            ctx.save();
            ctx.globalAlpha = 0.24;
            ctx.fillStyle = color;
            for (const site of region.provinces) {
                const cell = graph.cells[site];
                if (terrain.passable[site] && cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
            }
            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (const [a, b] of this.stateBoundary(claim.stateId)) drawWrappedLine(ctx, a, b, width, height, true, true, false);
            ctx.stroke();
            ctx.restore();
        }
    }

    private drawClaimFocus(ctx: CanvasRenderingContext2D): void {
        if (this.claimFocus === null || this.currentMapMode !== "state") return;
        const region = this.engine.state.states[this.claimFocus];
        if (!region) return;
        const { graph } = this.engine.state;
        const { width, height } = graph.domain;
        ctx.save();
        ctx.strokeStyle = "rgba(240, 246, 252, 0.9)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        for (const [a, b] of this.stateBoundary(this.claimFocus)) drawWrappedLine(ctx, a, b, width, height, true, true, false);
        ctx.stroke();
        ctx.restore();
    }

    /** Gold breathing fill + marching outline for states the player may claim right now. */
    private drawClaimablePulse(ctx: CanvasRenderingContext2D, now: number): void {
        if (!this.claimsOverlay || this.currentMapMode !== "state" || this.claimableCache.length === 0) return;
        const { graph, terrain, states } = this.engine.state;
        const { width, height } = graph.domain;
        ctx.save();
        for (const stateId of this.claimableCache) {
            const region = states[stateId];
            if (!region) continue;
            const wave = this.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260 + stateId * 1.7);
            ctx.globalAlpha = 0.06 + 0.14 * wave;
            ctx.fillStyle = "#f0b429";
            for (const site of region.provinces) {
                const cell = graph.cells[site];
                if (terrain.passable[site] && cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
            }
            ctx.globalAlpha = 0.5 + 0.4 * wave;
            ctx.strokeStyle = "#f0b429";
            ctx.lineWidth = 2;
            ctx.setLineDash([7, 5]);
            ctx.lineDashOffset = this.reduceMotion ? 0 : -((now / 55) % 12);
            ctx.beginPath();
            for (const [a, b] of this.stateBoundary(stateId)) drawWrappedLine(ctx, a, b, width, height, true, true, false);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();
    }

    private drawConstructionLand(ctx: CanvasRenderingContext2D): void {
        if (!this.constructionActive || !this.constructionOverlay) return;
        const { graph } = this.engine.state;
        const { width, height } = graph.domain;
        for (const area of this.constructionOverlay.areas) {
            ctx.fillStyle = area.color;
            for (const site of area.sites) {
                const cell = graph.cells[site];
                if (cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
            }
        }
    }

    /**
     * Repaint only changed provinces (plus their neighbors, whose shared
     * borders may change). Everything is clipped to the dirty region so
     * strokes cannot bleed into untouched cells.
     */
    private repaintDirty(): void {
        if (this.currentMapMode === "state" || this.constructionActive) {
            this.baseDirty = true;
            return;
        }
        const { graph, terrain, provinces, nations } = this.engine.state;
        const { width, height } = graph.domain;
        const ctx = this.baseCtx;
        const sites = [...this.dirtySites];
        this.dirtySites.clear();

        ctx.save();
        ctx.beginPath();
        for (const site of sites) {
            const cell = graph.cells[site];
            if (cell.bounded) this.addWrappedPolygonPath(ctx, cell.polygon, width, height);
        }
        ctx.clip();

        for (const site of sites) {
            const cell = graph.cells[site];
            if (!cell.bounded) continue;
            ctx.fillStyle = cellFillColor(terrain, site, this.engine.state.seasonIndex);
            fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
            const snow = terrain.snowCover[site];
            if (snow > 0) {
                ctx.fillStyle = snow >= 2 ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 255, 255, 0.5)";
                fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
            }
        }

        ctx.globalAlpha = 0.8;
        for (const site of sites) drawTerrainDecorCell(ctx, graph, terrain, site);
        for (const site of sites) {
            const province = provinces[site];
            if (province.owner === NEUTRAL || !terrain.passable[site]) continue;
            const cell = graph.cells[site];
            if (!cell.bounded) continue;
            ctx.globalAlpha = this.tintAlpha();
            ctx.fillStyle = nations[province.owner].color;
            fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
        }
        ctx.globalAlpha = 1;

        this.drawEdges(ctx, sites);
        // A marker in a clean neighbor may extend into the clipped dirty area.
        for (const province of provinces) this.drawProvinceMarkers(ctx, province.site);
        ctx.restore();
    }

    private addWrappedPolygonPath(
        ctx: CanvasRenderingContext2D,
        polygon: readonly Vec2[],
        width: number,
        height: number,
    ): void {
        if (polygon.length < 3) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of polygon) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        for (let ox = -1; ox <= 1; ox++) {
            if (maxX + ox * width < 0 || minX + ox * width > width) continue;
            for (let oy = -1; oy <= 1; oy++) {
                if (maxY + oy * height < 0 || minY + oy * height > height) continue;
                const dx = ox * width;
                const dy = oy * height;
                ctx.moveTo(polygon[0].x + dx, polygon[0].y + dy);
                for (let i = 1; i < polygon.length; i++) {
                    ctx.lineTo(polygon[i].x + dx, polygon[i].y + dy);
                }
                ctx.closePath();
            }
        }
    }

    /** Batch-stroke hairlines, coasts and national borders for a set of cells. */
    private drawEdges(ctx: CanvasRenderingContext2D, sites: Iterable<number>): void {
        const { graph, terrain, provinces, nations } = this.engine.state;
        const { width, height } = graph.domain;
        const count = provinces.length;
        const seen = new Set<number>();
        const hairlines: [Vec2, Vec2][] = [];
        const coasts: [Vec2, Vec2][] = [];
        const stateLines: [Vec2, Vec2][] = [];
        const borders = new Map<string, [Vec2, Vec2][]>();
        const rims = new Map<string, [Vec2, Vec2][]>();
        const rimOn = this.colorMode === "gradient" && this.camera.zoom > this.deepZoom;

        for (const site of sites) {
            const cell = graph.cells[site];
            if (!cell.bounded) continue;
            const province = provinces[site];
            for (let k = 0; k < cell.neighbors.length; k++) {
                const neighbor = cell.neighbors[k];
                const key = Math.min(site, neighbor) * count + Math.max(site, neighbor);
                if (seen.has(key)) continue;
                seen.add(key);

                const other = provinces[neighbor];
                const a = cell.polygon[k];
                const b = cell.polygon[(k + 1) % cell.polygon.length];
                const landA = terrain.passable[site] === 1;
                const landB = terrain.passable[neighbor] === 1;

                if (landA !== landB) {
                    coasts.push([a, b]);
                } else if (landA && province.owner !== other.owner) {
                    const owner = province.owner !== NEUTRAL ? province.owner : other.owner;
                    const color = owner === NEUTRAL ? NEUTRAL_COLOR : nations[owner].color;
                    const list = borders.get(color) ?? [];
                    list.push([a, b]);
                    borders.set(color, list);
                    if (rimOn) {
                        this.pushRim(rims, nations, province.owner, cell, a, b);
                        this.pushRim(rims, nations, other.owner, graph.cells[neighbor], a, b);
                    }
                } else if (landA && province.stateId !== other.stateId) {
                    stateLines.push([a, b]);
                } else if (this.currentMapMode === "province") {
                    hairlines.push([a, b]);
                }
            }
        }

        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(13, 17, 23, 0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b] of hairlines) drawWrappedLine(ctx, a, b, width, height, true, true, false);
        ctx.stroke();

        const stateMode = this.currentMapMode === "state";
        ctx.strokeStyle = "rgba(13, 17, 23, 0.55)";
        ctx.lineWidth = stateMode ? 2.4 : 1.6;
        ctx.beginPath();
        for (const [a, b] of coasts) drawWrappedLine(ctx, a, b, width, height, true, true, false);
        ctx.stroke();

        ctx.strokeStyle = stateMode ? "rgba(13, 17, 23, 0.5)" : "rgba(13, 17, 23, 0.38)";
        ctx.lineWidth = stateMode ? 2 : 1.3;
        ctx.beginPath();
        for (const [a, b] of stateLines) drawWrappedLine(ctx, a, b, width, height, true, true, false);
        ctx.stroke();

        // Gradient zoomed-in: nation-color rim inset inside each national border.
        if (rimOn) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 4.5;
            for (const [color, segments] of rims) {
                ctx.strokeStyle = color;
                ctx.beginPath();
                for (const [a, b] of segments) drawWrappedLine(ctx, a, b, width, height, true, true, false);
                ctx.stroke();
            }
            ctx.restore();
        }

        // Nation borders: one unified dark line, deeper than province/state lines.
        ctx.strokeStyle = "rgba(13, 17, 23, 0.92)";
        ctx.lineWidth = stateMode ? 3.2 : 2.2;
        ctx.beginPath();
        for (const segments of borders.values()) {
            for (const [a, b] of segments) drawWrappedLine(ctx, a, b, width, height, true, true, false);
        }
        ctx.stroke();
    }

    /** Offset a border edge toward one side's interior so the rim stays inside that nation. */
    private pushRim(
        rims: Map<string, [Vec2, Vec2][]>,
        nations: { color: string }[],
        owner: number,
        cell: { bounded: boolean; centroid: Vec2 },
        a: Vec2,
        b: Vec2,
    ): void {
        if (owner === NEUTRAL || !cell.bounded) return;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        let nx = -(b.y - a.y);
        let ny = b.x - a.x;
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        if ((cell.centroid.x - mx) * nx + (cell.centroid.y - my) * ny < 0) {
            nx = -nx;
            ny = -ny;
        }
        const inset = 3.2;
        const color = nations[owner].color;
        const list = rims.get(color) ?? [];
        list.push([
            { x: a.x + nx * inset, y: a.y + ny * inset },
            { x: b.x + nx * inset, y: b.y + ny * inset },
        ]);
        rims.set(color, list);
    }

    /** Outer boundary edges of a state: province edges whose neighbor lies outside the state. */
    private stateBoundary(stateId: number): [Vec2, Vec2][] {
        const { graph, terrain, states } = this.engine.state;
        const region = states[stateId];
        if (!region) return [];
        const members = new Set(region.provinces);
        const segments: [Vec2, Vec2][] = [];
        for (const site of region.provinces) {
            const cell = graph.cells[site];
            if (!cell.bounded || !terrain.passable[site]) continue;
            for (let k = 0; k < cell.neighbors.length; k++) {
                if (members.has(cell.neighbors[k])) continue;
                segments.push([cell.polygon[k], cell.polygon[(k + 1) % cell.polygon.length]]);
            }
        }
        return segments;
    }

    private drawProvinceMarkers(ctx: CanvasRenderingContext2D, site: number): void {
        if (this.constructionActive) return;
        const { graph, terrain, provinces } = this.engine.state;
        const province = provinces[site];
        if (!terrain.passable[site]) return;
        const cell = graph.cells[site];
        const center = cell.bounded ? cell.centroid : graph.sites[site];
        const { width, height } = graph.domain;

        if (province.isCity && this.currentMapMode === "province") {
            this.drawCityMarker(ctx, center, province.isCapital, width, height);
        }
        if (province.buildings.length === 0) return;
        const label = province.buildings.map((kind) => BUILDING_PROFILES[kind].glyph).join(" ");
        ctx.save();
        ctx.font = "600 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const markerWidth = ctx.measureText(label).width + 8;
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const x = center.x + ox * width;
                const y = center.y + oy * height - 23;
                if (x < -markerWidth || x > width + markerWidth || y < -20 || y > height + 20) continue;
                ctx.fillStyle = "rgba(13, 17, 23, 0.9)";
                ctx.strokeStyle = "rgba(230, 237, 243, 0.55)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(x - markerWidth / 2, y - 8, markerWidth, 16, 3);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = "#e6edf3";
                ctx.fillText(label, x, y);
            }
        }
        ctx.restore();
    }

    /** Screen-readable labels, one per visible periodic copy of a state center. */
    private drawRegionMarkers(
        ctx: CanvasRenderingContext2D,
        minX: number,
        maxX: number,
        minY: number,
        maxY: number,
    ): void {
        if (this.currentMapMode === "province") return;
        const { graph, terrain, provinces, states, nations } = this.engine.state;
        const { width, height } = graph.domain;
        const construction = this.constructionActive;
        const overlayAreas = new Map(this.constructionOverlay?.areas.map((area) => [area.id, area]));
        // Counter scaling stays in world space; state names stay readable when zoomed out.
        const scale = Math.max(0.9, Math.min(1.15, this.camera.zoom)) / this.camera.zoom;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const region of states) {
            if (!terrain.passable[region.center]) continue;
            const capacity = construction ? overlayAreas.get(region.id) : undefined;
            if (construction && !capacity) continue;
            let buildingLabel: string;
            if (capacity) {
                buildingLabel = `${BUILDING_PROFILES[this.currentConstructionKind!].glyph} ${capacity.used}/${capacity.limit}`;
                if (capacity.used >= capacity.limit) buildingLabel += " 已满";
            } else {
                const farms = region.buildings.filter((kind) => kind === "farm").length;
                const markers = [
                    `${BUILDING_PROFILES.factory.glyph}${region.factories}`,
                    `${BUILDING_PROFILES.farm.glyph}${farms}`,
                    `${BUILDING_PROFILES.infrastructure.glyph}L${region.infrastructure}`,
                ];
                if (region.buildings.includes("admin")) markers.push(BUILDING_PROFILES.admin.glyph);
                buildingLabel = markers.join(" · ");
            }
            const province = provinces[region.center];
            const point = graph.sites[region.center];
            const buildingFont = capacity
                ? '700 17px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif'
                : '11px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            const nameFont = capacity ? "600 11px system-ui, sans-serif" : "600 12px system-ui, sans-serif";
            ctx.font = buildingFont;
            const buildingWidth = ctx.measureText(buildingLabel).width + 16;
            ctx.font = nameFont;
            const labelWidth = Math.max(ctx.measureText(region.name).width + 28, buildingWidth);
            const labelHeight = capacity ? 42 : 34;
            const bottom = -Math.max(26, 34 / scale);
            const top = bottom - labelHeight;
            const marginX = (labelWidth / 2 + 4) * scale;
            const marginY = (Math.max(Math.abs(top), Math.abs(bottom)) + 8) * scale;
            // Labels crossing a periodic seam must survive offscreen-center culling.
            const firstX = Math.ceil((minX - point.x - marginX) / width);
            const lastX = Math.floor((maxX - point.x + marginX) / width);
            const firstY = Math.ceil((minY - point.y - marginY) / height);
            const lastY = Math.floor((maxY - point.y + marginY) / height);
            for (let ox = firstX; ox <= lastX; ox++) {
                for (let oy = firstY; oy <= lastY; oy++) {
                    ctx.save();
                    ctx.translate(point.x + ox * width, point.y + oy * height);
                    ctx.scale(scale, scale);
                    ctx.strokeStyle = "rgba(230, 237, 243, 0.65)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(0, bottom);
                    ctx.lineTo(0, -6);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(0, -5);
                    ctx.lineTo(5, 0);
                    ctx.lineTo(0, 5);
                    ctx.lineTo(-5, 0);
                    ctx.closePath();
                    ctx.fillStyle = "#e6edf3";
                    ctx.strokeStyle = "#0d1117";
                    ctx.lineWidth = 1.5;
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = "rgba(13, 17, 23, 0.9)";
                    ctx.strokeStyle = "rgba(230, 237, 243, 0.55)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.roundRect(-labelWidth / 2, top, labelWidth, labelHeight, 4);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = capacity?.color ?? nations[province.owner]?.color ?? NEUTRAL_COLOR;
                    ctx.fillRect(-labelWidth / 2 + 4, top + 5, 3, 12);
                    ctx.font = nameFont;
                    ctx.fillStyle = "#f0f6fc";
                    ctx.fillText(region.name, 3, top + 11);
                    ctx.font = buildingFont;
                    ctx.fillText(buildingLabel, 0, bottom - (capacity ? 13 : 8));
                    ctx.restore();
                }
            }
        }
        ctx.restore();
    }

    /** Compact capacity badges keep a fixed screen size, including periodic copies. */
    private drawProvinceCapacityMarkers(
        ctx: CanvasRenderingContext2D,
        minX: number,
        maxX: number,
        minY: number,
        maxY: number,
    ): void {
        if (!this.constructionActive || this.currentMapMode !== "province"
            || this.camera.zoom < PROVINCE_CAPACITY_MIN_ZOOM || !this.constructionOverlay) return;
        const { graph } = this.engine.state;
        const { width, height, periodicX, periodicY } = graph.domain;
        const scale = 1 / this.camera.zoom;
        ctx.save();
        ctx.font = '600 13px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const area of this.constructionOverlay.areas) {
            const cell = graph.cells[area.center];
            const point = cell.bounded ? cell.centroid : graph.sites[area.center];
            const label = `${BUILDING_PROFILES[this.currentConstructionKind!].glyph} ${area.used}/${area.limit}`;
            const labelWidth = ctx.measureText(label).width + 18;
            const labelHeight = 22;
            const marginX = (labelWidth / 2 + 1) * scale;
            const marginY = (labelHeight / 2 + 1) * scale;
            const firstX = periodicX ? Math.ceil((minX - point.x - marginX) / width) : 0;
            const lastX = periodicX ? Math.floor((maxX - point.x + marginX) / width) : 0;
            const firstY = periodicY ? Math.ceil((minY - point.y - marginY) / height) : 0;
            const lastY = periodicY ? Math.floor((maxY - point.y + marginY) / height) : 0;
            for (let ox = firstX; ox <= lastX; ox++) {
                for (let oy = firstY; oy <= lastY; oy++) {
                    const x = point.x + ox * width;
                    const y = point.y + oy * height;
                    if (x + marginX < minX || x - marginX > maxX
                        || y + marginY < minY || y - marginY > maxY) continue;
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.scale(scale, scale);
                    ctx.fillStyle = "rgba(13, 17, 23, 0.9)";
                    ctx.strokeStyle = "rgba(230, 237, 243, 0.55)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.roundRect(-labelWidth / 2, -labelHeight / 2, labelWidth, labelHeight, 4);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = area.color;
                    ctx.fillRect(-labelWidth / 2 + 4, -6, 3, 12);
                    ctx.fillStyle = "#f0f6fc";
                    ctx.fillText(label, 3, 0);
                    ctx.restore();
                }
            }
        }
        ctx.restore();
    }

    private drawCityMarker(ctx: CanvasRenderingContext2D, center: Vec2, capital: boolean, width: number, height: number): void {
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const x = center.x + ox * width;
                const y = center.y + oy * height;
                if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;
                ctx.save();
                ctx.translate(x, y);
                if (capital) {
                    ctx.beginPath();
                    for (let i = 0; i < 10; i++) {
                        const r = i % 2 === 0 ? 9 : 4;
                        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
                        const px = Math.cos(angle) * r;
                        const py = Math.sin(angle) * r;
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.fillStyle = "#f0f6fc";
                    ctx.strokeStyle = "rgba(13,17,23,0.9)";
                    ctx.lineWidth = 2;
                    ctx.fill();
                    ctx.stroke();
                } else {
                    ctx.fillStyle = "rgba(13,17,23,0.85)";
                    ctx.strokeStyle = "rgba(240,246,252,0.85)";
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.moveTo(-6, 6);
                    ctx.lineTo(-6, -1);
                    ctx.lineTo(0, -7);
                    ctx.lineTo(6, -1);
                    ctx.lineTo(6, 6);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }
                ctx.restore();
            }
        }
    }

    // ---- frontline ----

    private rebuildFrontline(): void {
        const state = this.engine.state;
        const { graph, provinces, terrain } = state;
        this.frontlineSegments = [];
        if (state.winner === null) {
            for (const province of provinces) {
                if (province.owner !== 0 || !terrain.passable[province.site]) continue;
                const cell = graph.cells[province.site];
                if (!cell.bounded) continue;
                for (let k = 0; k < cell.neighbors.length; k++) {
                    const neighbor = cell.neighbors[k];
                    if (neighbor <= province.site || !terrain.passable[neighbor]) continue;
                    const owner = provinces[neighbor].owner;
                    if (owner !== NEUTRAL && !isAtWar(state, 0, owner)) continue;
                    this.frontlineSegments.push([
                        cell.polygon[k],
                        cell.polygon[(k + 1) % cell.polygon.length],
                    ]);
                }
            }
        }
        this.frontlineDirty = false;
    }

    private drawFrontline(ctx: CanvasRenderingContext2D, now: number): void {
        if (this.frontlineSegments.length === 0) return;
        const { width, height } = this.engine.state.graph.domain;
        ctx.save();
        ctx.strokeStyle = "rgba(248, 81, 73, 0.85)";
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 7]);
        ctx.lineDashOffset = -((now / 80) % 17);
        ctx.beginPath();
        for (const [a, b] of this.frontlineSegments) {
            drawWrappedLine(ctx, a, b, width, height, true, true, false);
        }
        ctx.stroke();
        ctx.restore();
    }

    // ---- frame ----

    private frame = (now: number): void => {
        if (this.destroyed) return;
        this.raf = requestAnimationFrame(this.frame);
        this.updateMapTooltip(now);
        if (this.viewW === 0) return;
        // Coalesce partial-day events so cached fills and labels share the latest capacity.
        this.refreshConstructionOverlay();
        const level = this.colorMode === "uniform" ? "u" : this.camera.zoom <= this.deepZoom ? "d" : "g";
        if (level !== this.colorLevel) {
            this.colorLevel = level;
            this.baseDirty = true;
        }
        if (this.baseDirty && !this.baseBuild) this.beginBaseRebuild();
        if (this.baseBuild) this.advanceBaseRebuild();
        else if (this.dirtySites.size > 0) {
            this.repaintDirty();
            if (this.baseDirty && !this.baseBuild) {
                this.beginBaseRebuild();
                this.advanceBaseRebuild();
            }
        }
        if (this.frontlineDirty) this.rebuildFrontline();

        const dt = this.lastFrame === 0 ? 16 : Math.min(50, now - this.lastFrame);
        this.lastFrame = now;

        this.moveAnims = this.moveAnims.filter((anim) => now - anim.start < anim.dur);
        this.fx = this.fx.filter((effect) => now - effect.start < effect.dur);
        this.floats = this.floats.filter((text) => now - text.start < text.dur);

        const { graph } = this.engine.state;
        const { width, height } = graph.domain;
        const ctx = this.ctx;
        const cam = this.camera;

        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = "#0d1117";
        ctx.fillRect(0, 0, this.viewW, this.viewH);

        const minX = cam.x - this.viewW / (2 * cam.zoom);
        const maxX = cam.x + this.viewW / (2 * cam.zoom);
        const minY = cam.y - this.viewH / (2 * cam.zoom);
        const maxY = cam.y + this.viewH / (2 * cam.zoom);
        const offsets: [number, number][] = [];
        for (let ox = Math.floor(minX / width); ox <= Math.floor(maxX / width); ox++) {
            for (let oy = Math.floor(minY / height); oy <= Math.floor(maxY / height); oy++) {
                offsets.push([ox * width, oy * height]);
            }
        }

        ctx.setTransform(
            this.dpr * cam.zoom, 0, 0, this.dpr * cam.zoom,
            this.dpr * (this.viewW / 2 - cam.x * cam.zoom),
            this.dpr * (this.viewH / 2 - cam.y * cam.zoom),
        );

        for (const [ox, oy] of offsets) ctx.drawImage(this.base, ox, oy);
        for (const [ox, oy] of offsets) {
            ctx.save();
            ctx.translate(ox, oy);
            this.drawClaimablePulse(ctx, now);
            this.drawClaimFocus(ctx);
            ctx.restore();
        }

        const state = this.engine.state;
        const selected = state.selected;
        const tactical = this.currentMapMode === "province";
        const selectedArmy = this.engine.selectedArmy();
        const playerArmy = tactical && selectedArmy && selectedArmy.nation === 0 && state.winner === null ? selectedArmy : null;
        const reach = playerArmy ? this.engine.reachFor(playerArmy) : null;
        const targets = playerArmy ? this.engine.targetsFor(playerArmy) : [];
        const redeployArmy = tactical && state.redeployArmyId !== null
            ? state.armies.get(state.redeployArmyId) ?? null
            : null;
        const redeploySet = redeployArmy ? this.engine.redeployTargetsFor(redeployArmy) : null;
        const battleByProvince = new Map(state.battles.map((battle) => [battle.province, battle]));

        this.counterHits = [];
        for (const [ox, oy] of offsets) {
            ctx.save();
            ctx.translate(ox, oy);

            if (reach) {
                ctx.fillStyle = "rgba(31, 111, 235, 0.22)";
                for (const site of reach.cost.keys()) {
                    const cell = graph.cells[site];
                    if (cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
                }
            }
            if (redeploySet) {
                ctx.fillStyle = "rgba(63, 185, 80, 0.24)";
                for (const site of redeploySet) {
                    const cell = graph.cells[site];
                    if (cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
                }
            }
            ctx.fillStyle = "rgba(248, 81, 73, 0.28)";
            for (const site of targets) {
                const cell = graph.cells[site];
                if (cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
            }

            for (const effect of this.fx) {
                const cell = graph.cells[effect.province];
                if (!cell.bounded) continue;
                const p = Math.min(1, Math.max(0, (now - effect.start) / effect.dur));
                if (effect.kind === "combat") {
                    if (!tactical) continue;
                    ctx.globalAlpha = 0.45 * Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p);
                    ctx.fillStyle = "#ffffff";
                    fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
                    ctx.globalAlpha = 1;
                } else if (effect.kind === "capture") {
                    const center = graph.sites[effect.province];
                    ctx.globalAlpha = 1 - p;
                    ctx.strokeStyle = effect.color;
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(center.x, center.y, 12 + p * 55, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                }
            }

            const sameState = this.currentMapMode === "state" && this.hover !== null && selected !== null
                && state.provinces[this.hover].stateId >= 0
                && state.provinces[this.hover].stateId === state.provinces[selected].stateId;
            if (this.hover !== null && this.hover !== selected && !sameState) {
                this.highlightSite(ctx, this.hover, false);
            }
            if (selected !== null) this.highlightSite(ctx, selected, true);
            ctx.restore();
        }

        this.drawRegionMarkers(ctx, minX, maxX, minY, maxY);
        this.drawProvinceCapacityMarkers(ctx, minX, maxX, minY, maxY);

        for (const [ox, oy] of offsets) {
            ctx.save();
            ctx.translate(ox, oy);
            this.drawFrontline(ctx, now);
            if (!tactical) {
                ctx.restore();
                continue;
            }
            this.drawMarchOrders(ctx, now);
            this.drawBattles(ctx, now, battleByProvince);

            if (reach && this.hover !== null && reach.cost.has(this.hover) && playerArmy) {
                const path = pathTo(reach, this.hover);
                ctx.strokeStyle = "rgba(230, 237, 243, 0.9)";
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 6]);
                ctx.beginPath();
                for (let i = 0; i + 1 < path.length; i++) {
                    drawWrappedLine(ctx, graph.sites[path[i]], graph.sites[path[i + 1]], width, height);
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }

            for (const army of state.armies.values()) {
                this.drawArmyCounter(ctx, army, now, battleByProvince.has(army.province) || this.isAttacking(army.id), ox, oy);
            }

            for (const text of this.floats) {
                const p = (now - text.start) / text.dur;
                if (p < 0) continue;
                ctx.globalAlpha = 1 - p * p;
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.lineWidth = 3;
                ctx.strokeStyle = "rgba(13,17,23,0.9)";
                ctx.strokeText(text.text, text.x, text.y - p * 34);
                ctx.fillStyle = text.color;
                ctx.fillText(text.text, text.x, text.y - p * 34);
                ctx.globalAlpha = 1;
            }

            ctx.restore();
        }

        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.drawSnow(ctx, now, dt);
        this.drawMinimap(ctx, minX, maxX, minY, maxY);
    };

    private isAttacking(armyId: number): boolean {
        return this.engine.state.battles.some((battle) => battle.attackerId === armyId);
    }

    private drawMarchOrders(ctx: CanvasRenderingContext2D, now: number): void {
        const state = this.engine.state;
        const { graph } = state;
        const { width, height } = graph.domain;
        for (const army of state.armies.values()) {
            if (army.nation !== 0 || !army.march) continue;
            const from = graph.sites[army.province];
            const to = graph.sites[army.march.target];
            const color = army.march.attack ? "#f85149" : "#58a6ff";
            ctx.save();
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 2.2;
            ctx.setLineDash([9, 6]);
            ctx.lineDashOffset = -((now / 55) % 15);
            ctx.beginPath();
            drawWrappedLine(ctx, from, to, width, height);
            ctx.stroke();
            ctx.setLineDash([]);

            const delta = periodicDelta(from, to, graph.domain);
            const end = { x: from.x + delta.x, y: from.y + delta.y };
            const angle = Math.atan2(delta.y, delta.x);
            ctx.beginPath();
            ctx.arc(end.x, end.y, 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - 13 * Math.cos(angle - 0.42), end.y - 13 * Math.sin(angle - 0.42));
            ctx.lineTo(end.x - 13 * Math.cos(angle + 0.42), end.y - 13 * Math.sin(angle + 0.42));
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    }

    private drawBattles(
        ctx: CanvasRenderingContext2D,
        now: number,
        battleByProvince: Map<number, { province: number; attackerId: number; rounds: number }>,
    ): void {
        const state = this.engine.state;
        const { graph } = state;
        const { width, height } = graph.domain;
        for (const battle of battleByProvince.values()) {
            const attacker = state.armies.get(battle.attackerId);
            const target = graph.sites[battle.province];
            ctx.save();
            if (attacker) {
                const from = graph.sites[attacker.province];
                ctx.strokeStyle = "rgba(248, 81, 73, 0.75)";
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                drawWrappedLine(ctx, from, target, width, height);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            const pulse = 16 + 3 * Math.sin(now / 180);
            ctx.strokeStyle = "#f85149";
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.arc(target.x, target.y, pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.font = "700 10px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(13,17,23,0.9)";
            const label = `激战 ${battle.rounds} 日`;
            ctx.strokeText(label, target.x, target.y - 24);
            ctx.fillStyle = "#f85149";
            ctx.fillText(label, target.x, target.y - 24);
            ctx.restore();
        }
    }

    private highlightSite(ctx: CanvasRenderingContext2D, site: number, selected: boolean): void {
        const { graph, provinces, states, terrain } = this.engine.state;
        const region = states[provinces[site].stateId];
        const color = selected ? "#e6edf3" : "rgba(230, 237, 243, 0.65)";
        const lineWidth = selected ? 2.4 : 1.6;
        if (this.currentMapMode === "province" || !region) {
            this.strokeCell(ctx, site, color, lineWidth);
            return;
        }
        const { width, height } = graph.domain;
        ctx.save();
        // Clip per tile to avoid double-blending highlights across periodic seams.
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        ctx.clip();
        if (!this.constructionActive) {
            ctx.fillStyle = selected ? "rgba(230, 237, 243, 0.09)" : "rgba(230, 237, 243, 0.04)";
            for (const member of region.provinces) {
                const cell = graph.cells[member];
                if (cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
            }
        }
        // Only the state's outer edges light up; shared member edges stay dark.
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth / Math.min(1, this.camera.zoom);
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (const member of region.provinces) {
            const cell = graph.cells[member];
            if (!cell.bounded) continue;
            for (let k = 0; k < cell.neighbors.length; k++) {
                const neighbor = cell.neighbors[k];
                if (terrain.passable[neighbor] && provinces[neighbor].stateId === region.id) continue;
                drawWrappedLine(ctx, cell.polygon[k], cell.polygon[(k + 1) % cell.polygon.length], width, height, true, true, false);
            }
        }
        ctx.stroke();
        if (selected && region.provinces.length > 1) {
            ctx.setLineDash([4, 4]);
            this.strokeCell(ctx, site, "rgba(230, 237, 243, 0.4)", 1 / Math.min(1, this.camera.zoom));
        }
        ctx.restore();
    }

    private strokeCell(ctx: CanvasRenderingContext2D, site: number, color: string, lineWidth: number): void {
        const { graph } = this.engine.state;
        const cell = graph.cells[site];
        if (!cell.bounded) return;
        const { width, height } = graph.domain;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                ctx.beginPath();
                const polygon = cell.polygon;
                ctx.moveTo(polygon[0].x + ox * width, polygon[0].y + oy * height);
                for (let i = 1; i < polygon.length; i++) {
                    ctx.lineTo(polygon[i].x + ox * width, polygon[i].y + oy * height);
                }
                ctx.closePath();
                ctx.stroke();
            }
        }
    }

    private armyPosition(army: Army, now: number): Vec2 {
        const { graph } = this.engine.state;
        for (const anim of this.moveAnims) {
            if (anim.armyId !== army.id || anim.points.length < 2) continue;
            const p = Math.min(1, Math.max(0, (now - anim.start) / anim.dur));
            const eased = p * (2 - p);
            const segment = eased * (anim.points.length - 1);
            const index = Math.min(anim.points.length - 2, Math.floor(segment));
            const t = segment - index;
            const a = anim.points[index];
            const b = anim.points[index + 1];
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
        return graph.sites[army.province];
    }

    private drawArmyCounter(
        ctx: CanvasRenderingContext2D,
        army: Army,
        now: number,
        fighting: boolean,
        ox: number,
        oy: number,
    ): void {
        const state = this.engine.state;
        const pos = this.armyPosition(army, now);
        let x = pos.x;
        const y = pos.y;
        let scale = 1;
        for (const effect of this.fx) {
            if (effect.province !== army.province) continue;
            const p = (now - effect.start) / effect.dur;
            if (effect.kind === "recruit") scale = 1 + 0.35 * Math.sin(p * Math.PI);
            if (effect.kind === "combat") x += Math.sin(p * 55) * 3 * (1 - p);
        }

        const nation = state.nations[army.nation];
        const color = nation ? nation.color : NEUTRAL_COLOR;
        const w = 40 * scale;
        const h = 28 * scale;
        const count = army.regiments.length;
        const selected = state.selectedArmyId === army.id;

        ctx.save();
        ctx.globalAlpha = army.acted && !fighting ? 0.55 : 1;

        if (selected) {
            ctx.strokeStyle = "#e6edf3";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6, 7);
            ctx.stroke();
        }
        if (fighting) {
            ctx.strokeStyle = `rgba(248, 81, 73, ${0.5 + 0.5 * Math.abs(Math.sin(now / 200))})`;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.roundRect(x - w / 2 - 1.5, y - h / 2 - 1.5, w + 3, h + 3, 6);
            ctx.stroke();
        }

        ctx.fillStyle = color;
        ctx.strokeStyle = "rgba(13, 17, 23, 0.92)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h / 2, w, h, 5);
        ctx.fill();
        ctx.stroke();

        if (count > 1) {
            ctx.fillStyle = "rgba(13, 17, 23, 0.92)";
            ctx.strokeStyle = "rgba(230, 237, 243, 0.85)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x + w / 2 - 1, y - h / 2 - 1, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#e6edf3";
            ctx.font = "700 9px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(`×${count}`, x + w / 2 - 1, y - h / 2 + 2.2);
        }

        // Dominant regiment kind as the counter symbol.
        const kindCounts = new Map<UnitKind, number>();
        let hpTotal = 0;
        for (const regiment of army.regiments) {
            kindCounts.set(regiment.kind, (kindCounts.get(regiment.kind) ?? 0) + 1);
            hpTotal += regiment.hp;
        }
        let dominant: UnitKind = 0;
        let bestCount = -1;
        for (const [kind, n] of kindCounts) {
            if (n > bestCount) {
                bestCount = n;
                dominant = kind;
            }
        }
        ctx.strokeStyle = "#ffffff";
        ctx.fillStyle = "#ffffff";
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        const gy = y - 4;
        if (dominant === 0) {
            ctx.beginPath();
            ctx.moveTo(x - 7, gy - 5);
            ctx.lineTo(x + 7, gy + 5);
            ctx.moveTo(x + 7, gy - 5);
            ctx.lineTo(x - 7, gy + 5);
            ctx.stroke();
        } else if (dominant === 1) {
            ctx.beginPath();
            ctx.roundRect(x - 8, gy - 4.5, 16, 9, 4);
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(x, gy, 4.2, 0, Math.PI * 2);
            ctx.fill();
        }

        const orgRatio = Math.max(0, Math.min(1, army.org / 100));
        ctx.fillStyle = "rgba(13, 17, 23, 0.65)";
        ctx.fillRect(x - w / 2 + 4, y + h / 2 - 11, w - 8, 2.5);
        ctx.fillStyle = "#58a6ff";
        ctx.fillRect(x - w / 2 + 4, y + h / 2 - 11, (w - 8) * orgRatio, 2.5);

        const hpRatio = count > 0 ? hpTotal / count / MAX_HP : 0;
        ctx.fillStyle = "rgba(13, 17, 23, 0.65)";
        ctx.fillRect(x - w / 2 + 4, y + h / 2 - 6.5, w - 8, 3.5);
        ctx.fillStyle = hpRatio > 0.6 ? "#3fb950" : hpRatio > 0.3 ? "#d29922" : "#f85149";
        ctx.fillRect(x - w / 2 + 4, y + h / 2 - 6.5, (w - 8) * hpRatio, 3.5);

        const screenX = this.viewW / 2 + (x + ox - this.camera.x) * this.camera.zoom;
        const screenY = this.viewH / 2 + (y + oy - this.camera.y) * this.camera.zoom;
        this.counterHits.push({
            x: screenX - (w * this.camera.zoom) / 2,
            y: screenY - (h * this.camera.zoom) / 2,
            w: w * this.camera.zoom,
            h: h * this.camera.zoom,
            site: army.province,
            armyId: army.id,
            nation: army.nation,
        });

        ctx.restore();
    }

    private drawSnow(ctx: CanvasRenderingContext2D, now: number, dt: number): void {
        if (this.engine.state.seasonIndex !== 3 || this.reduceMotion) {
            this.flakes.length = 0;
            return;
        }
        if (this.flakes.length === 0) {
            for (let i = 0; i < 70; i++) {
                this.flakes.push({
                    x: Math.random() * this.viewW,
                    y: Math.random() * this.viewH,
                    r: 0.8 + Math.random() * 1.8,
                    vy: 0.35 + Math.random() * 0.8,
                    drift: 0.15 + Math.random() * 0.4,
                    phase: Math.random() * Math.PI * 2,
                });
            }
        }
        ctx.fillStyle = "#ffffff";
        for (const flake of this.flakes) {
            flake.y += (flake.vy * dt) / 16;
            flake.x += (Math.sin(now / 900 + flake.phase) * flake.drift * dt) / 16;
            if (flake.y > this.viewH + 4) {
                flake.y = -4;
                flake.x = Math.random() * this.viewW;
            }
            if (flake.x > this.viewW + 4) flake.x = -4;
            else if (flake.x < -4) flake.x = this.viewW + 4;
            ctx.globalAlpha = 0.25 + flake.r * 0.18;
            ctx.beginPath();
            ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    private drawMinimap(ctx: CanvasRenderingContext2D, minX: number, maxX: number, minY: number, maxY: number): void {
        const state = this.engine.state;
        const { width, height } = state.graph.domain;
        const mini = this.miniRect();

        ctx.save();
        ctx.globalAlpha = 0.94;
        ctx.fillStyle = "#161b22";
        ctx.strokeStyle = "#30363d";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(mini.x - 3, mini.y - 3, mini.w + 6, mini.h + 6, 8);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.roundRect(mini.x, mini.y, mini.w, mini.h, 5);
        ctx.clip();
        ctx.drawImage(this.base, mini.x, mini.y, mini.w, mini.h);

        const sx = mini.w / width;
        const sy = mini.h / height;
        for (const army of state.armies.values()) {
            const point = state.graph.sites[army.province];
            ctx.fillStyle = state.nations[army.nation]?.color ?? NEUTRAL_COLOR;
            ctx.fillRect(mini.x + point.x * sx - 1.5, mini.y + point.y * sy - 1.5, 3, 3);
        }

        ctx.strokeStyle = "#e6edf3";
        ctx.lineWidth = 1.4;
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const rx = mini.x + (minX + ox * width) * sx;
                const ry = mini.y + (minY + oy * height) * sy;
                const rw = (maxX - minX) * sx;
                const rh = (maxY - minY) * sy;
                if (rx + rw < mini.x || rx > mini.x + mini.w || ry + rh < mini.y || ry > mini.y + mini.h) continue;
                ctx.strokeRect(rx, ry, rw, rh);
            }
        }
        ctx.restore();
    }
}