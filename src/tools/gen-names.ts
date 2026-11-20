/**
 * Standalone place-name pool generator.
 *   node src/tools/gen-names.ts [--seed N] [--count N] [--culture ID|all] [--terrain CLASS|all] [--out FILE]
 * Prints sample names per culture/terrain, or writes a JSON pool with --out.
 */
import { writeFileSync } from "node:fs";
import { LCGRandom } from "../utils/LCGRandom.ts";
import { CULTURES, NameGenerator, TERRAIN_CLASSES } from "../game/generator/names.ts";
import type { TerrainClass } from "../game/generator/names.ts";

function argValue(flag: string, fallback: string): string {
    const index = process.argv.indexOf(flag);
    return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const seed = Number(argValue("--seed", "12345"));
const count = Math.max(1, Number(argValue("--count", "6")));
const cultureArg = argValue("--culture", "all");
const terrainArg = argValue("--terrain", "all");
const out = argValue("--out", "");

const cultures = cultureArg === "all"
    ? CULTURES.map((_, id) => id)
    : [Number(cultureArg)];
const terrains: TerrainClass[] = terrainArg === "all"
    ? [...TERRAIN_CLASSES]
    : [terrainArg as TerrainClass];

const rand = new LCGRandom(Number.isFinite(seed) ? seed : 12345);
const generator = new NameGenerator(rand);

if (out !== "") {
    const pools: Record<string, Record<string, string[]>> = {};
    for (const culture of cultures) {
        const byTerrain: Record<string, string[]> = {};
        for (const terrain of terrains) {
            byTerrain[terrain] = Array.from({ length: count }, () => generator.provinceName(culture, terrain));
        }
        pools[CULTURES[culture].name] = byTerrain;
    }
    writeFileSync(out, JSON.stringify(pools, null, 2), "utf8");
    console.log(`written ${out}`);
} else {
    for (const culture of cultures) {
        for (const terrain of terrains) {
            const names = Array.from({ length: count }, () => generator.provinceName(culture, terrain));
            console.log(`${CULTURES[culture].name} / ${terrain}: ${names.join("、")}`);
        }
        const regions = Array.from({ length: count }, () => generator.regionName(culture, "plain"));
        console.log(`${CULTURES[culture].name} / 州: ${regions.join("、")}`);
    }
}