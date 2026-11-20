import "./style.css";
import { GameEngine } from "./game/engine.ts";
import type { EngineEvent } from "./game/types.ts";
import { MapRenderer } from "./render/renderer.ts";
import { GameUI } from "./ui/index.ts";
import { mountLayout } from "./ui/layout.ts";
import { SoundManager } from "./audio.ts";
import { initGuide } from "./guide.ts";
import type { MapSizeId } from "./game/types.ts";
import { armyAt, isHostileProvince, marchPath } from "./game/rules.ts";

const app = document.querySelector<HTMLDivElement>("#app") as HTMLDivElement;
mountLayout(app);

const sound = new SoundManager();
const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas") as HTMLCanvasElement;
const startOverlay = document.querySelector<HTMLElement>("#start-overlay") as HTMLElement;
const seedInput = document.querySelector<HTMLInputElement>("#seed-input") as HTMLInputElement;
const sizeSelect = document.querySelector<HTMLSelectElement>("#size-select") as HTMLSelectElement;
const nationSelect = document.querySelector<HTMLSelectElement>("#nation-select") as HTMLSelectElement;
const guide = initGuide();

let engine: GameEngine | null = null;
let renderer: MapRenderer | null = null;
let ui: GameUI | null = null;
let soundUnsub: (() => void) | null = null;
let lastSettings = { seed: 0, mapSize: "standard" as MapSizeId, nationCount: 3 };

function randomSeed(): number {
    return Math.floor(Math.random() * 1_000_000);
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

function startGame(seed: number, mapSize: MapSizeId, nationCount: number): void {
    lastSettings = { seed, mapSize, nationCount };
    soundUnsub?.();
    renderer?.destroy();
    ui?.destroy();

    engine = GameEngine.create(seed, mapSize, nationCount);
    renderer = new MapRenderer(canvas, engine, handleCellClick);
    ui = new GameUI(engine, sound, {
        onNewGame: () => {
            seedInput.value = String(randomSeed());
            startOverlay.classList.remove("hidden");
        },
        onRestart: () => startGame(randomSeed(), lastSettings.mapSize, lastSettings.nationCount),
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
            case "move":
                sound.play("move");
                break;
            case "battle-start":
            case "combat":
                sound.play("attack");
                break;
            case "capture":
                sound.play("capture");
                break;
            case "deploy":
            case "build":
                sound.play("recruit");
                break;
            case "war":
                sound.play("attack");
                break;
            case "peace":
                sound.play("select");
                break;
            default:
                break;
        }
    });
    renderer.centerOnCapital();
    startOverlay.classList.add("hidden");
}

seedInput.value = String(randomSeed());
document.querySelector<HTMLButtonElement>("#btn-dice")?.addEventListener("click", () => {
    seedInput.value = String(randomSeed());
});
document.querySelector<HTMLButtonElement>("#btn-start")?.addEventListener("click", () => {
    sound.unlock();
    const parsed = Number(seedInput.value);
    const seed = Number.isFinite(parsed) ? Math.trunc(parsed) >>> 0 : randomSeed();
    startGame(seed, sizeSelect.value as MapSizeId, Number(nationSelect.value));
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
startGame(randomSeed(), "standard", 3);
startOverlay.classList.remove("hidden");

if (import.meta.env.DEV) {
    Object.defineProperty(window, "__nitro", {
        get: () => ({ engine, renderer, ui }),
    });
}