import { persistLocale } from "./i18n/bootstrap.ts";
import "./style/index.css";
import { GameEngine } from "./game/engine.ts";
import type { EngineEvent } from "./game/types/events.ts";
import type { GameState } from "./game/types/state.ts";
import type { UnitKind } from "./game/types/unit.ts";
import type { GameSettings, TerrainTuning } from "./types/settings.ts";
import { mapSizeForCells } from "./types/settings.ts";
import { generateWorld, buildWorld } from "./game/generator/index.ts";
import { DEFAULT_TERRAIN_PARAMS } from "./game/terrain/biome.ts";
import { setPlayerNation } from "./game/player.ts";
import { MapRenderer } from "./render/renderer.ts";
import { GameUI } from "./ui/index.ts";
import { mountLayout } from "./ui/layout.ts";
import { SoundManager } from "./audio/index.ts";
import type { SoundContext } from "./audio/index.ts";
import { desktop } from "./desktop.ts";
import { initGuide } from "./guide.ts";
import { getLocale, isLocale, setLocale, t } from "./i18n/index.ts";
import { escapeHtml, setGameHtml, setGameText } from "./ui/text.ts";
import { nationFlagHtmlFor } from "./ui/flags.ts";
import { nationDisplayColor } from "./game/access.ts";
import { createDebug } from "./debug/bootstrap.ts";
import { DebugEventLog } from "./debug/services/eventLog.ts";
import { DebugJournal } from "./debug/services/journal.ts";
import { mountTerminal } from "./debug/terminal.ts";
import { readLaunchSettings } from "./debug/commands/world.ts";
import type { DebugContext } from "./debug/types.ts";

const app = document.querySelector<HTMLDivElement>("#app") as HTMLDivElement;
mountLayout(app);

if (desktop) {
    document.documentElement.classList.add("is-desktop");
    document.documentElement.dataset.platform = desktop.platform;
}

const sound = new SoundManager();
const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas") as HTMLCanvasElement;

let draggedKind: UnitKind | null = null;
let dragSite = -1;
let dragSiteSince = 0;
let lastAutoRecruit = 0;
let autoRecruited = false;

function resetDragState(): void {
    draggedKind = null;
    dragSite = -1;
    dragSiteSince = 0;
    lastAutoRecruit = 0;
    autoRecruited = false;
    canvas.classList.remove("unit-drop-target");
    renderer?.setDropSite(null);
}

document.addEventListener("dragstart", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-drag-kind]");
    const kind = button ? Number(button.dataset.dragKind) : NaN;
    draggedKind = kind === 0 || kind === 1 || kind === 2 ? kind : null;
    dragSite = -1;
    dragSiteSince = 0;
    lastAutoRecruit = 0;
    autoRecruited = false;
});
document.addEventListener("dragend", resetDragState);

canvas.addEventListener("dragover", (event) => {
    if (!engine || !renderer || draggedKind === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    canvas.classList.add("unit-drop-target");
    const site = renderer.siteAtClient(event.clientX, event.clientY);
    renderer.setDropSite(site);
    const now = performance.now();
    if (site !== dragSite) {
        dragSite = site;
        dragSiteSince = now;
        lastAutoRecruit = 0;
        return;
    }
    // Hold over one province for two seconds: keep raising regiments until release.
    if (site >= 0 && now - dragSiteSince >= 2000 && now - lastAutoRecruit >= 450) {
        lastAutoRecruit = now;
        if (engine.recruitUnit(draggedKind, site)) autoRecruited = true;
    }
});
canvas.addEventListener("dragleave", resetDragState);
canvas.addEventListener("drop", (event) => {
    event.preventDefault();
    const kind = draggedKind;
    const already = autoRecruited;
    const site = renderer && kind !== null ? renderer.siteAtClient(event.clientX, event.clientY) : -1;
    resetDragState();
    if (!engine || kind === null || site < 0 || already) return;
    if (engine.recruitUnit(kind, site)) {
        sound.play("recruit");
        ui?.toast(t("actions.economy.train.success"));
    } else {
        sound.play("error");
        ui?.toast(t("actions.economy.train.fail"));
    }
});
const startOverlay = document.querySelector<HTMLElement>("#start-overlay") as HTMLElement;
const newgameOverlay = document.querySelector<HTMLElement>("#newgame-overlay") as HTMLElement;
const seedInput = document.querySelector<HTMLInputElement>("#seed-input") as HTMLInputElement;
const nationRange = document.querySelector<HTMLInputElement>("#nation-range") as HTMLInputElement;
const nationValue = document.querySelector<HTMLElement>("#nation-value") as HTMLElement;
const nationCustom = document.querySelector<HTMLElement>("#nation-custom") as HTMLElement;
const cellsRange = document.querySelector<HTMLInputElement>("#cells-range") as HTMLInputElement;
const cellsValue = document.querySelector<HTMLElement>("#cells-value") as HTMLElement;
const cellsCustom = document.querySelector<HTMLElement>("#cells-custom") as HTMLElement;
const nationPresetButtons = [...newgameOverlay.querySelectorAll<HTMLButtonElement>("[data-nation-preset]")];
const cellsPresetButtons = [...newgameOverlay.querySelectorAll<HTMLButtonElement>("[data-cells-preset]")];
const balanceButtons = [...newgameOverlay.querySelectorAll<HTMLButtonElement>("[data-balance]")];
const terrainInputs = [...newgameOverlay.querySelectorAll<HTMLInputElement>("[data-terrain]")];
const terrainModeButtons = [...newgameOverlay.querySelectorAll<HTMLButtonElement>("[data-terrain-mode]")];
const genOverlay = document.querySelector<HTMLElement>("#gen-overlay") as HTMLElement;
const genStatus = document.querySelector<HTMLElement>("#gen-status") as HTMLElement;
const genProgress = document.querySelector<HTMLElement>("#gen-progress") as HTMLElement;
const genBar = document.querySelector<HTMLElement>("#gen-bar") as HTMLElement;
const genPercent = document.querySelector<HTMLElement>("#gen-percent") as HTMLElement;
const pickerOverlay = document.querySelector<HTMLElement>("#nation-picker") as HTMLElement;
const nationOptions = document.querySelector<HTMLElement>("#nation-options") as HTMLElement;
const guide = initGuide();
const debugEvents = new DebugEventLog();
const debugJournal = new DebugJournal();

let engine: GameEngine | null = null;
let renderer: MapRenderer | null = null;
let ui: GameUI | null = null;
let soundUnsub: (() => void) | null = null;
let pendingState: GameState | null = null;
let generationToken = 0;
let terrainMode: "default" | "custom" = "default";
let newGameFromStart = false;
/** Preset choice; null means the custom slider below the presets is active. */
let nationPreset: number | null = 6;
let cellsPreset: number | null = 1500;
let balanceNations = false;
let lastSettings: GameSettings = { seed: 0, mapSize: "standard", nationCount: 6, mapCells: 1500 };

const debugContext: DebugContext = {
    get engine() { return engine; },
    get renderer() { return renderer; },
    get ui() { return ui; },
    events: debugEvents,
    journal: debugJournal,
    newGame: startDebugGame,
    tapSite: handleCellClick,
    openGuide: () => guide.open(),
};
const debug = createDebug(debugContext);
const launch = readLaunchSettings();
mountTerminal(debug.bridge, launch !== null);
Object.defineProperty(window, "__nitro", {
    get: () => ({ engine, renderer, ui, debug: debug.bridge }),
});

function randomSeed(): number {
    return Math.floor(Math.random() * 1_000_000);
}

function syncNewGameChoices(): void {
    for (const button of nationPresetButtons) {
        const preset = button.dataset.nationPreset ?? "";
        const active = preset === "custom" ? nationPreset === null : Number(preset) === nationPreset;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    }
    for (const button of cellsPresetButtons) {
        const preset = button.dataset.cellsPreset ?? "";
        const active = preset === "custom" ? cellsPreset === null : Number(preset) === cellsPreset;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    }
    nationCustom.classList.toggle("hidden", nationPreset !== null);
    cellsCustom.classList.toggle("hidden", cellsPreset !== null);
    setGameText(nationValue, t("misc.layout.unit.countries", { count: nationPreset ?? nationRange.value }), "plain");
    setGameText(cellsValue, t("misc.layout.unit.provinces", { count: Number(cellsPreset ?? cellsRange.value).toLocaleString("zh-CN") }), "plain");
}

function syncBalanceChoice(): void {
    for (const button of balanceButtons) {
        const active = (button.dataset.balance === "on") === balanceNations;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    }
}

function syncTerrainOutputs(): void {
    for (const input of terrainInputs) {
        const key = input.dataset.terrain;
        const output = newgameOverlay.querySelector<HTMLElement>(`[data-terrain-out="${key}"]`);
        if (!output) continue;
        setGameText(output, Number(input.value).toFixed(Number(input.dataset.digits ?? 2)), "plain");
    }
}

function setTerrainMode(mode: "default" | "custom"): void {
    terrainMode = mode;
    for (const button of terrainModeButtons) {
        const active = button.dataset.terrainMode === mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    }
    for (const input of terrainInputs) {
        const key = input.dataset.terrain as keyof typeof DEFAULT_TERRAIN_PARAMS;
        if (mode === "default" && key in DEFAULT_TERRAIN_PARAMS) input.value = String(DEFAULT_TERRAIN_PARAMS[key]);
        input.disabled = mode === "default";
    }
    syncTerrainOutputs();
}

function openNewGame(fromStart: boolean): void {
    newGameFromStart = fromStart;
    startOverlay.classList.add("hidden");
    newgameOverlay.classList.remove("hidden");
    if (!seedInput.value) seedInput.value = String(randomSeed());
    syncNewGameChoices();
    syncBalanceChoice();
    setTerrainMode(terrainMode);
}

function closeNewGame(): void {
    newgameOverlay.classList.add("hidden");
    if (newGameFromStart) startOverlay.classList.remove("hidden");
    newGameFromStart = false;
}

function readNewGameSettings(): GameSettings {
    const parsed = Number(seedInput.value);
    const seed = Number.isFinite(parsed) ? Math.trunc(parsed) >>> 0 : randomSeed();
    const cells = cellsPreset ?? Number(cellsRange.value);
    const terrain = terrainMode === "custom"
        ? Object.fromEntries(terrainInputs.map((input) => [input.dataset.terrain, Number(input.value)])) as TerrainTuning
        : undefined;
    return {
        seed,
        mapSize: mapSizeForCells(cells),
        nationCount: nationPreset ?? Number(nationRange.value),
        mapCells: cells,
        terrain,
        balanceNations,
    };
}

function soundContext(province: number | null, playerInvolved: boolean): SoundContext {
    return {
        visible: province === null || renderer === null || renderer.isSiteVisible(province),
        playerInvolved,
    };
}

function handleCellClick(site: number): void {
    if (!engine || engine.state.winner !== null) return;
    const game = engine;

    if (ui?.briefing.isActive()) {
        if (site >= 0) ui.briefing.showSite(site);
        return;
    }

    if (site === -1) {
        if (ui?.cancelConstructionSelection()) return;
        game.select(null);
        return;
    }

    if (ui?.isConstructionOpen()) {
        ui.handleConstructionMapClick(site);
        return;
    }

    if (ui?.isClaimsOpen()) {
        ui.handleClaimsMapClick(site);
        return;
    }

    game.select(site);
    sound.play("select");
}

function startGame(state: GameState, options: { briefing?: boolean; nation?: number } = {}): void {
    lastSettings = state.settings;
    soundUnsub?.();
    renderer?.destroy();
    ui?.destroy();

    engine = new GameEngine(state);
    debugEvents.attach(engine);
    debugJournal.clear();
    renderer = new MapRenderer(canvas, engine, handleCellClick);
    if (options.briefing) renderer.setMinimapVisible(false);
    ui = new GameUI(engine, sound, {
        onNewGame: () => {
            pendingState = null;
            generationToken++;
            pickerOverlay.classList.add("hidden");
            genOverlay.classList.add("hidden");
            openNewGame(false);
        },
        onRestart: () => beginCampaign({ ...lastSettings, seed: randomSeed() }),
        onHome: () => renderer?.centerOnCapital(),
        onMapMode: (mode) => renderer?.setMapMode(mode),
        onColorMode: (mode) => renderer?.setColorMode(mode),
        onDeepZoom: (value) => renderer?.setDeepZoom(value),
        getColorMode: () => renderer?.getColorMode() ?? "gradient",
        getDeepZoom: () => renderer?.getDeepZoom() ?? 0.8,
        onConstructionView: (kind) => renderer?.setConstructionView(kind),
        onClaimFocus: (stateId) => renderer?.setClaimFocus(stateId),
        onClaimsOverlay: (on) => renderer?.setClaimsOverlay(on),
        onCenterSite: (site) => renderer?.centerOnSite(site),
        onBriefingInspect: (nationId) => {
            renderer?.setNationHighlight(nationId);
            renderer?.centerOnNation(nationId);
        },
        onBriefingEnd: (nationId) => {
            // Commit the inspected nation, then rebuild the UI as the campaign HUD.
            const committed = engine!.state;
            setPlayerNation(committed, nationId);
            startGame(committed);
        },
    });
    soundUnsub = engine.subscribe((event: EngineEvent) => {
        switch (event.type) {
            case "combat":
                sound.play("attack", soundContext(
                    event.province,
                    event.attackerNation === 0 || event.defenderNation === 0,
                ));
                break;
            case "capture":
                sound.play(
                    event.stateFlipped ? "stateFlip" : "capture",
                    soundContext(event.province, event.nationId === 0),
                );
                break;
            case "army-lost":
                sound.play("annihilation", soundContext(event.province, event.nationId === 0));
                break;
            case "deploy":
            case "build":
                sound.play("recruit", soundContext(event.province, event.nationId === 0));
                break;
            case "war":
                sound.play("attack", soundContext(null, event.aggressor === 0 || event.defender === 0));
                break;
            case "claim-warning":
                ui?.toast(t("misc.main.claimWarning", {
                    nation: engine?.state.nations[event.nation]?.name ?? t("misc.common.otherNation"),
                    state: event.stateName,
                }));
                break;
            case "peace":
                sound.play("select", soundContext(null, event.a === 0 || event.b === 0));
                break;
            default:
                break;
        }
    });
    if (options.briefing) {
        const nationId = options.nation ?? 0;
        // Keep the whole world in view: only the borders highlight, the camera never flies to a capital.
        renderer.setNationHighlight(nationId);
        renderer.fitMap();
        ui.startBriefing(nationId);
    } else {
        renderer.centerOnCapital();
    }
    startOverlay.classList.add("hidden");
    pickerOverlay.classList.add("hidden");
    genOverlay.classList.add("hidden");
}

/** Skip every overlay: generate, remap the chosen nation to player 0, and play. */
function startDebugGame(settings: GameSettings, nation = 0): void {
    const state = generateWorld(settings);
    setPlayerNation(state, nation);
    startGame(state);
}

/** Generate the world stage by stage behind a progress bar, then offer the generated nations. */
function beginCampaign(settings: GameSettings): void {
    lastSettings = settings;
    newGameFromStart = false;
    const token = ++generationToken;
    pendingState = null;
    setGameHtml(nationOptions, "");
    startOverlay.classList.add("hidden");
    newgameOverlay.classList.add("hidden");
    pickerOverlay.classList.add("hidden");
    setGenProgress(0, t("misc.main.generation.preparing"));
    genOverlay.classList.remove("hidden");
    const started = performance.now();
    const stages = buildWorld(settings);

    const step = (): void => {
        if (token !== generationToken) return;
        const result = stages.next();
        if (result.done) {
            pendingState = result.value;
            setGenProgress(1, t("misc.main.generation.ready"));
            renderNationOptions(result.value);
            const remaining = Math.max(0, 700 - (performance.now() - started));
            window.setTimeout(() => {
                if (token !== generationToken || !pendingState) return;
                genOverlay.classList.add("hidden");
                pickerOverlay.classList.remove("hidden");
            }, remaining);
            return;
        }
        setGenProgress(result.value.progress, result.value.label);
        // Yield a frame so the progress bar paints between generation stages.
        window.setTimeout(() => requestAnimationFrame(step), 0);
    };
    requestAnimationFrame(step);
}

function setGenProgress(ratio: number, label: string): void {
    const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    genBar.style.width = `${percent}%`;
    setGameText(genPercent, `${percent}%`, "plain");
    genProgress.setAttribute("aria-valuenow", String(percent));
    setGameText(genStatus, label, "plain");
}

function renderNationOptions(state: GameState): void {
    setGameHtml(nationOptions, state.nations.map((nation) => `
        <button class="nation-option" type="button" data-nation="${nation.id}" style="--nc:${escapeHtml(nationDisplayColor(state, nation.id))}">
            ${nationFlagHtmlFor(state, nation.id, 26)}
            <span class="nation-option-name">${escapeHtml(nation.name)}</span>
        </button>`).join(""));
}

/** Enter the pre-game inspection with a nation selected; the campaign starts only on 开始游戏. */
function previewNation(nationId: number): void {
    const state = pendingState;
    if (!state || !Number.isInteger(nationId) || nationId < 0 || nationId >= state.nations.length) return;
    pendingState = null;
    startGame(state, { briefing: true, nation: nationId });
}

seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") document.querySelector<HTMLButtonElement>("#btn-newgame-start")?.click();
});
nationRange.addEventListener("input", () => {
    nationPreset = null;
    syncNewGameChoices();
});
cellsRange.addEventListener("input", () => {
    cellsPreset = null;
    syncNewGameChoices();
});
for (const button of nationPresetButtons) {
    button.addEventListener("click", () => {
        const preset = button.dataset.nationPreset ?? "custom";
        nationPreset = preset === "custom" ? null : Number(preset);
        if (nationPreset !== null) nationRange.value = String(nationPreset);
        syncNewGameChoices();
    });
}
for (const button of cellsPresetButtons) {
    button.addEventListener("click", () => {
        const preset = button.dataset.cellsPreset ?? "custom";
        cellsPreset = preset === "custom" ? null : Number(preset);
        if (cellsPreset !== null) cellsRange.value = String(cellsPreset);
        syncNewGameChoices();
    });
}
for (const button of balanceButtons) {
    button.addEventListener("click", () => {
        balanceNations = button.dataset.balance === "on";
        syncBalanceChoice();
    });
}
for (const input of terrainInputs) input.addEventListener("input", syncTerrainOutputs);
for (const button of terrainModeButtons) {
    button.addEventListener("click", () => setTerrainMode(button.dataset.terrainMode === "custom" ? "custom" : "default"));
}
document.querySelector<HTMLButtonElement>("#btn-start")?.addEventListener("click", () => {
    sound.unlock();
    openNewGame(true);
});
document.querySelector<HTMLButtonElement>("#btn-newgame-start")?.addEventListener("click", () => {
    sound.unlock();
    beginCampaign(readNewGameSettings());
});
document.querySelector<HTMLButtonElement>("#btn-newgame-cancel")?.addEventListener("click", closeNewGame);
document.querySelector<HTMLButtonElement>("#btn-dice")?.addEventListener("click", () => {
    seedInput.value = String(randomSeed());
});
document.querySelector<HTMLButtonElement>("#btn-random-nation")?.addEventListener("click", () => {
    if (!pendingState) return;
    previewNation(Math.floor(Math.random() * pendingState.nations.length));
});
document.querySelector<HTMLButtonElement>("#btn-back-start")?.addEventListener("click", () => {
    pendingState = null;
    generationToken++;
    pickerOverlay.classList.add("hidden");
    genOverlay.classList.add("hidden");
    openNewGame(true);
});
nationOptions.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-nation]");
    if (!target) return;
    previewNation(Number(target.dataset.nation));
});
document.querySelector<HTMLButtonElement>("#btn-howto")?.addEventListener("click", () => guide.open());
document.querySelector<HTMLButtonElement>("#btn-help")?.addEventListener("click", () => {
    sound.unlock();
    guide.open();
});

const languageSelect = document.querySelector<HTMLSelectElement>("#language-select");
if (languageSelect) {
    languageSelect.value = getLocale();
    languageSelect.addEventListener("change", () => {
        const locale = languageSelect.value;
        if (!isLocale(locale)) return;
        setLocale(locale);
        persistLocale(locale);
        document.documentElement.lang = locale;
        window.location.reload();
    });
}

document.querySelector<HTMLButtonElement>("#zoom-in")?.addEventListener("click", () => renderer?.zoomBy(1.3));
document.querySelector<HTMLButtonElement>("#zoom-out")?.addEventListener("click", () => renderer?.zoomBy(1 / 1.3));
document.querySelector<HTMLButtonElement>("#zoom-fit")?.addEventListener("click", () => renderer?.fitMap());

// Live map behind the start screen, unless a debug URL launched a campaign directly.
if (launch) {
    startDebugGame(launch.settings, launch.nation);
} else {
    startGame(generateWorld({ seed: randomSeed(), mapSize: "small", nationCount: 4 }));
    startOverlay.classList.remove("hidden");
}