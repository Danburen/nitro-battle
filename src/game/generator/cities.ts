import { Biome } from "../terrain/biome.ts";
import type { BiomeMap } from "../terrain/biome.ts";
import type { VoronoiGraph } from "../terrain/voronoi/index.ts";
import type { LCGRandom } from "../../utils/LCGRandom.ts";
import { NEUTRAL } from "../types/world.ts";
import type { Province } from "../types/entities.ts";

const BIOME_INCOME: Readonly<Record<number, number>> = {
    [Biome.PLAINS]: 5,
    [Biome.FOREST]: 4,
    [Biome.HILLS]: 3,
    [Biome.MOUNTAINS]: 2,
    [Biome.DESERT]: 2,
    [Biome.MARSH]: 2,
    [Biome.TUNDRA]: 2,
    [Biome.BEACH]: 3,
    [Biome.ICE]: 1,
    [Biome.BARE]: 2,
};

const BIOME_DEFENSE: Readonly<Record<number, number>> = {
    [Biome.PLAINS]: 1.0,
    [Biome.FOREST]: 1.25,
    [Biome.HILLS]: 1.4,
    [Biome.MOUNTAINS]: 1.6,
    [Biome.DESERT]: 0.9,
    [Biome.MARSH]: 1.15,
    [Biome.TUNDRA]: 1.1,
    [Biome.BEACH]: 0.9,
    [Biome.ICE]: 0.9,
    [Biome.BARE]: 1.0,
};

export function createProvinces(graph: VoronoiGraph, terrain: BiomeMap): Province[] {
    return graph.sites.map((_, site) => {
        const biome = terrain.biomeAt(site);
        const land = terrain.passable[site] === 1;
        return {
            site,
            name: "",
            owner: NEUTRAL,
            legalOwner: NEUTRAL,
            isCity: false,
            isCapital: false,
            garrison: 0,
            garrisonMax: 0,
            income: land ? (BIOME_INCOME[biome] ?? 8) : 0,
            defense: land ? (BIOME_DEFENSE[biome] ?? 1) : 0,
            population: 1,
            coreNation: NEUTRAL,
            occupation: 0,
            buildings: [],
            deposits: { raw: 0, strategic: 0 },
            stateId: -1,
        };
    });
}

export function seedCities(provinces: Province[], mainland: readonly number[], rand: LCGRandom): void {
    for (const site of mainland) {
        if (!provinces[site].isCity && rand.nextFloat() < 0.13) makeCity(provinces[site], false);
    }
}

export function makeCity(province: Province, capital: boolean): void {
    if (province.isCapital || (province.isCity && !capital)) return;
    if (capital) {
        province.income += province.isCity ? 4 : 12;
        province.defense += province.isCity ? 0.15 : 0.4;
        province.isCapital = true;
    } else {
        province.income += 8;
        province.defense += 0.25;
    }
    province.isCity = true;
}
