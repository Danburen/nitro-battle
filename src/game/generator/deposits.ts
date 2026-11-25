import { Biome } from "../../terrain/biome.ts";
import type { BiomeMap } from "../../terrain/biome.ts";
import { LCGRandom } from "../../utils/LCGRandom.ts";
import { DEPOSIT_BIOME_RULES, RESOURCE_DEPOSIT_MAX_LEVEL } from "../types/economy.ts";
import type { DepositRoll } from "../types/economy.ts";
import type { Province } from "../types/entities.ts";

/** Separate stream: deposit rolls must not perturb city/state/nation generation. */
export const DEPOSIT_RANDOM_SALT = 0x0d3b0f17;

/**
 * Assign raw/strategic mine levels from terrain after provinces and biomes exist.
 * Independent rolls let a province hold neither, one, or both deposits.
 */
export function generateProvinceDeposits(provinces: Province[], terrain: BiomeMap, seed: number): void {
    const rand = new LCGRandom(seed ^ DEPOSIT_RANDOM_SALT);
    for (const province of provinces) {
        const biome = terrain.biomeAt(province.site);
        const rule = DEPOSIT_BIOME_RULES[biome] ?? DEPOSIT_BIOME_RULES[Biome.OCEAN];
        const land = terrain.passable[province.site] === 1;
        province.deposits = {
            raw: land ? rollDepositLevel(rule.raw, rand) : 0,
            strategic: land ? rollDepositLevel(rule.strategic, rand) : 0,
        };
    }
}

function rollDepositLevel(roll: DepositRoll, rand: LCGRandom): number {
    if (rand.nextFloat() >= roll.chance) return 0;
    const weights = roll.levelWeights;
    const total = weights[0] + weights[1] + weights[2];
    if (total <= 0) return 0;

    let pick = rand.nextFloat() * total;
    for (let level = 1; level <= RESOURCE_DEPOSIT_MAX_LEVEL; level++) {
        pick -= weights[level - 1];
        if (pick < 0) return level;
    }
    return RESOURCE_DEPOSIT_MAX_LEVEL;
}
