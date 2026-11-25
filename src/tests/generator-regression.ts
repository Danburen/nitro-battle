import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import { nationDisplayColor } from "../game/access.ts";
import { claimProvince } from "../game/conquest.ts";
import { factoryTotals } from "../game/economy.ts";
import { generateWorld } from "../game/generator/index.ts";
import { makeCity } from "../game/generator/cities.ts";
import { assignStateTerritories } from "../game/generator/nations.ts";
import { MAX_HP } from "../game/types/unit.ts";
import { NEUTRAL } from "../game/types/world.ts";
import { START_ORG } from "../game/types/organization.ts";
import type { GameState } from "../game/types/state.ts";
import type { Province, StateRegion } from "../game/types/entities.ts";
import type { MapSizeId } from "../types/settings.ts";

function connected(sites: readonly number[], neighbors: (site: number) => readonly number[]): boolean {
    if (sites.length === 0) return false;
    const allowed = new Set(sites);
    const visited = new Set([sites[0]]);
    const open = [sites[0]];
    while (open.length > 0) {
        for (const next of neighbors(open.pop()!)) {
            if (!allowed.has(next) || visited.has(next)) continue;
            visited.add(next);
            open.push(next);
        }
    }
    return visited.size === allowed.size;
}

function checkOpening(state: GameState): void {
    const { graph, terrain, provinces, states, nations } = state;
    const neighbors = (site: number) => graph.adjacency[site].map((edge) => edge.site);
    const assigned = new Set<number>();
    for (const region of states) {
        assert.equal(region, states[region.id]);
        assert.ok(region.provinces.includes(region.center));
        assert.ok(provinces[region.center].isCity);
        assert.ok(connected(region.provinces, neighbors), `disconnected state ${region.id}`);
        for (const site of region.provinces) {
            assert.ok(!assigned.has(site), `duplicate province ${site}`);
            assigned.add(site);
            assert.equal(terrain.passable[site], 1);
            assert.equal(provinces[site].stateId, region.id);
            assert.equal(provinces[site].owner, provinces[region.center].owner, `mixed state ${region.id}`);
        }
        const capital = provinces[region.center].isCapital;
        assert.equal(region.factories, Math.min(region.provinces.length, capital ? 2 : 1));
        assert.equal(region.infrastructure, 1);
        assert.deepEqual(region.buildings, capital ? ["farm", "admin"] : ["farm"]);
    }
    const mainland = new Set<number>([nations[0].capital]);
    const open = [nations[0].capital];
    while (open.length > 0) {
        for (const next of neighbors(open.pop()!)) {
            if (!terrain.passable[next] || mainland.has(next)) continue;
            mainland.add(next);
            open.push(next);
        }
    }
    for (const province of provinces) {
        if (!terrain.passable[province.site]) {
            assert.equal(province.stateId, -1);
            assert.equal(province.owner, NEUTRAL);
            continue;
        }
        assert.ok(assigned.has(province.site));
        assert.ok(province.owner >= 0, `neutral land province ${province.site}`);
        assert.equal(province.coreNation, province.owner);
        assert.equal(province.legalOwner, province.owner);
        assert.equal(province.occupation, 100);
        assert.equal(province.garrison, province.garrisonMax);
        assert.deepEqual(province.buildings, []);
    }
    // Mode A: every land component belongs to nations; overseas components stay whole.
    const components: number[][] = [];
    const seen = new Set<number>();
    for (const province of provinces) {
        if (!terrain.passable[province.site] || seen.has(province.site)) continue;
        const component = [province.site];
        seen.add(province.site);
        for (let head = 0; head < component.length; head++) {
            for (const next of neighbors(component[head])) {
                if (!terrain.passable[next] || seen.has(next)) continue;
                seen.add(next);
                component.push(next);
            }
        }
        components.push(component);
    }
    const overseas = components.filter((component) => !mainland.has(component[0]));
    for (const component of overseas) {
        const owners = new Set(component.map((site) => provinces[site].owner));
        assert.equal(owners.size, 1, `split overseas component at ${component[0]}`);
    }
    const maxState = Math.max(...states.map((region) => region.provinces.length));
    // One border state can be an articulation point; larger maps need up to two states of slack.
    const tolerance = Math.max(maxState, ...overseas.map((component) => component.length)) * 2;
    const target = provinces.filter((province) => terrain.passable[province.site]).length / nations.length;
    for (const nation of nations) {
        const owned = provinces.filter((province) => province.owner === nation.id).map((province) => province.site);
        const ownedMainland = owned.filter((site) => mainland.has(site));
        assert.ok(connected(ownedMainland, neighbors), `disconnected mainland nation ${nation.id}`);
        assert.ok(Math.abs(owned.length - target) <= tolerance,
            `nation ${nation.id}: ${owned.length} provinces vs target ${target.toFixed(2)}, tolerance ${tolerance}`);
        const capital = provinces[nation.capital];
        assert.equal(capital.owner, nation.id);
        assert.equal(states[capital.stateId].center, nation.capital);
        assert.ok(capital.isCapital && capital.isCity && mainland.has(nation.capital));
        assert.deepEqual([nation.funds, nation.manpower, nation.industry, nation.politicalPower], [300, 500, 30, 20]);
        assert.deepEqual(nation.policies, { economy: "balanced", conscription: "service", occupation: "balanced" });
        const totals = factoryTotals(state, nation.id);
        assert.equal(totals.idle, Math.max(1, Math.ceil(totals.total / 3)));
        const armies = [...state.armies.values()].filter((army) => army.nation === nation.id);
        const cities = owned.filter((site) => provinces[site].isCity && !provinces[site].isCapital);
        assert.equal(armies.length, 1 + Math.min(cities.length, 2));
        assert.deepEqual(armies[0].regiments.map((regiment) => regiment.kind), [0, 0, 0, 1]);
        for (const army of armies) {
            assert.equal(state.armyAt[army.province], army.id);
            assert.equal(provinces[army.province].owner, nation.id);
            assert.equal(army.org, START_ORG);
            assert.ok(army.regiments.every((regiment) => regiment.hp === MAX_HP));
            assert.equal(army.moved, false);
            assert.equal(army.acted, false);
        }
    }
    assert.equal(provinces.filter((province) => province.isCapital).length, nations.length);
    assert.equal(state.day, 1);
    assert.equal(state.seasonIndex, 0);
    assert.ok(state.war.every((row) => row.every((atWar) => !atWar)));
    assert.deepEqual([state.battles, state.construction, state.deployments], [[], [], []]);
    assert.ok(state.supply && !state.supplyDirty);
    assert.ok([...state.supply.level].every(Number.isFinite));
    assert.equal(new Set([...provinces, ...states].map((entry) => entry.name)).size, provinces.length + states.length);
}

for (const mapSize of ["small", "standard", "large"] as MapSizeId[]) {
    for (const nationCount of [2, 3, 4]) {
        for (const seed of [0, 42, 20261120, 0xffffffff]) {
            test(`whole, connected, balanced opening: ${mapSize}/${nationCount} nations/seed ${seed}`, () => {
                const state = generateWorld({ seed, mapSize, nationCount });
                assert.equal(state.nations.length, nationCount);
                checkOpening(state);
            });
        }
    }
}

test("large line-ups mix great and minor powers", () => {
    for (const nationCount of [5, 6, 8, 10, 12]) {
        for (const seed of [42, 2026]) {
            const state = generateWorld({ seed, mapSize: "standard", nationCount });
            // Carved vassals are extra nations on top of the requested line-up.
            assert.ok(state.nations.length >= nationCount && state.nations.length <= nationCount + 3);
            const sizes = state.nations.map((nation) =>
                state.provinces.filter((province) => province.owner === nation.id).length);
            assert.ok(sizes.every((size) => size > 0), `empty nation: ${sizes.join(",")}`);
            assert.ok(Math.max(...sizes) >= Math.min(...sizes) * 1.8,
                `${nationCount} nations/seed ${seed}: ${sizes.join(",")}`);
            for (const nation of state.nations) {
                assert.equal(state.provinces[nation.capital].owner, nation.id);
                assert.ok(state.provinces[nation.capital].isCapital);
            }
        }
    }
});

test("custom cell counts keep the map-size aspect ratio and honor terrain tuning", () => {
    const standard = generateWorld({ seed: 9, mapSize: "standard", nationCount: 4 });
    const dense = generateWorld({ seed: 9, mapSize: "standard", nationCount: 4, mapCells: 2600 });
    assert.ok(dense.graph.sites.length > standard.graph.sites.length);
    assert.ok(Math.abs(dense.graph.domain.width / dense.graph.domain.height
        - standard.graph.domain.width / standard.graph.domain.height) < 0.02);
    const ocean = generateWorld({ seed: 9, mapSize: "small", nationCount: 4, terrain: { seaLevel: 0.4 } });
    const land = generateWorld({ seed: 9, mapSize: "small", nationCount: 4, terrain: { seaLevel: 0.1 } });
    const passable = (state: ReturnType<typeof generateWorld>): number =>
        state.provinces.filter((province) => state.terrain.passable[province.site]).length;
    assert.ok(passable(ocean) < passable(land));
});

test("nation strength balance compensates small starts and leaves great powers alone", () => {
    const settings = { seed: 42, mapSize: "standard" as const, nationCount: 6 };
    const base = generateWorld(settings);
    const balanced = generateWorld({ ...settings, balanceNations: true });
    // Compensation only touches starting buildings; territory and capitals stay identical.
    assert.deepEqual(balanced.provinces.map((province) => province.owner), base.provinces.map((province) => province.owner));
    assert.deepEqual(balanced.nations.map((nation) => nation.capital), base.nations.map((nation) => nation.capital));
    assert.equal(base.settings.balanceNations, undefined);

    const perNation = (state: typeof base, value: (region: typeof state.states[number], nationId: number) => number): number[] =>
        state.nations.map((nation) => state.states.reduce((sum, region) =>
            sum + (state.provinces[region.center].owner === nation.id ? value(region, nation.id) : 0), 0));
    const farmCount = (region: typeof base.states[number]): number =>
        region.buildings.filter((building) => building === "farm").length;
    const sizes = base.nations.map((nation) =>
        base.provinces.filter((province) => province.owner === nation.id).length);
    const baseFarms = perNation(base, farmCount);
    const baseInfrastructure = perNation(base, (region) => region.infrastructure);
    const extraFarms = perNation(balanced, farmCount).map((value, index) => value - baseFarms[index]);
    const extraInfrastructure = perNation(balanced, (region) => region.infrastructure)
        .map((value, index) => value - baseInfrastructure[index]);

    assert.ok(extraFarms.some((value) => value > 0), `no compensation: ${extraFarms.join(",")}`);
    assert.ok(extraInfrastructure.some((value) => value > 0), `no infrastructure: ${extraInfrastructure.join(",")}`);
    for (let index = 0; index < base.nations.length; index++) {
        assert.ok(extraFarms[index] >= 0 && extraFarms[index] <= 3, `farms ${extraFarms[index]}`);
        assert.ok(extraInfrastructure[index] >= 0 && extraInfrastructure[index] <= 3,
            `infrastructure ${extraInfrastructure[index]}`);
        if (sizes[index] === Math.max(...sizes)) {
            assert.equal(extraFarms[index], 0);
            assert.equal(extraInfrastructure[index], 0);
        }
        if (sizes[index] === Math.min(...sizes)) {
            assert.ok(extraFarms[index] > 0, `smallest nation not compensated: ${sizes.join(",")}`);
        }
    }
});

test("world generation seeds one-layer vassals, both carved and independent", () => {
    const sites = new Set<number>();
    for (const seed of [42, 2026, 7, 11]) {
        const state = generateWorld({ seed, mapSize: "standard", nationCount: 10 });
        const vassals = state.nations.filter((nation) => (nation.overlord ?? -1) >= 0);
        assert.ok(vassals.length > 0, `seed ${seed} has no vassals`);
        assert.ok(vassals.some((nation) => nation.id >= 10), `seed ${seed} has no carved vassal`);
        assert.ok(vassals.some((nation) => nation.id < 10), `seed ${seed} has no independent vassal`);
        for (const vassal of vassals) {
            const overlord = state.nations[vassal.overlord as number];
            assert.ok(overlord?.alive);
            assert.equal(overlord.id, vassal.overlord);
            assert.notEqual(vassal.id, overlord.id);
            assert.equal(overlord.overlord ?? -1, -1, "vassals never form chains");
            assert.ok(state.nations.every((nation) => nation.id === vassal.id || nation.overlord !== vassal.id),
                "a vassal never rules another vassal");
            assert.ok(vassal.vassalType && ["cooperative", "autonomous", "oppressive"].includes(vassal.vassalType));
            assert.ok(Number.isFinite(vassal.independence) && (vassal.independence ?? 0) > 0);
            assert.equal(nationDisplayColor(state, vassal.id), overlord.color);
            assert.equal(state.provinces[vassal.capital].owner, vassal.id);
            assert.equal(state.provinces[vassal.capital].isCapital, true);
            sites.add(state.provinces[vassal.capital].site);
        }
    }
    assert.ok(sites.size > 0);
});

test("same settings reproduce the entire opening", () => {
    const settings = { seed: 717, mapSize: "small" as const, nationCount: 4 };
    assert.deepEqual(generateWorld(settings), generateWorld(settings));
});

test("capital promotion adds only the difference from an existing city", () => {
    const province = { isCity: false, isCapital: false, income: 5, defense: 1 } as Province;
    makeCity(province, false);
    assert.equal(province.income, 13);
    assert.equal(province.defense, 1.25);
    makeCity(province, true);
    assert.equal(province.income, 17);
    assert.ok(Math.abs(province.defense - 1.4) < 1e-10);
    makeCity(province, true);
    makeCity(province, false);
    assert.equal(province.income, 17);
    assert.ok(Math.abs(province.defense - 1.4) < 1e-10);
    const direct = { isCity: false, isCapital: false, income: 5, defense: 1 } as Province;
    makeCity(direct, true);
    assert.deepEqual(direct, province);
});

function regions(weights: number[]): StateRegion[] {
    return weights.map((weight, id) => ({
        id, center: id, provinces: Array.from({ length: weight }, (_, site) => site), name: `S${id}`,
        culture: 0, buildings: [], factories: 0, prodFactories: 0, infrastructure: 1,
    }));
}

test("territory balancing counts provinces, not states, and gives disconnected islands whole to one nation", () => {
    const states = regions([12, 2, 2, 2, 2, 2, 2, 2, 2, 12, 20]);
    const adjacency = states.map((_, id) => id === 10 ? [] : [id - 1, id + 1].filter((next) => next >= 0 && next < 10));
    const owners = assignStateTerritories(states, adjacency, [0, 9]);
    const totals = [0, 1].map((nation) => states.reduce((sum, region) => sum + (owners[region.id] === nation ? region.provinces.length : 0), 0));
    // The island counts toward national balance, so mainland shares need not be equal.
    assert.ok(owners[10] === 0 || owners[10] === 1);
    assert.ok(totals[owners[10]] >= 20);
    assert.ok(Math.abs(totals[0] - totals[1]) <= 4);
    for (const nation of [0, 1]) {
        const mainland = states.filter((region) => region.id !== 10 && owners[region.id] === nation).map((region) => region.id);
        assert.ok(connected(mainland, (id) => adjacency[id]));
        assert.ok(mainland.reduce((sum, id) => sum + states[id].provinces.length, 0) > 0);
    }
});

test("bottlenecks and unavoidable oversized capital states never disconnect nations or move capitals", () => {
    const states = regions([30, 1, 3, 2, 4, 1, 2, 5, 7]);
    const adjacency = [[1], [0, 2, 3, 4], [1], [1, 5], [1, 6], [3, 7], [4, 8], [5], [6]];
    const capitals = [0, 7, 8];
    const owners = assignStateTerritories(states, adjacency, capitals);
    for (const [nation, capital] of capitals.entries()) {
        assert.equal(owners[capital], nation);
        assert.ok(connected(states.filter((region) => owners[region.id] === nation).map((region) => region.id), (id) => adjacency[id]));
    }
    assert.deepEqual(owners, assignStateTerritories(states, adjacency, capitals));
});

test("wartime capture of outlying provinces and state centers never transfers other provinces or legal ownership", () => {
    const engine = GameEngine.create(20261120, "small", 3);
    const state = engine.state;
    const region = state.states.find((entry) => state.provinces[entry.center].owner === 1
        && !state.provinces[entry.center].isCapital && entry.provinces.length > 1)!;
    assert.ok(region);
    const outlying = region.provinces.find((site) => site !== region.center)!;
    const initialOwners = state.provinces.map((province) => province.owner);
    claimProvince(engine, outlying, 0, 1);
    assert.equal(state.provinces[outlying].owner, 0);
    assert.equal(state.provinces[region.center].owner, 1);
    for (const province of state.provinces) {
        if (province.site !== outlying) assert.equal(province.owner, initialOwners[province.site]);
    }
    claimProvince(engine, region.center, 0, 1);
    assert.equal(state.provinces[region.center].owner, 0);
    for (const site of region.provinces) {
        assert.equal(state.provinces[site].legalOwner, 1);
        assert.equal(state.provinces[site].owner, site === outlying || site === region.center ? 0 : 1);
    }
    assert.equal(state.nations[1].alive, true);
    for (const province of state.provinces) {
        if (!region.provinces.includes(province.site)) assert.equal(province.owner, initialOwners[province.site]);
    }
});
