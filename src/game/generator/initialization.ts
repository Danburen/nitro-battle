import { t } from "../../i18n/index.ts";
import { chipToken } from "../../utils/spec.ts";
import { Biome } from "../terrain/biome.ts";
import { periodicDistance } from "../terrain/voronoi/index.ts";
import type { LCGRandom } from "../../utils/LCGRandom.ts";
import { spawnArmy } from "../armies.ts";
import { garrisonCapacity } from "../battle.ts";
import { armyUnitCap } from "../provinceArmy.ts";
import { computeSupply } from "../supply.ts";
import { NEUTRAL } from "../types/world.ts";
import { VASSAL_PROFILES } from "../vassal.ts";
import { START_ORG } from "../types/organization.ts";
import { UnitKind } from "../types/unit.ts";
import type { GameState } from "../types/state.ts";
import { compensateStartingNations, ensureStartingResourceDeposits } from "./balance.ts";

const POP_BIOMES = new Set<number>([Biome.PLAINS, Biome.FOREST, Biome.HILLS, Biome.BEACH]);

export function initializeWorld(state: GameState, rand: LCGRandom): void {
    const { terrain, provinces, states, nations } = state;
    for (const region of states) {
        const capital = provinces[region.center].isCapital;
        region.factories = Math.min(region.provinces.length, capital ? 2 : 1);
        region.prodFactories = region.factories;
        region.buildings.push("farm");
        if (capital) region.buildings.push("admin");
    }
    for (const nation of nations) {
        const owned = states.filter((region) => provinces[region.center].owner === nation.id);
        const total = owned.reduce((sum, region) => sum + region.factories, 0);
        let prod = total - Math.max(1, Math.ceil(total / 3));
        for (const region of owned) {
            region.prodFactories = Math.max(0, Math.min(region.factories, prod));
            prod -= region.prodFactories;
        }
    }
    if (state.settings.balanceNations) compensateStartingNations(state);
    ensureStartingResourceDeposits(state);
    for (const province of provinces) {
        province.coreNation = province.owner;
        province.legalOwner = province.owner;
        province.occupation = 100;
        if (!terrain.passable[province.site]) continue;
        province.population = 1 + (POP_BIOMES.has(terrain.biomeAt(province.site)) ? 1 : 0)
            + (province.isCity ? 1 : 0) + (province.isCapital ? 2 : 0) + rand.nextInt(0, 2);
        province.garrisonMax = garrisonCapacity(province);
        province.garrison = province.garrisonMax;
    }
    for (const nation of nations) {
        const cap = armyUnitCap(state, nation.id);
        let units = 0;
        const spawn = (site: number, kinds: readonly UnitKind[]): boolean => {
            if (units + kinds.length > cap) return false;
            spawnArmy(state, nation.id, site, [...kinds], START_ORG);
            units += kinds.length;
            return true;
        };
        spawn(nation.capital, [UnitKind.INFANTRY, UnitKind.INFANTRY, UnitKind.INFANTRY, UnitKind.TANK]);
        const cities = provinces.filter((province) => province.owner === nation.id && province.isCity && !province.isCapital)
            .sort((a, b) => periodicDistance(state.graph.sites[a.site], state.graph.sites[nation.capital], state.graph.domain)
                - periodicDistance(state.graph.sites[b.site], state.graph.sites[nation.capital], state.graph.domain));
        for (const city of cities.slice(0, 2)) {
            if (!spawn(city.site, [UnitKind.INFANTRY, UnitKind.INFANTRY])) spawn(city.site, [UnitKind.INFANTRY]);
        }
    }
    state.supply = computeSupply(state);
    state.supplyDirty = false;
    const chips = nations.map((nation) => chipToken(nation.color, nation.name));
    state.log.push({
        day: 1,
        text: t("game.generator.initial.battleStart", { nations: chips.join(" ") }),
        tone: "system",
        nationId: NEUTRAL,
    });
    const vassalLines = nations
        .filter((nation) => nation.alive && (nation.overlord ?? -1) >= 0)
        .map((nation) => `${nation.name}（${VASSAL_PROFILES[nation.vassalType ?? "cooperative"].short}）→ ${nations[nation.overlord as number]?.name ?? "?"}`);
    if (vassalLines.length > 0) {
        state.log.push({
            day: 1,
            text: t("game.generator.initial.vassalLayout", { lines: vassalLines.join(" · ") }),
            tone: "diplo",
            nationId: NEUTRAL,
        });
    }
}
