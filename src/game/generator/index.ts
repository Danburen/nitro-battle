import { LCGRandom } from "../../utils/LCGRandom.ts";
import type { GameState } from "../types/state.ts";
import type { GameSettings } from "../../types/settings.ts";
import { createProvinces, seedCities } from "./cities.ts";
import { initializeWorld } from "./initialization.ts";
import { generateMap } from "./map.ts";
import { NameGenerator } from "./names.ts";
import { generateNations } from "./nations.ts";
import { generateStates } from "./states.ts";

/** One visible step of world generation; the UI paints a progress bar from these. */
export interface WorldBuildStage {
    readonly label: string;
    /** 0–1 completion after this stage finishes. */
    readonly progress: number;
}

/**
 * Staged world generation. Draining it synchronously yields `generateWorld`;
 * the browser driver can await a frame between steps to keep the bar moving.
 */
export function* buildWorld(settings: GameSettings): Generator<WorldBuildStage, GameState, void> {
    const rand = new LCGRandom(settings.seed ^ 0x9e3779b9);
    yield { label: "绘制大陆与海岸线", progress: 0.08 };
    const { graph, terrain, components } = generateMap(settings);
    const mainland = components.reduce((largest, sites) => sites.length > largest.length ? sites : largest, [] as number[]);
    yield { label: "划分省界与州郡", progress: 0.32 };
    const provinces = createProvinces(graph, terrain);
    seedCities(provinces, mainland, rand);
    yield { label: "建立城市与交通", progress: 0.52 };
    const names = new NameGenerator(new LCGRandom(settings.seed ^ 0x5eed));
    const states = generateStates(graph, terrain, provinces, components, rand, names, settings);
    yield { label: "推演列国与疆域", progress: 0.74 };
    const nations = generateNations(graph, provinces, states, mainland, settings.nationCount, rand, names, settings.seed);
    yield { label: "部署军团与补给线", progress: 0.9 };
    const state: GameState = {
        settings,
        graph,
        terrain,
        provinces,
        states,
        nations,
        armies: new Map(),
        armyAt: Array.from({ length: graph.sites.length }, () => null),
        battles: [],
        deployments: [],
        construction: [],
        supply: null,
        supplyDirty: true,
        day: 1,
        seasonIndex: 0,
        selected: null,
        selectedArmyId: null,
        redeployArmyId: null,
        war: nations.map(() => nations.map(() => false)),
        warSince: nations.map(() => nations.map(() => -1)),
        peaceOffers: [],
        truce: nations.map(() => nations.map(() => -1)),
        peaceCooldown: nations.map(() => -1),
        claims: [],
        diplomaticActions: [],
        wars: [],
        alliances: [],
        diplomaticRequests: [],
        allianceCooldown: nations.map(() => nations.map(() => -1)),
        vassalCooldown: nations.map(() => nations.map(() => -1)),
        nextDiplomaticActionId: 1,
        nextAllianceId: 1,
        nextRequestId: 1,
        log: [],
        winner: null,
        nextArmyId: 1,
        nextRegimentId: 1,
        nextDeploymentId: 1,
        nextConstructionId: 1,
        stats: { battles: 0, captures: 0, recruited: 0, losses: 0 },
    };
    initializeWorld(state, rand);
    return state;
}

export function generateWorld(settings: GameSettings): GameState {
    const stages = buildWorld(settings);
    let step = stages.next();
    while (!step.done) step = stages.next();
    return step.value;
}
