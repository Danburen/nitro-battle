import { LCGRandom } from "../../utils/LCGRandom.ts";
import type { GameSettings, GameState } from "../types.ts";
import { createProvinces, seedCities } from "./cities.ts";
import { initializeWorld } from "./initialization.ts";
import { generateMap } from "./map.ts";
import { NameGenerator } from "./names.ts";
import { generateNations } from "./nations.ts";
import { generateStates } from "./states.ts";

export function generateWorld(settings: GameSettings): GameState {
    const rand = new LCGRandom(settings.seed ^ 0x9e3779b9);
    const { graph, terrain, components } = generateMap(settings);
    const mainland = components.reduce((largest, sites) => sites.length > largest.length ? sites : largest, [] as number[]);
    const provinces = createProvinces(graph, terrain);
    seedCities(provinces, mainland, rand);
    const names = new NameGenerator(new LCGRandom(settings.seed ^ 0x5eed));
    const states = generateStates(graph, terrain, provinces, components, rand, names, settings);
    const nations = generateNations(graph, provinces, states, mainland, settings.nationCount, rand);
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
        nextDiplomaticActionId: 1,
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
