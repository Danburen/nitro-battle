import "./style.css";
import { GameEngine } from "./game/engine.ts";
import type { EngineEvent, GameState, MapSizeId } from "./game/types.ts";
import { generateWorld } from "./game/generator/index.ts";
import { setPlayerNation } from "./game/player.ts";
import { MapRenderer } from "./render/renderer.ts";
import { GameUI } from "./ui/index.ts";
import { mountLayout } from "./ui/layout.ts";
import { SoundManager } from "./audio/index.ts";
import type { SoundContext } from "./audio/index.ts";
import { desktop } from "./desktop.ts";
import { initGuide } from "./guide.ts";
import { escapeHtml } from "./ui/text.ts";
import { armyAt, isHostileProvince, marchPath } from "./game/rules.ts";

const app = document.querySelector<HTMLDivElement>("#app") as HTMLDivElement;
mountLayout(app);

if (desktop) {
    document.documentElement.classList.add("is-desktop");
    document.documentElement.dataset.platform = desktop.platform;
}

const sound = new SoundManager();
const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas") as HTMLCanvasElement;
const startOverlay = document.querySelector<HTMLElement>("#start-overlay") as HTMLElement;
const seedInput = document.querySelector<HTMLInputElement>("#seed-input") as HTMLInputElement;
const sizeSelect = document.querySelector<HTMLSelectElement>("#size-select") as HTMLSelectElement;
const nationSelect = document.querySelector<HTMLSelectElement>("#nation-select") as HTMLSelectElement;
const genOverlay = document.querySelector<HTMLElement>("#gen-overlay") as HTMLElement;
const genStatus = document.querySelector<HTMLElement>("#gen-status") as HTMLElement;
const pickerOverlay = document.querySelector<HTMLElement>("#nation-picker") as HTMLElement;
const nationOptions = document.querySelector<HTMLElement>("#nation-options") as HTMLElement;
const guide = initGuide();

let engine: GameEngine | null = null;
let renderer: MapRenderer | null = null;
let ui: GameUI | null = null;
let soundUnsub: (() => void) | null = null;
let pendingState: GameState | null = null;
let generationToken = 0;
let lastSettings = { seed: 0, mapSize: "standard" as MapSizeId, nationCount: 3 };

function randomSeed(): number {
    return Math.floor(Math.random() * 1_000_000);
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
    const state = game.state;

    if (site === -1) {
        if (ui?.cancelConstructionSelection()) return;
        game.cancelModes();
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

    if (state.redeployArmyId !== null) {
        if (game.redeploy(state.redeployArmyId, site)) {
            sound.play("move");
            return;
        }
        game.cancelRedeploy();
    }

    const army = game.selectedArmy();
    if (army && army.province !== site) {
        if (game.reachFor(army).cost.has(site)) {
            if (game.moveArmy(army.id, site)) return;
        }
        if (game.targetsFor(army).includes(site)) {
            if (game.attack(army.id, site)) return;
        }
        const occupant = armyAt(state, site);
        if (occupant && occupant.nation === 0) {
            game.select(site);
            sound.play("select");
            return;
        }
        if (!army.moved && !army.acted) {
            const hostile = isHostileProvince(state, army.nation, site);
            const own = state.provinces[site].owner === army.nation;
            if ((hostile || own) && marchPath(state, army, site) !== null) {
                if (game.orderMarch(army.id, site, hostile)) {
                    sound.play("select");
                    ui?.toast(hostile ? "远征命令已下达：抵达后自动进攻" : "行军命令已下达");
                    return;
                }
            }
        }
    }

    game.select(site);
    sound.play("select");
}

function startGame(state: GameState): void {
    lastSettings = { seed: state.settings.seed, mapSize: state.settings.mapSize, nationCount: state.settings.nationCount };
    soundUnsub?.();
    renderer?.destroy();
    ui?.destroy();

    engine = new GameEngine(state);
    renderer = new MapRenderer(canvas, engine, handleCellClick);
    ui = new GameUI(engine, sound, {
        onNewGame: () => {
            seedInput.value = String(randomSeed());
            pendingState = null;
            generationToken++;
            pickerOverlay.classList.add("hidden");
            genOverlay.classList.add("hidden");
            startOverlay.classList.remove("hidden");
        },
        onRestart: () => beginCampaign(randomSeed(), lastSettings.mapSize, lastSettings.nationCount),
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
    });
    soundUnsub = engine.subscribe((event: EngineEvent) => {
        switch (event.type) {
            case "move": {
                const army = engine?.state.armies.get(event.armyId);
                const site = event.path[event.path.length - 1] ?? army?.province ?? null;
                sound.play("move", soundContext(site, army?.nation === 0));
                break;
            }
            case "battle-start":
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
            case "peace":
                sound.play("select", soundContext(null, event.a === 0 || event.b === 0));
                break;
            default:
                break;
        }
    });
    renderer.centerOnCapital();
    startOverlay.classList.add("hidden");
    pickerOverlay.classList.add("hidden");
    genOverlay.classList.add("hidden");
}

/** Generate the world behind a waiting overlay, then offer the generated nations. */
function beginCampaign(seed: number, mapSize: MapSizeId, nationCount: number): void {
    lastSettings = { seed, mapSize, nationCount };
    const token = ++generationToken;
    pendingState = null;
    nationOptions.innerHTML = "";
    startOverlay.classList.add("hidden");
    pickerOverlay.classList.add("hidden");
    genStatus.textContent = "绘制大陆、划分州郡、推演列国……";
    genOverlay.classList.remove("hidden");
    const started = performance.now();
    window.setTimeout(() => {
        if (token !== generationToken) return;
        const state = generateWorld({ seed, mapSize, nationCount });
        pendingState = state;
        renderNationOptions(state);
        const remaining = Math.max(0, 700 - (performance.now() - started));
        window.setTimeout(() => {
            if (token !== generationToken || !pendingState) return;
            genOverlay.classList.add("hidden");
            pickerOverlay.classList.remove("hidden");
        }, remaining);
    }, 30);
}

function renderNationOptions(state: GameState): void {
    nationOptions.innerHTML = state.nations.map((nation) => {
        const provinces = state.provinces.filter((province) => province.owner === nation.id).length;
        const armies = [...state.armies.values()].filter((army) => army.nation === nation.id).length;
        const capital = state.provinces[nation.capital]?.name ?? "未知";
        return `<button class="nation-option" type="button" data-nation="${nation.id}" style="--nc:${escapeHtml(nation.color)}">
            <span class="nation-option-name"><span class="nation-swatch"></span>${escapeHtml(nation.name)}</span>
            <span class="nation-option-meta">首都 ${escapeHtml(capital)} · ${provinces} 省 · ${armies} 支军团</span>
            <span class="nation-option-meta">第 ${nation.id + 1} 号列强</span>
        </button>`;
    }).join("");
}

function chooseNation(nationId: number): void {
    const state = pendingState;
    if (!state || !Number.isInteger(nationId) || nationId < 0 || nationId >= state.nations.length) return;
    pendingState = null;
    setPlayerNation(state, nationId);
    startGame(state);
}

seedInput.value = String(randomSeed());
document.querySelector<HTMLButtonElement>("#btn-dice")?.addEventListener("click", () => {
    seedInput.value = String(randomSeed());
});
document.querySelector<HTMLButtonElement>("#btn-start")?.addEventListener("click", () => {
    sound.unlock();
    const parsed = Number(seedInput.value);
    const seed = Number.isFinite(parsed) ? Math.trunc(parsed) >>> 0 : randomSeed();
    beginCampaign(seed, sizeSelect.value as MapSizeId, Number(nationSelect.value));
});
document.querySelector<HTMLButtonElement>("#btn-random-nation")?.addEventListener("click", () => {
    if (!pendingState) return;
    chooseNation(Math.floor(Math.random() * pendingState.nations.length));
});
document.querySelector<HTMLButtonElement>("#btn-back-start")?.addEventListener("click", () => {
    pendingState = null;
    generationToken++;
    pickerOverlay.classList.add("hidden");
    genOverlay.classList.add("hidden");
    startOverlay.classList.remove("hidden");
});
nationOptions.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-nation]");
    if (!target) return;
    chooseNation(Number(target.dataset.nation));
});
document.querySelector<HTMLButtonElement>("#btn-howto")?.addEventListener("click", () => guide.open());
document.querySelector<HTMLButtonElement>("#btn-help")?.addEventListener("click", () => {
    sound.unlock();
    guide.open();
});
seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") document.querySelector<HTMLButtonElement>("#btn-start")?.click();
});

document.querySelector<HTMLButtonElement>("#zoom-in")?.addEventListener("click", () => renderer?.zoomBy(1.3));
document.querySelector<HTMLButtonElement>("#zoom-out")?.addEventListener("click", () => renderer?.zoomBy(1 / 1.3));
document.querySelector<HTMLButtonElement>("#zoom-fit")?.addEventListener("click", () => renderer?.fitMap());

// Live map behind the start screen.
startGame(generateWorld({ seed: randomSeed(), mapSize: "small", nationCount: 4 }));
startOverlay.classList.remove("hidden");

if (import.meta.env.DEV) {
    Object.defineProperty(window, "__nitro", {
        get: () => ({ engine, renderer, ui }),
    });
}