import { cellFillColor, drawBiomes } from "../terrain/biome.ts";
import {
    drawWrappedLine,
    fillWrappedPolygon,
    periodicDelta,
    periodicDistanceSq,
} from "../terrain/voronoi/index.ts";
import type { Vec2 } from "../terrain/voronoi/index.ts";
import { claimableStateIds, isAtWar, stateSummary } from "../game/diplomacy.ts";
import { provinceResourceOutput, resourceYieldMultiplier } from "../game/economy.ts";
import { provincePopulationView } from "../game/stability.ts";
import { nationDisplayColor } from "../game/access.ts";
import { pathTo } from "../game/rules.ts";
import { BUILDING_PROFILES } from "../game/types/building.ts";
import { MAX_HP } from "../game/types/unit.ts";
import { NEUTRAL } from "../game/types/world.ts";
import type { Army } from "../game/types/organization.ts";
import type { BuildingKind } from "../game/types/building.ts";
import type { EngineEvent } from "../game/types/events.ts";
import type { Province } from "../game/types/entities.ts";
import type { UnitKind } from "../game/types/unit.ts";
import type { GameEngine } from "../game/engine.ts";
import { Camera } from "./camera.ts";
import { buildConstructionOverlay } from "./constructionOverlay.ts";
import type { ConstructionOverlay } from "./constructionOverlay.ts";
import { addWrappedPolygonPath, drawEdges } from "./geometry.ts";
import {
    drawClaimFocus,
    drawClaimLand,
    drawClaimablePulse,
    drawConstructionLand,
    drawNationHighlight,
} from "./overlays.ts";
import {
    drawProvinceCapacityMarkers,
    drawProvinceMarkers,
    drawRegionMarkers,
    drawResourceMarkers,
} from "./markers.ts";
import type { MarkerOptions } from "./markers.ts";
import { resourceTint } from "./resources.ts";
import { iconVersion } from "./icons.ts";
import type { ColorMode, MapMode, NationHighlight } from "./types.ts";
export type { MapMode } from "./types.ts";
import { drawTerrainDecorCell } from "./terrainDecor.ts";
import { BIOME_ZH, garrisonRelation, ownerName } from "../ui/common.ts";
import { chipToken, escapeGameText, peopleCount, textToken } from "../ui/text.ts";
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
    private nationHighlight: NationHighlight | null = null;
    private claimsOverlay = false;
    private claimableCache: number[] = [];
    private colorMode: ColorMode = "gradient";
    private deepZoom = 0.8;
    private colorLevel = "";
    private iconLoadVersion = -1;
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
    private minimapVisible = true;
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

    /** Read-only inputs handed to the marker helpers in markers.ts. */
    private get markerOptions(): MarkerOptions {
        return {
            mapMode: this.currentMapMode,
            constructionActive: this.constructionActive,
            constructionKind: this.currentConstructionKind,
            constructionOverlay: this.constructionOverlay,
            zoom: this.camera.zoom,
            resourceMode: this.colorMode === "resource",
        };
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
        if (!site) return;
        this.camera.centerOn(site.x, site.y);
        this.camera.zoom = Math.min(this.camera.maxZoom, Math.max(this.camera.zoom, 1.1));
    }

    /**
     * Briefing inspection: centre on the geometric heart of a nation's land —
     * the average of every owned province tile's centroid — rather than its
     * capital, so scattered or oddly shaped realms frame nicely. Points are
     * unwrapped against the first province so a nation straddling the map seam
     * still averages to a sane spot.
     */
    public centerOnNation(nationId: number): void {
        const { graph, terrain, provinces } = this.engine.state;
        let anchor: Vec2 | null = null;
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        for (const province of provinces) {
            if (province.owner !== nationId || !terrain.passable[province.site]) continue;
            const cell = graph.cells[province.site];
            const point = cell?.bounded ? cell.centroid : graph.sites[province.site];
            if (!point) continue;
            if (anchor === null) anchor = point;
            const delta = periodicDelta(anchor, point, graph.domain);
            sumX += delta.x;
            sumY += delta.y;
            count++;
        }
        if (anchor === null) return;
        this.resetMapTooltip();
        this.camera.centerOn(anchor.x + sumX / count, anchor.y + sumY / count);
        this.camera.zoom = Math.min(this.camera.maxZoom, Math.max(this.camera.zoom, 1.1));
    }

    public setClaimFocus(stateId: number | null): void {
        this.claimFocus = stateId;
    }

    /** Briefing preview: tint and outline every province of one nation (null clears it). */
    public setNationHighlight(nationId: number | null): void {
        if (nationId === null) {
            this.nationHighlight = null;
            return;
        }
        const { graph, terrain, provinces } = this.engine.state;
        const nation = this.engine.state.nations[nationId];
        if (!nation) {
            this.nationHighlight = null;
            return;
        }
        const sites: number[] = [];
        const segments: [Vec2, Vec2][] = [];
        for (const province of provinces) {
            if (province.owner !== nationId || !terrain.passable[province.site]) continue;
            sites.push(province.site);
            const cell = graph.cells[province.site];
            if (!cell.bounded) continue;
            for (let k = 0; k < cell.neighbors.length; k++) {
                const neighbor = provinces[cell.neighbors[k]];
                if (neighbor && neighbor.owner === nationId) continue;
                segments.push([cell.polygon[k], cell.polygon[(k + 1) % cell.polygon.length]]);
            }
        }
        this.nationHighlight = { color: nationDisplayColor(this.engine.state, nationId), sites, segments };
    }

    public getColorMode(): ColorMode {
        return this.colorMode;
    }

    public getDeepZoom(): number {
        return this.deepZoom;
    }

    public setColorMode(mode: ColorMode): void {
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
            if (mode === "uniform" || mode === "gradient" || mode === "resource") this.colorMode = mode;
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

    /** Pre-game briefing hides the minimap and its hit area. */
    public setMinimapVisible(visible: boolean): void {
        this.minimapVisible = visible;
        this.miniDrag = false;
    }

    public centerOnSite(site: number): void {
        this.resetMapTooltip();
        const point = this.engine.state.graph.sites[site];
        this.camera.centerOn(point.x, point.y);
        this.camera.zoom = Math.min(this.camera.maxZoom, Math.max(this.camera.minZoom, this.camera.zoom, 1.4));
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
        } else {
            // A resized window changes the zoom ceiling; pull the camera back under it.
            this.camera.setViewport(this.viewW, this.viewH);
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
        if (this.minimapVisible && sx >= mini.x && sx <= mini.x + mini.w && sy >= mini.y && sy <= mini.y + mini.h) {
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
        if (event.buttons || (this.minimapVisible && sx >= mini.x && sx <= mini.x + mini.w && sy >= mini.y && sy <= mini.y + mini.h)) {
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
                ? ids.map((id) => chipToken(nationDisplayColor(state, id), state.nations[id].name)).join(" ")
                : "无";
            const control = summary.control.length
                ? summary.control.map((entry) => `${chipToken(nationDisplayColor(state, entry.nation), state.nations[entry.nation].name)} ${entry.percent}%`).join(" / ")
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
        const output = provinceResourceOutput(state, province);
        const population = provincePopulationView(state, province);
        const fmt = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);
        const resourceLines = [
            `${textToken("raw")} ${province.deposits.raw} 级 · ${textToken("raw", fmt(output.raw))}/[[turn]]`,
            `${textToken("strategic")} ${province.deposits.strategic} 级 · ${textToken("strategic", fmt(output.strategic))}/[[turn]]`,
            `${textToken("food")} ${textToken("food", fmt(output.food + output.farmFood))}/[[turn]]`,
            `矿产系数：有效[[infrastructure]] ${output.infrastructure} 级 ×${resourceYieldMultiplier(output.infrastructure).toFixed(2)}；[[occupation]] ×${output.occupation.toFixed(2)}`,
        ].join("\n");
        const body = `所属州：${escapeGameText(region?.name ?? "未属州")}\n控制国：${escapeGameText(ownerName(state, province.owner))}\n正式归属：${escapeGameText(ownerName(state, province.legalOwner))}\n地形：${escapeGameText(BIOME_ZH[state.terrain.biomeAt(province.site)])}\n${textToken(relation)}驻军 ${Math.round(province.garrison)}/${province.garrisonMax}\n${textToken("manpower")} 全部人口 ${peopleCount(population.people)}（可招募 ${peopleCount(population.eligible)}）\n资源产出：\n${resourceLines}`;
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
            case "relations": {
                // Vassal colours and the nation list changed; terrain/name cache must be repainted.
                this.baseDirty = true;
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
                this.fx.push({ kind: "capture", province: event.province, start: now, dur: 650, color: nationDisplayColor(this.engine.state, event.nationId) });
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
    /** The first build has no previous frame to show, so spend the frame and avoid a long blank map. */
    private static readonly FIRST_BASE_BUDGET_MS = 14;
    /** Always make some progress even when the frame budget is eaten by load; keeps rebuilds deterministic. */
    private static readonly MIN_BASE_STEPS = 8;
    private static readonly CELL_CHUNK = 24;
    private static readonly PROVINCE_CHUNK = 32;
    private baseReady = false;

    private beginBaseRebuild(): void {
        this.baseDirty = false;
        this.dirtySites.clear();
        this.baseBuild = this.rebuildBaseSteps(this.spareCtx);
    }

    /** Advance the staged rebuild within a frame budget; swap buffers only when complete. */
    private advanceBaseRebuild(): void {
        if (!this.baseBuild) return;
        const budget = this.baseReady ? MapRenderer.BASE_BUDGET_MS : MapRenderer.FIRST_BASE_BUDGET_MS;
        const deadline = performance.now() + budget;
        let steps = 0;
        do {
            steps++;
            if (this.baseBuild.next().done) {
                this.baseBuild = null;
                const base = this.base;
                this.base = this.spare;
                this.spare = base;
                const ctx = this.baseCtx;
                this.baseCtx = this.spareCtx;
                this.spareCtx = ctx;
                this.frontlineDirty = true;
                this.baseReady = true;
                return;
            }
        } while (steps < MapRenderer.MIN_BASE_STEPS || performance.now() < deadline);
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
            drawClaimLand(ctx, this.engine.state);
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

        drawConstructionLand(ctx, this.engine.state, this.constructionActive ? this.constructionOverlay : null);
        yield;
        drawEdges(ctx, this.engine.state, provinces.map((province) => province.site),
            this.currentMapMode, this.colorMode === "gradient" && this.camera.zoom > this.deepZoom);
        yield;
        for (let from = 0; from < provinces.length; from += MapRenderer.PROVINCE_CHUNK) {
            const to = Math.min(provinces.length, from + MapRenderer.PROVINCE_CHUNK);
            for (let i = from; i < to; i++) {
                drawProvinceMarkers(ctx, this.engine.state, provinces[i].site, this.markerOptions);
                drawResourceMarkers(ctx, this.engine.state, provinces[i].site, this.markerOptions);
            }
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
        if (this.colorMode === "resource") {
            const tint = resourceTint(this.engine.state, province);
            ctx.globalAlpha = tint.alpha + 0.1;
            ctx.fillStyle = tint.color;
        } else {
            ctx.globalAlpha = 1;
            ctx.fillStyle = this.stateColor(owner, province.stateId, this.landFactor());
        }
        fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
        ctx.globalAlpha = 1;
        if (!occupied) return;
        ctx.save();
        ctx.beginPath();
        addWrappedPolygonPath(ctx, cell.polygon, width, height);
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
        const { graph, terrain } = this.engine.state;
        const { width, height } = graph.domain;
        if (!terrain.passable[province.site]) return;
        const cell = graph.cells[province.site];
        if (!cell.bounded) return;
        if (this.colorMode === "resource") {
            const tint = resourceTint(this.engine.state, province);
            ctx.globalAlpha = tint.alpha;
            ctx.fillStyle = tint.color;
        } else {
            if (province.owner === NEUTRAL) return;
            ctx.globalAlpha = this.tintAlpha();
            ctx.fillStyle = nationDisplayColor(this.engine.state, province.owner);
        }
        fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
    }

    private stateColor(owner: number, stateId: number, factor = 1): string {
        const color = nationDisplayColor(this.engine.state, owner);
        const rgb = Number.parseInt(color.slice(1), 16);
        const shade = (((stateId + 1) * 37) % 11 - 5) * 0.022;
        const channel = (shift: number): number => {
            const value = (rgb >> shift) & 255;
            const shaded = shade > 0 ? value + (255 - value) * shade : value * (1 + shade);
            return Math.round(shaded * factor);
        };
        return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
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
        const { graph, terrain, provinces } = this.engine.state;
        const { width, height } = graph.domain;
        const ctx = this.baseCtx;
        const sites = [...this.dirtySites];
        this.dirtySites.clear();

        ctx.save();
        ctx.beginPath();
        for (const site of sites) {
            const cell = graph.cells[site];
            if (cell.bounded) addWrappedPolygonPath(ctx, cell.polygon, width, height);
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
        for (const site of sites) this.paintProvinceTint(ctx, provinces[site]);
        ctx.globalAlpha = 1;

        drawEdges(ctx, this.engine.state, sites,
            this.currentMapMode, this.colorMode === "gradient" && this.camera.zoom > this.deepZoom);
        // A marker in a clean neighbor may extend into the clipped dirty area.
        for (const province of provinces) {
            drawProvinceMarkers(ctx, this.engine.state, province.site, this.markerOptions);
            drawResourceMarkers(ctx, this.engine.state, province.site, this.markerOptions);
        }
        ctx.restore();
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
        // Marker icons load asynchronously; repaint once when the artwork arrives.
        if (this.iconLoadVersion !== iconVersion()) {
            this.iconLoadVersion = iconVersion();
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
            if (this.nationHighlight) {
                drawNationHighlight(ctx, this.engine.state, now, this.nationHighlight, this.reduceMotion);
            }
            if (this.claimsOverlay && this.currentMapMode === "state" && this.claimableCache.length > 0) {
                drawClaimablePulse(ctx, this.engine.state, now, this.claimableCache, this.reduceMotion);
            }
            drawClaimFocus(ctx, this.engine.state, this.claimFocus, this.currentMapMode);
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

        drawRegionMarkers(ctx, this.engine.state, this.markerOptions, minX, maxX, minY, maxY);
        drawProvinceCapacityMarkers(ctx, this.engine.state, this.markerOptions, minX, maxX, minY, maxY);

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

        const color = nationDisplayColor(state, army.nation);
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
        if (!this.minimapVisible) return;
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
            ctx.fillStyle = nationDisplayColor(state, army.nation);
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