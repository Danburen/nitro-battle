import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { GameEngine } from "../game/engine.ts";
import { processConstruction } from "../game/production.ts";
import { BUILDING_PROFILES, DEFAULT_POLICIES, STATE_BUILDING_KINDS } from "../game/types.ts";
import type { BuildingKind, GameState, Province, StateRegion } from "../game/types.ts";
import { Biome, BiomeMap } from "../terrain/biome.ts";
import { buildConstructionOverlay, constructionColor, CONSTRUCTION_COLORS, PROVINCE_CAPACITY_MIN_ZOOM } from "../render/constructionOverlay.ts";
import { MapRenderer } from "../render/renderer.ts";
import { GameUI } from "../ui/index.ts";
import { renderGameText } from "../ui/text.ts";
import { GlobalTooltip, MAP_TOOLTIP_EVENT } from "../ui/tooltip.ts";
import type { MapTooltipRequest } from "../ui/tooltip.ts";
import { IntelPanel } from "../ui/panels/intel.ts";

function fixture(): GameState {
    const provinces: Province[] = [];
    const states: StateRegion[] = [];
    for (const owner of [0, 1, 0]) {
        const id = states.length;
        const center = provinces.length;
        const members: number[] = [];
        for (let i = 0; i < 4; i++) {
            const site = provinces.length;
            members.push(site);
            provinces.push({
                site, stateId: id, name: `P${site}`, owner, legalOwner: owner, isCity: i === 0, isCapital: i === 0,
                garrison: 0, garrisonMax: 0, income: 4, defense: 1, population: 2,
                coreNation: owner, occupation: 100, buildings: [],
            });
        }
        states.push({ id, name: `S${id}`, center, provinces: members, culture: 0,
            buildings: [], factories: 0, prodFactories: 0, infrastructure: 0 });
    }
    const count = provinces.length;
    const domain = { width: count * 100, height: 600, periodicX: true, periodicY: true };
    const sites = provinces.map((p) => ({ id: p.site, x: p.site * 100 + 50, y: 200 }));
    const graph: GameState["graph"] = {
        domain, sites, mesh: { domain, points: sites, triangles: new Int32Array(), halfedges: new Int32Array() },
        vertices: [], edges: [], adjacency: sites.map(() => []), cellCost: sites.map(() => 1),
        cells: sites.map((point) => ({
            site: point.id, centroid: point, bounded: true, area: 8000, edges: [], neighbors: [],
            polygon: [{ x: point.x - 40, y: 150 }, { x: point.x + 40, y: 150 },
                { x: point.x + 40, y: 250 }, { x: point.x - 40, y: 250 }],
        })),
    };
    const terrain = new BiomeMap(count);
    terrain.passable.fill(1);
    terrain.terrainCost.fill(1);
    terrain.biome.fill(Biome.PLAINS);
    return {
        settings: { seed: 42, mapSize: "small", nationCount: 2 }, graph, terrain, provinces, states,
        nations: [0, 1].map((id) => ({ id, name: `N${id}`, color: id === 0 ? "#1f6feb" : "#da3633",
            isPlayer: id === 0, capital: id * 4, alive: true, funds: 10000, industry: 10000,
            manpower: 10000, politicalPower: 20, policies: { ...DEFAULT_POLICIES } })),
        armies: new Map(), armyAt: Array(count).fill(null), battles: [], deployments: [], construction: [],
        supply: null, supplyDirty: true, day: 1, seasonIndex: 0, selected: null, selectedArmyId: null,
        redeployArmyId: null, war: [[false, false], [false, false]], warSince: [[-1, -1], [-1, -1]],
        peaceOffers: [], truce: [[-1, -1], [-1, -1]], peaceCooldown: [-1, -1], log: [], winner: null,
        claims: [], diplomaticActions: [], wars: [], nextDiplomaticActionId: 1,
        nextArmyId: 1, nextRegimentId: 1, nextDeploymentId: 1, nextConstructionId: 1,
        stats: { battles: 0, captures: 0, recruited: 0, losses: 0 },
    };
}

function order(state: GameState, kind: BuildingKind, site = 0, nation = 0): void {
    state.construction.push({ id: state.nextConstructionId++, nation, site, kind,
        remainingPoints: BUILDING_PROFILES[kind].constructionPoints,
        paidFunds: BUILDING_PROFILES[kind].costFunds, paidIndustry: BUILDING_PROFILES[kind].costIndustry });
}

test("empty, low, high and full capacities have distinct prescribed colors", () => {
    assert.deepEqual(CONSTRUCTION_COLORS, { empty: "#d9e8c0", low: "#a8c887", high: "#628451", full: "#263849" });
    assert.deepEqual([0, 1, 2, 4].map((used) => constructionColor(used, 4)), Object.values(CONSTRUCTION_COLORS));
    assert.equal(new Set(Object.values(CONSTRUCTION_COLORS)).size, 4);
    assert.equal(constructionColor(3, 4), CONSTRUCTION_COLORS.high);
    assert.equal(constructionColor(5, 4), CONSTRUCTION_COLORS.full);
    assert.equal(constructionColor(0, 0), CONSTRUCTION_COLORS.full);
});

for (const kind of STATE_BUILDING_KINDS) {
    test(`${kind} includes built and pending at its independent cap without mutation`, () => {
        const state = fixture();
        const region = state.states[0];
        const limit = kind === "infrastructure" ? 8 : kind === "admin" ? 1 : 4;
        const built = kind === "admin" ? 0 : 1;
        if (kind === "factory") region.factories = built;
        else if (kind === "infrastructure") region.infrastructure = built;
        else if (kind === "farm") region.buildings.push("farm");
        for (let i = built; i < limit; i++) order(state, kind);
        state.nations[0].funds = state.nations[0].industry = 0;
        const before = JSON.stringify(state);
        const overlay = buildConstructionOverlay(state, kind);
        assert.equal(JSON.stringify(state), before);
        assert.equal(overlay.scope, "state");
        assert.deepEqual(overlay.areas.map((entry) => entry.id), [0, 2]);
        const entry = overlay.areas[0];
        assert.deepEqual([entry.built, entry.pending, entry.used, entry.limit], [built, limit - built, limit, limit]);
        assert.equal(entry.color, CONSTRUCTION_COLORS.full);
        assert.equal(overlay.areas[1].color, CONSTRUCTION_COLORS.empty);
        state.construction.length = 0;
        if (kind === "factory") region.factories = limit;
        else if (kind === "infrastructure") region.infrastructure = limit;
        else region.buildings = Array.from({ length: limit }, () => kind);
        assert.equal(buildConstructionOverlay(state, kind).areas[0].color, CONSTRUCTION_COLORS.full);
    });
}

test("only controlled passable centers and player-owned passable members are colored", () => {
    const state = fixture();
    state.provinces[1].owner = 1;
    state.terrain.passable[2] = 0;
    state.provinces[5].owner = 0;
    state.terrain.passable[8] = 0;
    const overlay = buildConstructionOverlay(state, "farm");
    assert.equal(overlay.areas.length, 1);
    assert.equal(overlay.areas[0].center, 0);
    assert.deepEqual(overlay.areas[0].sites, [0, 3]);
    assert.equal(overlay.areas[0].limit, 4);
    state.provinces[0].owner = -1;
    assert.deepEqual(buildConstructionOverlay(state, "farm").areas, []);
});

test("local orders and wrong centers/kinds cannot consume state capacity", () => {
    const state = fixture();
    order(state, "supply");
    order(state, "fort");
    order(state, "farm", 1);
    order(state, "farm", 4, 1);
    order(state, "factory");
    order(state, "farm");
    order(state, "farm", 0, 1);
    const entry = buildConstructionOverlay(state, "farm").areas[0];
    assert.deepEqual([entry.built, entry.pending, entry.used, entry.limit], [0, 2, 2, 4]);
    assert.equal(entry.color, CONSTRUCTION_COLORS.high);
});

test("signature ignores selection, production allocation, progress, queue order and foreign counts", () => {
    const state = fixture();
    order(state, "farm");
    order(state, "factory");
    const before = buildConstructionOverlay(state, "farm").signature;
    state.selected = 1;
    state.states[0].prodFactories = 1;
    state.states[1].buildings.push("farm");
    state.construction[0].remainingPoints = 0.5;
    state.construction.reverse();
    assert.equal(buildConstructionOverlay(state, "farm").signature, before);
    state.construction.splice(state.construction.findIndex((entry) => entry.kind === "farm"), 1);
    assert.notEqual(buildConstructionOverlay(state, "farm").signature, before);
    order(state, "farm");
    assert.equal(buildConstructionOverlay(state, "farm").signature, before);
    state.provinces[1].owner = 1;
    assert.notEqual(buildConstructionOverlay(state, "farm").signature, before);
});

for (const kind of ["supply", "fort"] as const) {
    test(`${kind} has independent built/pending province capacity regardless of treasury`, () => {
        const state = fixture();
        const other = kind === "supply" ? "fort" : "supply";
        state.provinces[0].buildings.push(kind);
        state.provinces[1].buildings.push(other);
        order(state, kind, 2);
        order(state, other, 3);
        order(state, "farm");
        const before = JSON.stringify(state);
        const overlay = buildConstructionOverlay(state, kind);
        assert.equal(JSON.stringify(state), before);
        assert.equal(overlay.scope, "province");
        assert.deepEqual(overlay.areas.map((area) => area.id), [0, 1, 2, 3, 8, 9, 10, 11]);
        assert.deepEqual(overlay.areas.slice(0, 4).map((area) =>
            [area.built, area.pending, area.used, area.limit, area.color]), [
            [1, 0, 1, 1, CONSTRUCTION_COLORS.full],
            [0, 0, 0, 1, CONSTRUCTION_COLORS.empty],
            [0, 1, 1, 1, CONSTRUCTION_COLORS.full],
            [0, 0, 0, 1, CONSTRUCTION_COLORS.empty],
        ]);
        for (const area of overlay.areas) {
            assert.equal(area.center, area.id);
            assert.equal(area.name, state.provinces[area.id].name);
            assert.deepEqual(area.sites, [area.id]);
        }
        state.nations[0].funds = state.nations[0].industry = 0;
        state.selected = 2;
        state.states[0].factories++;
        state.construction[0].remainingPoints = 0.1;
        state.construction.reverse();
        state.provinces[4].buildings.push(kind);
        assert.deepEqual(buildConstructionOverlay(state, kind), overlay);
        assert.notEqual(buildConstructionOverlay(state, other).signature, overlay.signature);
        state.construction.splice(state.construction.findIndex((entry) => entry.site === 2), 1);
        assert.notEqual(buildConstructionOverlay(state, kind).signature, overlay.signature);
    });

    test(`${kind} excludes enemy, neutral and water but ignores state-center ownership`, () => {
        const state = fixture();
        state.provinces[1].owner = 1;
        state.terrain.passable[2] = 0;
        state.provinces[3].owner = -1;
        state.provinces[5].owner = 0;
        state.terrain.passable[8] = 0;
        const overlay = buildConstructionOverlay(state, kind);
        assert.deepEqual(overlay.areas.map((area) => area.id), [0, 5, 9, 10, 11]);
        const engine = new GameEngine(state);
        for (const site of [1, 2, 3, 4, 8]) assert.equal(engine.queueProvinceBuild(site, kind), false);
        assert.equal(engine.queueProvinceBuild(5, kind), true);
        assert.equal(engine.queueProvinceBuild(5, kind), false);
        const queued = buildConstructionOverlay(state, kind);
        assert.equal(queued.areas.find((area) => area.id === 5)?.color, CONSTRUCTION_COLORS.full);
        state.provinces[4].owner = -1;
        const changedCenter = buildConstructionOverlay(state, kind);
        assert.deepEqual(changedCenter.areas, queued.areas);
        assert.notEqual(changedCenter.signature, queued.signature);
    });
}

function harness(t: TestContext, state = fixture()) {
    const labels: { text: string; color: string; font: string; x: number; y: number; scale: number }[] = [];
    const fills: string[] = [];
    const fillDetails: { color: string; alpha: number; points: { x: number; y: number }[] }[] = [];
    const strokes: { color: string; alpha: number; width: number; dash: number[]; points: { x: number; y: number }[] }[] = [];
    let points: { x: number; y: number }[] = [];
    let transform = { sx: 1, sy: 1, x: 0, y: 0 };
    const stack: { properties: Record<string, unknown>; transform: typeof transform }[] = [];
    let clears = 0;
    const properties: Record<string, unknown> = {
        globalAlpha: 1,
        save: () => stack.push({ properties: { ...properties }, transform: { ...transform } }),
        restore: () => {
            const saved = stack.pop()!;
            Object.assign(properties, saved.properties);
            transform = saved.transform;
        },
        setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
            assert.equal(b, 0);
            assert.equal(c, 0);
            transform = { sx: a, sy: d, x: e, y: f };
        },
        translate: (x: number, y: number) => {
            transform.x += transform.sx * x;
            transform.y += transform.sy * y;
        },
        scale: (x: number, y: number) => { transform.sx *= x; transform.sy *= y; },
        beginPath: () => { points = []; },
        moveTo: (x: number, y: number) => points.push({ x, y }),
        lineTo: (x: number, y: number) => points.push({ x, y }),
        measureText: (text: string) => ({ width: text.length * 8 }),
        fillText: (text: string, x: number, y: number) => labels.push({
            text, color: properties.fillStyle as string, font: properties.font as string, scale: transform.sy,
            x: transform.x + transform.sx * x, y: transform.y + transform.sy * y,
        }),
        fill: () => {
            fills.push(properties.fillStyle as string);
            fillDetails.push({ color: properties.fillStyle as string, alpha: properties.globalAlpha as number, points: [...points] });
        },
        setLineDash: (dash: number[]) => { properties.lineDash = [...dash]; },
        stroke: () => strokes.push({
            color: properties.strokeStyle as string, alpha: properties.globalAlpha as number,
            width: properties.lineWidth as number, dash: [...((properties.lineDash as number[]) ?? [])], points: [...points],
        }),
        clearRect: () => { clears++; },
    };
    const ctx = new Proxy(properties, {
        get: (target, key) => target[key as string] ?? (() => {}),
    }) as unknown as CanvasRenderingContext2D;
    type TestEvent = { type: string } & Record<string, unknown>;
    type Listener = (event: TestEvent) => void;
    const eventHub = () => {
        const handlers = new Map<string, Set<Listener>>();
        return {
            handlers,
            addEventListener(name: string, fn: Listener) {
                if (!handlers.has(name)) handlers.set(name, new Set());
                handlers.get(name)!.add(fn);
            },
            removeEventListener(name: string, fn: Listener) { handlers.get(name)?.delete(fn); },
            dispatchEvent(event: TestEvent) {
                for (const fn of handlers.get(event.type) ?? []) fn(event);
                return true;
            },
        };
    };
    let layoutReads = 0;
    let textWrites = 0;
    class TestElement {
        id = "";
        hidden = true;
        isConnected = true;
        dataset: Record<string, string> = {};
        style: Record<string, string> = {};
        attributes = new Map<string, string>();
        children = new Map<string, TestElement>();
        scrollTop = 0;
        private html = "";
        get innerHTML() { return this.html; }
        set innerHTML(value: string) { this.html = value; textWrites++; }
        get offsetWidth() { layoutReads++; return 320; }
        get offsetHeight() { layoutReads++; return 150; }
        getClientRects() { layoutReads++; return this.isConnected ? [{}] : []; }
        getBoundingClientRect() { layoutReads++; return { left: 0, top: 0, right: 800, width: 800, height: 600 }; }
        getAttribute(name: string) { return this.attributes.get(name) ?? null; }
        setAttribute(name: string, value: string) { this.attributes.set(name, value); }
        removeAttribute(name: string) { this.attributes.delete(name); }
        hasAttribute(name: string) { return this.attributes.has(name); }
        querySelector(selector: string) { return this.children.get(selector) ?? null; }
        contains(node: unknown) { return node === this; }
        closest() { return this.dataset.tooltipTitle || this.dataset.tooltipBody || this.hasAttribute("title") ? this : null; }
    }
    const canvasEvents = eventHub();
    class TestCanvas extends TestElement {
        width = 0;
        height = 0;
        getContext() { return ctx; }
        addEventListener = canvasEvents.addEventListener;
        removeEventListener = canvasEvents.removeEventListener;
        setPointerCapture() {}
        releasePointerCapture() {}
    }
    const canvasElement = new TestCanvas();
    const canvas = canvasElement as unknown as HTMLCanvasElement;
    const tooltipEl = new TestElement();
    tooltipEl.id = "global-tooltip";
    const tooltipTitle = new TestElement();
    const tooltipBody = new TestElement();
    tooltipEl.children.set("strong", tooltipTitle);
    tooltipEl.children.set("p", tooltipBody);
    const hudAnchor = new TestElement();
    hudAnchor.dataset.tooltipTitle = "HUD [[supply]]";
    hudAnchor.dataset.tooltipBody = "HUD details";
    const intelEl = new TestElement();
    intelEl.children.set(".panel-body", new TestElement());
    const documentEvents = eventHub();
    const windowEvents = eventHub();
    const mapRequests: MapTooltipRequest[] = [];
    documentEvents.addEventListener(MAP_TOOLTIP_EVENT, (event) => mapRequests.push(event.detail as MapTooltipRequest));
    let pointTarget: TestElement | null = canvasElement;
    let frame: FrameRequestCallback;
    let resize: () => void;
    const globals: Record<string, unknown> = {
        matchMedia: () => ({ matches: true }),
        Element: TestElement, HTMLElement: TestElement, HTMLCanvasElement: TestCanvas, Node: TestElement,
        window: { ...windowEvents, devicePixelRatio: 1, innerWidth: 800, innerHeight: 600 },
        document: { ...documentEvents,
            activeElement: null,
            createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
            querySelector: (selector: string) => selector === "#global-tooltip" ? tooltipEl : selector === "#intel-panel" ? intelEl : null,
            elementFromPoint: () => pointTarget,
        },
        ResizeObserver: class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} },
        requestAnimationFrame: (callback: FrameRequestCallback) => { frame = callback; return 1; },
        cancelAnimationFrame: () => {},
    };
    const restoreGlobals: (() => void)[] = [];
    for (const [key, value] of Object.entries(globals)) {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
        restoreGlobals.push(() => {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        });
    }
    const engine = new GameEngine(state);
    const clicks: number[] = [];
    const renderer = new MapRenderer(canvas, engine, (site) => clicks.push(site));
    const tooltip = new GlobalTooltip();
    t.after(() => {
        tooltip.destroy();
        renderer.destroy();
        documentEvents.removeEventListener(MAP_TOOLTIP_EVENT, [...documentEvents.handlers.get(MAP_TOOLTIP_EVENT)!][0]);
        assert.ok([...documentEvents.handlers.values()].every((listeners) => listeners.size === 0), "document listeners are removed");
        assert.ok([...windowEvents.handlers.values()].every((listeners) => listeners.size === 0), "window listeners are removed");
        assert.ok([...canvasEvents.handlers.values()].every((listeners) => listeners.size === 0), "canvas listeners are removed");
        for (const restore of restoreGlobals) restore();
    });
    renderer.setMapMode("state");
    let now = 0;
    const fireCanvas = (type: string, data: Record<string, unknown> = {}) => {
        pointTarget = canvasElement;
        const event = { type, target: canvas, clientX: 400, clientY: 300, button: 0, buttons: 0, pointerId: 1, preventDefault() {}, ...data };
        canvasEvents.dispatchEvent(event);
        documentEvents.dispatchEvent(event);
    };
    return {
        state, engine, renderer, labels, fills, fillDetails, strokes, clicks, tooltip, tooltipEl, tooltipTitle, tooltipBody, intelEl,
        canvas, hudAnchor, mapRequests, documentEvents, windowEvents, fireCanvas,
        get clears() { return clears; },
        get layoutReads() { return layoutReads; },
        get textWrites() { return textWrites; },
        resize: () => resize!(),
        coverCanvas: () => { pointTarget = hudAnchor; },
        documentEvent: (type: string, data: Record<string, unknown> = {}) => {
            pointTarget = hudAnchor;
            documentEvents.dispatchEvent({ type, target: hudAnchor, clientX: 400, clientY: 300, buttons: 0, ...data });
        },
        tick: (elapsed = 16) => { labels.length = 0; fills.length = 0; fillDetails.length = 0; strokes.length = 0; frame!(now += elapsed); },
        hover: (x = 400, y = 300) => fireCanvas("pointermove", { clientX: x, clientY: y }),
        click: (x: number, y: number, button = 0) => {
            fireCanvas("pointerdown", { clientX: x, clientY: y, button, buttons: 1 });
            fireCanvas("pointerup", { clientX: x, clientY: y, button });
        },
    };
}

test("renderer caches fills, refreshes queues/completions/capture, and keeps labels coherent", (t) => {
    const h = harness(t);
    h.state.states[0].factories = 3;
    h.state.provinces[0].buildings.push("fort");
    h.state.provinces[1].owner = 1;
    h.state.provinces[5].owner = 0;
    h.state.terrain.passable[2] = 0;
    h.renderer.setConstructionView("farm");
    h.tick();
    assert.equal(h.clears, 1);
    assert.equal(h.fills.filter((color) => color === CONSTRUCTION_COLORS.empty).length, 6);
    assert.ok(h.labels.some((label) => label.text === `${BUILDING_PROFILES.farm.glyph} 0/4` && label.font.includes("17px")));
    assert.ok(!h.labels.some((label) => label.text === "S1" || label.text.includes(" · ") || label.text === BUILDING_PROFILES.fort.glyph));
    h.engine.select(2);
    h.engine.setFactoryProduction(2);
    h.tick();
    assert.equal(h.clears, 1);
    assert.ok(h.engine.queueBuild(0, "farm"));
    assert.ok(h.engine.queueBuild(0, "farm"));
    h.tick();
    assert.equal(h.clears, 2);
    assert.ok(h.fills.includes(CONSTRUCTION_COLORS.high));
    assert.ok(h.labels.some((label) => label.text === `${BUILDING_PROFILES.farm.glyph} 2/4`));
    const firstId = h.state.construction[0].id;
    assert.ok(h.engine.reorderConstruction(firstId, null));
    h.tick();
    assert.equal(h.clears, 2);
    assert.ok(h.engine.cancelBuild(firstId));
    h.tick();
    assert.equal(h.clears, 3);
    assert.ok(h.fills.includes(CONSTRUCTION_COLORS.low));
    h.state.construction[0].remainingPoints = 0.01;
    processConstruction(h.engine);
    h.tick();
    assert.equal(h.clears, 4);
    assert.ok(h.labels.some((label) => label.text === `${BUILDING_PROFILES.farm.glyph} 1/4`));
    h.engine.emit({ type: "state" });
    h.state.provinces[0].owner = 1;
    h.tick();
    assert.equal(h.clears, 5);
    assert.ok(!h.labels.some((label) => label.text === "S0"));
    h.state.provinces[0].owner = 0;
    h.state.states[0].buildings.push("farm", "farm", "farm");
    h.engine.emit({ type: "capture", province: 0, nationId: 0, eliminated: null });
    h.tick();
    assert.equal(h.clears, 6);
    assert.ok(h.fills.includes(CONSTRUCTION_COLORS.full));
    assert.ok(h.labels.some((label) => label.text === `${BUILDING_PROFILES.farm.glyph} 4/4 已满`));
    h.tick();
    assert.equal(h.clears, 6);
    assert.ok(!h.fills.includes(CONSTRUCTION_COLORS.full));
});

test("toggles preserve camera/selection, province labels stay hidden, and counters cannot intercept construction", (t) => {
    const h = harness(t);
    h.state.armies.set(1, { id: 1, nation: 0, name: "Army", province: 0,
        regiments: [{ id: 1, kind: 0, hp: 10 }], org: 80, moved: false, acted: false, march: null });
    h.state.armyAt[0] = 1;
    h.engine.select(3);
    h.renderer.camera.centerOn(50, 200);
    h.renderer.camera.zoom = 1;
    const camera = { ...h.renderer.camera };
    h.renderer.setConstructionView("admin");
    h.tick();
    assert.equal(h.renderer.constructionKind, "admin");
    assert.deepEqual({ ...h.renderer.camera }, camera);
    assert.equal(h.state.selected, 3);
    h.click(400, 300);
    assert.deepEqual(h.clicks, [0]);
    assert.equal(h.state.selectedArmyId, null);
    h.click(400, 300, 2);
    assert.deepEqual(h.clicks, [0, -1]);
    h.renderer.setConstructionView(null);
    h.tick();
    assert.ok(h.labels.some((label) => label.text.includes(" · ")));
    assert.equal(h.state.selected, 3);
    assert.deepEqual({ ...h.renderer.camera }, camera);
    h.click(400, 300);
    assert.equal(h.state.selectedArmyId, null);
    assert.deepEqual(h.clicks, [0, -1, 0]);
    h.renderer.setMapMode("province");
    h.renderer.setConstructionView("farm");
    h.engine.select(3);
    h.tick();
    assert.ok(!h.labels.some((label) => /^S\d$/.test(label.text) || label.text.includes(" · ") || label.text.includes("/4")));
    assert.ok(!h.fills.some((color) => Object.values(CONSTRUCTION_COLORS).includes(color as never)));
    h.click(400, 300);
    assert.equal(h.state.selectedArmyId, 1);
});

for (const kind of ["supply", "fort"] as const) {
    test(`${kind} renderer refreshes queues, cancellations, completions and captures without losing fills`, (t) => {
        const h = harness(t);
        h.state.states[0].factories = 3;
        h.state.provinces[1].owner = 1;
        h.state.terrain.passable[2] = 0;
        h.state.provinces[3].owner = -1;
        h.state.provinces[5].owner = 0;
        h.state.terrain.passable[8] = 0;
        h.renderer.setMapMode("province");
        h.renderer.camera.centerOn(50, 200);
        h.renderer.camera.zoom = 2;
        h.renderer.setConstructionView(kind);
        h.tick();
        let rebuilds = 1;
        assert.equal(h.clears, rebuilds);
        const painted = h.fillDetails.filter((fill) => fill.color === CONSTRUCTION_COLORS.empty);
        assert.deepEqual(painted.map((fill) => fill.points), [0, 5, 9, 10, 11].map((site) => h.state.graph.cells[site].polygon));
        assert.ok(painted.every((fill) => fill.alpha === 1));
        // Ineligible cells retain their ordinary terrain/political fills.
        for (const site of [1, 2, 3, 4, 8]) {
            assert.ok(h.fillDetails.some((fill) => JSON.stringify(fill.points) === JSON.stringify(h.state.graph.cells[site].polygon)
                && !Object.values(CONSTRUCTION_COLORS).includes(fill.color as never)));
        }
        const fullLabel = `${BUILDING_PROFILES[kind].glyph} 1/1`;
        assert.equal(h.engine.queueProvinceBuild(0, kind), true);
        h.tick();
        assert.equal(h.clears, ++rebuilds);
        assert.equal(h.fills.filter((color) => color === CONSTRUCTION_COLORS.full).length, 1);
        assert.ok(h.labels.some((label) => label.text === fullLabel));
        h.engine.select(0);
        h.engine.setFactoryProduction(1);
        h.state.construction[0].remainingPoints -= 1;
        h.engine.emit({ type: "state" });
        h.tick();
        assert.equal(h.clears, rebuilds);
        assert.ok(h.engine.cancelBuild(h.state.construction[0].id));
        h.tick();
        assert.equal(h.clears, ++rebuilds);
        assert.equal(h.fills.filter((color) => color === CONSTRUCTION_COLORS.empty).length, 5);
        assert.ok(!h.labels.some((label) => label.text === fullLabel));
        assert.ok(h.engine.queueProvinceBuild(0, kind));
        h.tick();
        assert.equal(h.clears, ++rebuilds);
        h.state.construction[0].remainingPoints = 0.01;
        processConstruction(h.engine);
        h.tick();
        assert.equal(h.clears, ++rebuilds);
        assert.ok(h.state.provinces[0].buildings.includes(kind));
        assert.equal(h.state.construction.length, 0);
        assert.ok(h.labels.some((label) => label.text === fullLabel));
        assert.ok(!h.labels.some((label) => label.text.includes("已满")));
        assert.equal(h.engine.queueProvinceBuild(0, kind), false);
        h.state.provinces[0].owner = 1;
        h.engine.emit({ type: "capture", province: 0, nationId: 1, eliminated: null });
        h.tick();
        assert.equal(h.clears, ++rebuilds);
        assert.equal(h.fills.filter((color) => color === CONSTRUCTION_COLORS.empty).length, 4);
        assert.ok(!h.labels.some((label) => label.text === fullLabel));
        h.state.provinces[0].owner = 0;
        h.engine.emit({ type: "capture", province: 0, nationId: 0, eliminated: null });
        h.tick();
        assert.equal(h.clears, ++rebuilds);
        assert.ok(h.labels.some((label) => label.text === fullLabel));
        // A dirty cell with unchanged ownership/signature still needs the full overlay repaint.
        h.engine.emit({ type: "capture", province: 1, nationId: 1, eliminated: null });
        h.tick();
        assert.equal(h.clears, ++rebuilds);
        assert.equal(h.fills.filter((color) => color === CONSTRUCTION_COLORS.full).length, 1);
        h.state.provinces[0].owner = -1;
        h.engine.emit({ type: "state" });
        h.tick();
        assert.equal(h.clears, ++rebuilds);
        assert.ok(!h.labels.some((label) => label.text === fullLabel));
        h.tick();
        assert.equal(h.clears, rebuilds);
    });

    test(`${kind} badges appear at the zoom threshold, stay compact, and require matching scope`, (t) => {
        const h = harness(t);
        h.renderer.setMapMode("province");
        h.state.graph.cells[0].centroid = { x: 75, y: 215 };
        h.renderer.camera.centerOn(75, 215);
        h.renderer.camera.zoom = PROVINCE_CAPACITY_MIN_ZOOM - 0.01;
        h.renderer.setConstructionView(kind);
        h.tick();
        assert.equal(PROVINCE_CAPACITY_MIN_ZOOM, 1.6);
        assert.equal(h.clears, 1);
        assert.ok(h.fills.includes(CONSTRUCTION_COLORS.empty));
        assert.ok(!h.labels.some((label) => label.text.includes("/1")));
        for (const zoom of [PROVINCE_CAPACITY_MIN_ZOOM, 3, 5]) {
            h.renderer.camera.zoom = zoom;
            h.tick();
            assert.equal(h.clears, 1);
            const label = h.labels.find((label) => label.text === `${BUILDING_PROFILES[kind].glyph} 0/1`
                && Math.abs(label.x - 403) < 1e-6 && Math.abs(label.y - 300) < 1e-6);
            assert.ok(label, "capacity badge anchors at the cell centroid");
            assert.ok(label.font.includes("13px"));
            assert.equal(label.scale, 1, "font remains 13 screen pixels at every zoom");
            assert.ok(!h.labels.some((entry) => /^[SP]\d+$/.test(entry.text) || entry.text.includes(" · ") || entry.text.includes("已满")));
        }
        h.renderer.camera.zoom = 1;
        h.tick();
        assert.equal(h.clears, 1);
        assert.ok(!h.labels.some((label) => label.text.includes("/1")));
        h.renderer.setMapMode("state");
        h.tick();
        assert.equal(h.clears, 2);
        assert.ok(h.labels.some((label) => label.text.includes(" · ")));
        assert.ok(!h.fills.some((color) => Object.values(CONSTRUCTION_COLORS).includes(color as never)));
        h.renderer.setMapMode("province");
        h.renderer.camera.zoom = 2;
        h.tick();
        assert.equal(h.clears, 3);
        assert.ok(h.labels.some((label) => label.text.includes("/1")));
        assert.ok(h.fills.includes(CONSTRUCTION_COLORS.empty));
    });

    test(`${kind} construction clicks pass through armies and exiting restores ordinary markers`, (t) => {
        const h = harness(t);
        h.state.armies.set(1, { id: 1, nation: 0, name: "Army", province: 0,
            regiments: [{ id: 1, kind: 0, hp: 10 }], org: 80, moved: false, acted: false, march: null });
        h.state.armyAt[0] = 1;
        h.state.provinces[0].buildings.push(kind === "supply" ? "fort" : "supply");
        h.renderer.setMapMode("province");
        h.renderer.camera.centerOn(50, 200);
        h.renderer.camera.zoom = 2;
        h.engine.select(3);
        const camera = { ...h.renderer.camera };
        const marker = BUILDING_PROFILES[h.state.provinces[0].buildings[0]].glyph;
        h.renderer.setConstructionView(kind);
        h.tick();
        assert.equal(h.renderer.constructionKind, kind);
        assert.deepEqual({ ...h.renderer.camera }, camera);
        assert.equal(h.state.selected, 3);
        assert.ok(!h.labels.some((label) => label.text === marker));
        h.click(400, 300);
        assert.deepEqual(h.clicks, [0]);
        assert.equal(h.state.selectedArmyId, null);
        assert.ok(h.engine.queueProvinceBuild(h.clicks[0], kind));
        h.click(400, 300, 2);
        assert.deepEqual(h.clicks, [0, -1]);
        h.renderer.setConstructionView(null);
        h.tick();
        assert.ok(h.labels.some((label) => label.text === marker));
        assert.ok(!h.labels.some((label) => label.text.includes("/1")));
        assert.ok(!h.fills.some((color) => Object.values(CONSTRUCTION_COLORS).includes(color as never)));
        assert.equal(h.state.selected, 3);
        assert.deepEqual({ ...h.renderer.camera }, camera);
        h.click(400, 300);
        assert.equal(h.state.selectedArmyId, 1);
        assert.deepEqual(h.clicks, [0, -1]);
    });
}

test("province badges use visible periodic copies, retain seam overlaps and fall back to sites", (t) => {
    const h = harness(t);
    for (const province of h.state.provinces) province.owner = province.site === 0 ? 0 : 1;
    h.state.graph.cells[0].centroid = { x: 35, y: 25 };
    const { width, height } = h.state.graph.domain;
    h.renderer.setMapMode("province");
    h.renderer.setConstructionView("supply");
    h.renderer.camera.zoom = 2;
    const badges = () => h.labels.filter((label) => label.text === `${BUILDING_PROFILES.supply.glyph} 0/1`);
    h.renderer.camera.centerOn(width - 50, height - 50);
    h.tick();
    assert.deepEqual(badges().map(({ x, y }) => [x, y]), [[573, 450]]);
    h.renderer.camera.centerOn(width / 2, height / 2);
    h.tick();
    assert.equal(badges().length, 0);
    // Anchor lies just beyond the lower/right viewport edges but the badge is visible.
    h.renderer.camera.centerOn(35 - 200 - 5, 25 - 150 - 2);
    h.tick();
    assert.deepEqual(badges().map(({ x, y }) => [x, y]), [[813, 604]]);
    h.renderer.camera.centerOn(35 - 200 - 50, 25 - 150 - 50);
    h.tick();
    assert.equal(badges().length, 0);
    h.state.graph.domain.periodicX = h.state.graph.domain.periodicY = false;
    h.renderer.camera.centerOn(width - 50, height - 50);
    h.tick();
    assert.equal(badges().length, 0);
    h.state.graph.cells[0].bounded = false;
    h.renderer.camera.centerOn(50, 200);
    h.tick();
    assert.deepEqual(badges().map(({ x, y }) => [x, y]), [[403, 300]]);
});

function addArmy(state: GameState, id = 1, site = 0): void {
    state.armies.set(id, { id, nation: 0, name: `Army${id}`, province: site,
        regiments: [{ id: id * 2, kind: 0, hp: 10 }, { id: id * 2 + 1, kind: 0, hp: 10 }],
        org: 80, moved: false, acted: false, march: null });
    state.armyAt[site] = id;
}

test("land selection never selects its occupant and clears pending targeting, not issued orders", () => {
    const state = fixture();
    addArmy(state);
    const engine = new GameEngine(state);
    const army = state.armies.get(1)!;
    army.march = { target: 1, attack: false };
    engine.selectArmy(1);
    assert.equal(engine.selectedArmy(), army);
    assert.equal(state.selected, 0);
    state.redeployArmyId = 1;
    engine.select(0);
    assert.equal(state.selected, 0);
    assert.equal(engine.selectedArmy(), null);
    assert.equal(state.redeployArmyId, null);
    assert.deepEqual(army.march, { target: 1, attack: false });
    engine.selectArmy(1);
    engine.select(null);
    assert.equal(state.selected, null);
    assert.equal(engine.selectedArmy(), null);
    assert.equal(army.province, 0);
});

test("province counter clicks select, ground clicks route to land, and state mode discards stale counter hits", (t) => {
    const h = harness(t);
    addArmy(h.state);
    addArmy(h.state, 2, 1);
    h.renderer.camera.centerOn(50, 200);
    h.renderer.camera.zoom = 1;
    h.renderer.setMapMode("province");
    h.tick();
    h.engine.selectArmy(1);
    h.engine.reachFor = () => ({ cost: new Map([[1, 1]]) }) as ReturnType<GameEngine["reachFor"]>;
    h.click(500, 300);
    assert.equal(h.state.selectedArmyId, 2);
    assert.equal(h.state.armies.size, 2);
    assert.equal(h.clicks.length, 0);
    h.click(530, 330);
    assert.deepEqual(h.clicks, [1]);
    h.renderer.setMapMode("state");
    h.click(500, 300);
    assert.deepEqual(h.clicks, [1, 1]);
    h.tick();
    assert.ok(!h.labels.some((label) => label.text === "×2"));
    h.click(500, 300);
    assert.deepEqual(h.clicks, [1, 1, 1]);
    h.renderer.setMapMode("province");
    h.tick();
    assert.ok(h.labels.some((label) => label.text === "×2"));
    h.click(400, 300);
    assert.equal(h.state.selectedArmyId, 1);
});

test("800ms stable hover shows province details or a frozen state snapshot; selection never paints garrisons", (t) => {
    const h = harness(t);
    addArmy(h.state);
    h.state.provinces[0].garrison = 20;
    h.state.provinces[0].garrisonMax = 40;
    h.state.battles.push({ province: 1, attackerId: 1, defenderId: null, rounds: 2 });
    h.state.armies.get(1)!.march = { target: 2, attack: false };
    h.engine.select(0);
    h.renderer.setMapMode("province");
    h.renderer.camera.centerOn(50, 200);
    h.renderer.camera.zoom = 1;
    h.tick(1200);
    assert.equal(h.mapRequests.length, 0, "selection alone cannot request details");
    assert.ok(!h.labels.some((label) => label.text.includes("驻军")));
    assert.ok(h.labels.some((label) => label.text === "激战 2 日"));
    h.hover();
    h.tick(0);
    h.tick(799);
    assert.equal(h.tooltipEl.hidden, true);
    assert.equal(h.mapRequests.length, 0);
    // Data is read at display time, not snapshotted on entry.
    h.state.provinces[0].garrison = 19;
    h.state.provinces[0].legalOwner = 1;
    h.tick(1);
    assert.equal(h.tooltipEl.hidden, false);
    assert.equal(h.tooltipTitle.innerHTML, "P0");
    assert.match(h.tooltipBody.innerHTML, /所属州：S0\n控制国：N0\n正式归属：N1\n地形：平原/);
    assert.match(h.tooltipBody.innerHTML, /game-text--friendly">友方<\/span>驻军 19\/40/);
    assert.equal(h.canvas.getAttribute("aria-describedby"), "global-tooltip");
    const writes = h.textWrites;
    const reads = h.layoutReads;
    for (let i = 0; i < 100; i++) h.tick();
    assert.equal(h.mapRequests.length, 1, "stable frames do not dispatch duplicate requests");
    assert.equal(h.textWrites, writes);
    assert.equal(h.layoutReads, reads, "stable frames do not measure layout");
    h.tooltip.refresh();
    assert.equal(h.tooltipEl.hidden, false, "HUD rerenders preserve valid map ownership");
    for (const [owner, war, tone, name] of [
        [-1, false, "neutral", "中立"],
        [1, false, "neutral", "中立"],
        [1, true, "hostile", "敌方"],
        [0, true, "friendly", "友方"],
    ] as const) {
        h.state.provinces[0].owner = owner;
        h.state.war[0][1] = h.state.war[1][0] = war;
        h.tick();
        assert.match(h.tooltipBody.innerHTML, new RegExp(`game-text--${tone}">${name}</span>驻军 19/40`));
        assert.ok(!h.labels.some((label) => label.text.includes("驻军")));
    }
    h.state.provinces[0].garrison = 0;
    h.state.provinces[0].garrisonMax = 60;
    h.tick();
    assert.match(h.tooltipBody.innerHTML, /驻军 0\/60/);
    h.renderer.setMapMode("state");
    assert.equal(h.tooltipEl.hidden, true);
    assert.equal(h.canvas.getAttribute("aria-describedby"), null);
    h.hover();
    h.tick(0);
    h.tick(1200);
    assert.equal(h.tooltipEl.hidden, false, "state mode hovers aggregate the whole state");
    assert.equal(h.tooltipTitle.innerHTML, "S0");
    assert.match(h.tooltipBody.innerHTML, /核心：.*game-text--chip.*N0/);
    assert.match(h.tooltipBody.innerHTML, /拥有者：.*N0/);
    assert.match(h.tooltipBody.innerHTML, /控制明细：.*N0<\/span> 100%/);
    assert.match(h.tooltipBody.innerHTML, /持有宣称：无/);
    const stateRequests = h.mapRequests.length;
    const stateBody = h.tooltipBody.innerHTML;
    h.state.provinces[0].owner = 1;
    h.state.provinces[0].garrison = 5;
    h.tick(1200);
    assert.equal(h.tooltipBody.innerHTML, stateBody, "the state snapshot never refreshes while shown");
    assert.equal(h.mapRequests.length, stateRequests);
    h.state.provinces[0].owner = 0;
    assert.ok(!h.labels.some((label) => label.text.includes("驻军") || label.text.includes("激战") || label.text === "×2"));
    assert.deepEqual(h.state.armies.get(1)!.march, { target: 2, attack: false });
    h.renderer.setMapMode("province");
    h.tick(1200);
    assert.equal(h.tooltipEl.hidden, true, "returning to selected land does not resurrect details");
});

test("movement restarts the hover clock, minor jitter does not, and changing cells always resets", (t) => {
    const h = harness(t);
    h.renderer.setMapMode("province");
    h.renderer.camera.centerOn(50, 200);
    h.renderer.camera.zoom = 1;
    h.hover();
    h.tick(0);
    h.tick(700);
    h.hover(402, 302);
    h.tick(100);
    assert.equal(h.tooltipEl.hidden, false, "minor jitter permits the initial 800ms deadline");
    h.hover(410, 300);
    assert.equal(h.tooltipEl.hidden, true, "movement within the same province hides immediately");
    h.tick(0);
    h.tick(799);
    assert.equal(h.tooltipEl.hidden, true);
    h.tick(1);
    assert.equal(h.tooltipEl.hidden, false);
    h.hover(449, 300);
    h.tick(0);
    h.tick(799);
    h.hover(451, 300);
    h.tick(0);
    h.tick(799);
    assert.equal(h.tooltipEl.hidden, true, "a different province resets even a two-pixel move");
    h.tick(1);
    assert.equal(h.tooltipTitle.innerHTML, "P1");
    h.hover(500, 300);
    assert.equal(h.tooltipEl.hidden, true);
    h.tick(0);
    h.tick(500);
    h.hover(520, 300);
    h.tick(0);
    h.tick(500);
    assert.equal(h.tooltipEl.hidden, true, "continuous motion cannot reuse earlier dwell time");
});

const hoverCancellations: [string, (h: ReturnType<typeof harness>) => void][] = [
    ["canvas leave", (h) => h.fireCanvas("pointerleave")],
    ["HUD enter", (h) => h.documentEvent("pointerover")],
    ["HUD pointer move", (h) => h.documentEvent("pointermove")],
    ["pointer down", (h) => h.fireCanvas("pointerdown", { buttons: 1 })],
    ["pointer cancel", (h) => h.fireCanvas("pointercancel")],
    ["lost capture", (h) => h.fireCanvas("lostpointercapture")],
    ["drag", (h) => { h.fireCanvas("pointerdown"); h.fireCanvas("pointermove", { clientX: 440, buttons: 1 }); }],
    ["wheel", (h) => h.fireCanvas("wheel", { deltaY: 100 })],
    ["HUD wheel", (h) => h.documentEvent("wheel")],
    ["scroll", (h) => h.documentEvent("scroll")],
    ["dragstart", (h) => h.documentEvent("dragstart")],
    ["minimap hover", (h) => h.hover(650, 540)],
    ["minimap click", (h) => h.click(650, 540)],
    ["zoom button", (h) => h.renderer.zoomBy(1.1)],
    ["fit map", (h) => h.renderer.fitMap()],
    ["capital", (h) => h.renderer.centerOnCapital()],
    ["external pan", (h) => h.renderer.camera.pan(20, 0)],
    ["external zoom", (h) => { h.renderer.camera.zoom = 2; }],
    ["resize", (h) => h.resize()],
    ["state mode", (h) => h.renderer.setMapMode("state")],
    ["construction", (h) => h.renderer.setConstructionView("fort")],
    ["Escape", (h) => h.documentEvent("keydown", { key: "Escape" })],
    ["keyboard navigation", (h) => h.documentEvent("keydown", { key: "Tab" })],
    ["blur", (h) => h.windowEvents.dispatchEvent({ type: "blur" })],
    ["destroy", (h) => h.renderer.destroy()],
];
for (const [name, cancel] of hoverCancellations) {
    for (const visible of [false, true]) {
        test(`${name} cancels ${visible ? "visible" : "pending"} map details without selected resurrection`, (t) => {
            const h = harness(t);
            h.renderer.setMapMode("province");
            h.renderer.camera.centerOn(50, 200);
            h.renderer.camera.zoom = 1;
            h.engine.select(0);
            h.hover();
            h.tick(0);
            h.tick(visible ? 800 : 400);
            assert.equal(h.tooltipEl.hidden, !visible);
            cancel(h);
            h.tick();
            // HUD tooltips may take over, but map ownership must always end.
            assert.equal(h.canvas.getAttribute("aria-describedby"), null);
            const shows = h.mapRequests.filter((request) => request.action === "show").length;
            h.state.provinces[0].garrison = 18;
            h.tick(2000);
            assert.equal(h.mapRequests.filter((request) => request.action === "show").length, shows);
            assert.ok(!h.labels.some((label) => label.text.includes("驻军")));
        });
    }
}

test("map tooltip never replaces HUD, shared hides reset hover, and occluded canvases are rejected", (t) => {
    const h = harness(t);
    h.renderer.setMapMode("province");
    h.renderer.camera.centerOn(50, 200);
    h.hover();
    h.tick(0);
    h.tick(800);
    h.documentEvent("pointerover");
    assert.equal(h.tooltipTitle.innerHTML, 'HUD <span class="game-text game-text--manpower">补给</span>');
    assert.equal(h.canvas.getAttribute("aria-describedby"), null);
    const show = h.mapRequests.find((request) => request.action === "show")!;
    document.dispatchEvent(new CustomEvent(MAP_TOOLTIP_EVENT, { detail: show }));
    assert.equal(h.tooltipBody.innerHTML, "HUD details", "a stale map request cannot replace HUD");
    document.dispatchEvent(new CustomEvent(MAP_TOOLTIP_EVENT, { detail: { action: "hide", anchor: h.canvas } }));
    assert.equal(h.tooltipEl.hidden, false, "a map hide cannot hide HUD");
    h.hover();
    h.tick(0);
    h.tick(800);
    assert.equal(h.tooltipTitle.innerHTML, "P0");
    h.tooltip.hide();
    h.state.provinces[0].garrison = 21;
    h.tick(1000);
    assert.equal(h.tooltipEl.hidden, true, "external hide cancels renderer ownership");
    h.hover();
    h.tick(0);
    h.coverCanvas();
    h.tick(800);
    assert.equal(h.tooltipEl.hidden, true, "HUD appearing beneath a stationary pointer blocks show");
    h.hover();
    h.tick(0);
    h.tick(800);
    h.coverCanvas();
    h.tooltip.refresh();
    assert.equal(h.tooltipEl.hidden, true, "refresh cancels a map tooltip covered by HUD");
    h.state.provinces[0].garrison = 22;
    h.tick(1000);
    assert.equal(h.tooltipEl.hidden, true);
});

test("province and nation names are escaped; intel keeps ownership, claims, defense and occupation but no garrison counts", (t) => {
    const h = harness(t);
    const province = h.state.provinces[0];
    province.name = '[[funds:999]] <img src=x onerror="bad()">';
    province.legalOwner = 1;
    province.coreNation = -1;
    province.garrison = 13;
    province.garrisonMax = 79;
    h.state.nations[1].name = '[[hostile]] <script>bad()</script>';
    h.state.states[0].name = '[[industry]] <b>State</b>';
    h.state.claims.push({ nation: 1, stateId: 0 }, { nation: 0, stateId: 1 });
    h.renderer.setMapMode("province");
    h.renderer.camera.centerOn(50, 200);
    h.hover();
    h.tick(0);
    h.tick(800);
    assert.match(h.tooltipTitle.innerHTML, /^\[\[funds:999\]\] &lt;img/);
    assert.ok(!h.tooltipTitle.innerHTML.includes("<img"));
    assert.match(h.tooltipBody.innerHTML, /正式归属：\[\[hostile\]\] &lt;script&gt;/);
    assert.match(h.tooltipBody.innerHTML, /所属州：\[\[industry\]\] &lt;b&gt;State&lt;\/b&gt;/);
    assert.equal((h.tooltipBody.innerHTML.match(/game-text--/g) ?? []).length, 1);
    assert.equal(renderGameText((h.mapRequests[0] as Extract<MapTooltipRequest, { action: "show" }>).source.title, "plain"), province.name);
    h.engine.select(0);
    const intel = new IntelPanel(h.engine);
    intel.render("province");
    assert.match(h.intelEl.innerHTML, /<dt>控制国<\/dt><dd>N0<\/dd>/);
    assert.match(h.intelEl.innerHTML, /<dt>正式归属<\/dt><dd>\[\[hostile\]\] &lt;script&gt;/);
    assert.match(h.intelEl.innerHTML, /地形\/城市/);
    assert.match(h.intelEl.innerHTML, /game-text--keyword">占领效率/);
    assert.match(h.intelEl.innerHTML, /宣称国：\\\[\\\[hostile\]\] &lt;script&gt;/);
    assert.ok(!h.intelEl.innerHTML.includes("13/79"));
    assert.ok(!h.intelEl.innerHTML.includes('class="garrison-bar"'));
    intel.render("state");
    assert.match(h.intelEl.innerHTML, /控制国：N0 · 正式归属：\[\[hostile\]\] &lt;script&gt;/);
    assert.ok(!h.intelEl.innerHTML.includes("13/79"));
});

test("UI switches army selection to province mode and state mode restores land information", (t) => {
    const h = harness(t);
    addArmy(h.state);
    const classes = new Set<string>();
    const pane = () => ({ render() {} });
    const ui = Object.assign(Object.create(GameUI.prototype), {
        engine: h.engine, mapMode: "state", activeTab: "nations",
        multiSelect: new Set<number>(), splitChecks: new Set<number>(),
        hud: { classList: { toggle(name: string, enabled: boolean) { if (enabled) classes.add(name); else classes.delete(name); } } },
        tooltip: { hide() {}, refresh() {} },
        construction: { selectedKind: null, scope: "state", render() {} },
        callbacks: { onMapMode: (mode: "province" | "state") => h.renderer.setMapMode(mode) },
        renderLayers() {}, syncConstructionView() {},
        ...Object.fromEntries(["topbar", "intel", "armies", "detail", "nations", "deploy", "policy", "diplomacy", "expansion", "feed"].map((key) => [key, pane()])),
    });
    t.after(h.engine.subscribe(() => ui.refresh()));
    h.engine.selectArmy(1);
    assert.equal(ui.mapMode, "province");
    assert.equal(h.renderer.mapMode, "province");
    assert.ok(classes.has("command-mode"));
    ui.multiSelect.add(1);
    ui.splitChecks.add(2);
    h.state.redeployArmyId = 1;
    h.state.armies.get(1)!.march = { target: 1, attack: false };
    ui.changeMapMode("state");
    assert.equal(ui.mapMode, "state");
    assert.equal(h.renderer.mapMode, "state");
    assert.equal(h.state.selected, 0);
    assert.equal(h.state.selectedArmyId, null);
    assert.equal(h.state.redeployArmyId, null);
    assert.equal(ui.multiSelect.size, 0);
    assert.equal(ui.splitChecks.size, 0);
    assert.ok(!classes.has("command-mode"));
    assert.deepEqual(h.state.armies.get(1)!.march, { target: 1, attack: false });
    h.engine.selectArmy(1);
    assert.equal(ui.mapMode, "province");
    h.engine.select(0);
    assert.equal(h.state.selectedArmyId, null);
    assert.ok(!classes.has("command-mode"));
});

test("claim overlay paints player-claimed states in the nation color, rebuilds only on player claim changes, and focus ring is state-mode only", (t) => {
    const h = harness(t);
    const region = h.state.states[1];
    const nationColor = h.state.nations[0].color;
    const isClaimFill = (fill: { color: string; alpha: number }) => fill.color === nationColor && fill.alpha === 0.24;
    h.state.claims.push({ nation: 0, stateId: 1 }, { nation: 1, stateId: 0 });
    h.engine.emit({ type: "state" });
    h.tick();
    assert.equal(h.clears, 1);
    const claimFills = h.fillDetails.filter(isClaimFill);
    assert.deepEqual(claimFills.map((fill) => fill.points), region.provinces.map((site) => h.state.graph.cells[site].polygon));
    assert.ok(h.strokes.some((stroke) => stroke.color === nationColor && stroke.alpha === 0.95 && stroke.width === 2));

    h.state.selected = 2;
    h.state.claims.push({ nation: 1, stateId: 2 });
    h.engine.emit({ type: "state" });
    h.tick();
    assert.equal(h.clears, 1);
    assert.ok(!h.fillDetails.some(isClaimFill));

    h.state.claims.push({ nation: 0, stateId: 2 });
    h.engine.emit({ type: "state" });
    h.tick();
    assert.equal(h.clears, 2);
    assert.equal(h.fillDetails.filter(isClaimFill).length, region.provinces.length + h.state.states[2].provinces.length);
    h.state.claims.splice(h.state.claims.findIndex((claim) => claim.nation === 0 && claim.stateId === 2), 1);
    h.engine.emit({ type: "state" });
    h.tick();
    assert.equal(h.clears, 3);
    assert.equal(h.fillDetails.filter(isClaimFill).length, region.provinces.length);

    const isRing = (stroke: { color: string; width: number; dash: number[] }) =>
        stroke.dash.join(",") === "6,4" && stroke.color === "rgba(240, 246, 252, 0.9)" && stroke.width === 2.5;
    // Wire a left/right adjacency chain so the state has a real outer boundary.
    const members = new Set(region.provinces);
    for (const site of region.provinces) h.state.graph.cells[site].neighbors = [site - 1, site + 1];
    const boundary: { x: number; y: number }[] = [];
    for (const site of region.provinces) {
        const cell = h.state.graph.cells[site];
        for (let k = 0; k < cell.neighbors.length; k++) {
            if (members.has(cell.neighbors[k])) continue;
            boundary.push(cell.polygon[k], cell.polygon[(k + 1) % cell.polygon.length]);
        }
    }
    assert.ok(boundary.length > 0);
    h.renderer.setClaimFocus(1);
    h.tick();
    const rings = h.strokes.filter(isRing);
    assert.ok(rings.length >= 1);
    assert.ok(rings.every((stroke) => JSON.stringify(stroke.points) === JSON.stringify(boundary)));
    h.renderer.setMapMode("province");
    h.tick();
    assert.ok(!h.strokes.some(isRing));
    assert.ok(!h.fillDetails.some(isClaimFill));
    h.renderer.setMapMode("state");
    h.tick();
    assert.ok(h.strokes.some(isRing));
    h.renderer.setClaimFocus(null);
    h.tick();
    assert.ok(!h.strokes.some(isRing));
});

test("gradient zoom-in rims national borders inward instead of deep-tinting border provinces", (t) => {
    const h = harness(t);
    const [left, right] = [0, 4];
    h.state.graph.cells[left].neighbors = [right];
    h.state.graph.cells[right].neighbors = [left];
    h.renderer.setMapMode("province");
    h.renderer.setColorMode("gradient");
    h.renderer.camera.zoom = 1.4;
    h.engine.emit({ type: "state" });
    h.tick();
    const rims = h.strokes.filter((stroke) => stroke.width === 4.5 && stroke.alpha === 0.5);
    assert.ok(rims.length >= 1);
    assert.deepEqual(new Set(rims.map((stroke) => stroke.color)),
        new Set([h.state.nations[0].color, h.state.nations[1].color]));
    // Both centroids sit below the shared top edge (y=150), so the rim must inset downward.
    assert.ok(rims.every((stroke) => stroke.points.length >= 2 && stroke.points.every((point) => point.y === 153.2)));
    assert.ok(h.fillDetails.some((fill) => fill.color === h.state.nations[0].color && fill.alpha === 0.22));
    assert.ok(!h.fillDetails.some((fill) => fill.color === h.state.nations[0].color && fill.alpha === 0.5));

    h.renderer.setColorMode("uniform");
    h.tick();
    assert.ok(!h.strokes.some((stroke) => stroke.width === 4.5));
    h.renderer.setColorMode("gradient");
    h.renderer.camera.zoom = 0.6;
    h.tick();
    assert.ok(!h.strokes.some((stroke) => stroke.width === 4.5));
});
