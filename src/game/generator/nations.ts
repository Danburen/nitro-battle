import { periodicDistance } from "../../terrain/voronoi/index.ts";
import type { VoronoiGraph } from "../../terrain/voronoi/index.ts";
import type { LCGRandom } from "../../utils/LCGRandom.ts";
import { DEFAULT_POLICIES } from "../types/policy.ts";
import { NEUTRAL } from "../types/world.ts";
import { START_FUNDS, START_INDUSTRY, START_MANPOWER, START_PP } from "../types/economy.ts";
import { NATION_COUNT_MAX } from "../../types/settings.ts";
import type { Nation, Province, StateRegion } from "../types/entities.ts";
import type { VassalType } from "../types/diplomacy.ts";
import { aiTendencyDeck } from "../ai/tendencies.ts";
import type { AITendencyId } from "../ai/types.ts";
import { VASSAL_PROFILES } from "../vassal.ts";
import { makeCity } from "./cities.ts";
import type { NameGenerator } from "./names.ts";

export function stateAdjacency(graph: VoronoiGraph, provinces: readonly Province[], states: readonly StateRegion[]): number[][] {
    return states.map((region) => {
        const neighbors = new Set<number>();
        for (const site of region.provinces) {
            for (const edge of graph.adjacency[site]) {
                const neighbor = provinces[edge.site].stateId;
                if (neighbor >= 0 && neighbor !== region.id) neighbors.add(neighbor);
            }
        }
        return [...neighbors].sort((a, b) => a - b);
    });
}

function pickCapitalStates(graph: VoronoiGraph, states: readonly StateRegion[], candidates: readonly number[], count: number, rand: LCGRandom): number[] {
    const capitals = [candidates[rand.nextInt(0, candidates.length)]];
    while (capitals.length < count) {
        let best = -1;
        let bestDistance = -1;
        for (const id of candidates) {
            if (capitals.includes(id)) continue;
            const distance = Math.min(...capitals.map((capital) =>
                periodicDistance(graph.sites[states[id].center], graph.sites[states[capital].center], graph.domain)));
            if (distance > bestDistance) {
                best = id;
                bestDistance = distance;
            }
        }
        capitals.push(best);
    }
    return capitals;
}

/**
 * Relative nation sizes. A world with only a handful of nations is a clash of
 * great powers; larger line-ups also field minor powers and city-states, so the
 * map reads as big and small nations instead of equal slices.
 */
const NATION_SIZE_TIERS = [1.7, 1.5, 1.2, 1.0, 0.85, 0.7, 0.55, 0.45, 0.35, 0.28, 0.22, 0.18] as const;

export function nationSizeWeights(count: number, rand: LCGRandom): number[] {
    if (count < 5) return Array.from({ length: count }, () => 1);
    const weights: number[] = [...NATION_SIZE_TIERS.slice(0, count)];
    while (weights.length < count) weights.push(0.15);
    // Shuffle which generated nation becomes a great or minor power; the seed keeps it reproducible.
    for (let i = weights.length - 1; i > 0; i--) {
        const j = rand.nextInt(0, i + 1);
        const swap = weights[i];
        weights[i] = weights[j];
        weights[j] = swap;
    }
    return weights;
}

export function assignStateTerritories(
    states: readonly StateRegion[],
    adjacency: readonly number[][],
    capitals: readonly number[],
    weights?: readonly number[],
): Int32Array {
    const owner = new Int32Array(states.length).fill(NEUTRAL);
    const mainland = new Set<number>([capitals[0]]);
    const pending = [capitals[0]];
    while (pending.length > 0) {
        for (const neighbor of adjacency[pending.pop()!]) {
            if (mainland.has(neighbor)) continue;
            mainland.add(neighbor);
            pending.push(neighbor);
        }
    }
    const share = capitals.map((_, nation) => weights?.[nation] ?? 1);
    const totalShare = share.reduce((sum, value) => sum + value, 0);
    const totalProvinces = states.reduce((sum, region) => sum + region.provinces.length, 0);
    const targets = share.map((value) => totalProvinces * value / totalShare);
    const counts = capitals.map((id, nation) => {
        owner[id] = nation;
        return states[id].provinces.length;
    });
    const distances = capitals.map((capital) => {
        const distance = new Float64Array(states.length).fill(Infinity);
        distance[capital] = 0;
        const open = [capital];
        while (open.length > 0) {
            open.sort((a, b) => distance[b] - distance[a]);
            const current = open.pop()!;
            for (const neighbor of adjacency[current]) {
                const cost = distance[current] + states[neighbor].provinces.length;
                if (cost >= distance[neighbor]) continue;
                distance[neighbor] = cost;
                if (!open.includes(neighbor)) open.push(neighbor);
            }
        }
        return distance;
    });

    for (;;) {
        let claimed = false;
        const nations = capitals.map((_, nation) => nation).sort((a, b) => counts[a] - targets[a] - (counts[b] - targets[b]) || a - b);
        for (const nation of nations) {
            let best = -1;
            for (const id of mainland) {
                if (owner[id] !== NEUTRAL || !adjacency[id].some((neighbor) => owner[neighbor] === nation)) continue;
                if (Math.abs(counts[nation] + states[id].provinces.length - targets[nation]) >= Math.abs(counts[nation] - targets[nation])) continue;
                if (best < 0 || distances[nation][id] < distances[nation][best]) best = id;
            }
            if (best < 0) continue;
            owner[best] = nation;
            counts[nation] += states[best].provinces.length;
            claimed = true;
            break;
        }
        if (!claimed) break;
    }

    // Mode A owns every state: leftovers go to the nation with the largest remaining deficit.
    for (;;) {
        let claimed = false;
        const nations = capitals.map((_, nation) => nation).sort((a, b) => counts[a] - targets[a] - (counts[b] - targets[b]) || a - b);
        for (const nation of nations) {
            let best = -1;
            for (const id of mainland) {
                if (owner[id] !== NEUTRAL || !adjacency[id].some((neighbor) => owner[neighbor] === nation)) continue;
                if (best < 0 || distances[nation][id] < distances[nation][best]) best = id;
            }
            if (best < 0) continue;
            owner[best] = nation;
            counts[nation] += states[best].provinces.length;
            claimed = true;
            break;
        }
        if (!claimed) break;
    }

    // Overseas components go whole to the nearest coast, balance breaking ties.
    const hops = capitals.map((_, nation) => {
        const distance = new Int32Array(states.length).fill(-1);
        const open: number[] = [];
        for (const id of mainland) if (owner[id] === nation) { distance[id] = 0; open.push(id); }
        for (let head = 0; head < open.length; head++) {
            for (const neighbor of adjacency[open[head]]) {
                if (distance[neighbor] >= 0) continue;
                distance[neighbor] = distance[open[head]] + 1;
                open.push(neighbor);
            }
        }
        return distance;
    });
    const seen = new Set<number>(mainland);
    for (const start of states.keys()) {
        if (seen.has(start)) continue;
        const component = [start];
        seen.add(start);
        for (let head = 0; head < component.length; head++) {
            for (const neighbor of adjacency[component[head]]) {
                if (seen.has(neighbor)) continue;
                seen.add(neighbor);
                component.push(neighbor);
            }
        }
        const size = component.reduce((sum, id) => sum + states[id].provinces.length, 0);
        let bestNation = 0;
        let bestScore = Infinity;
        for (const nation of capitals.keys()) {
            const coast = Math.min(...component.map((id) => hops[nation][id]));
            // Balance first; nearer coast breaks ties between equally good recipients.
            const score = Math.abs(counts[nation] + size - targets[nation]) * 10 + (Number.isFinite(coast) ? coast : 1000);
            if (score < bestScore) { bestScore = score; bestNation = nation; }
        }
        for (const id of component) {
            owner[id] = bestNation;
            counts[bestNation] += states[id].provinces.length;
        }
    }

    const canRelease = (id: number): boolean => {
        const nation = owner[id];
        if (nation === NEUTRAL) return true;
        // Overseas holdings are separate components; only the capital's component must survive.
        const reachable = (exclude: number | null): number => {
            const visited = new Set<number>([capitals[nation]]);
            const open = [capitals[nation]];
            while (open.length > 0) {
                const current = open.pop()!;
                for (const neighbor of adjacency[current]) {
                    if (neighbor === exclude || owner[neighbor] !== nation || visited.has(neighbor)) continue;
                    visited.add(neighbor);
                    open.push(neighbor);
                }
            }
            return visited.size;
        };
        return reachable(id) === reachable(null) - 1;
    };
    const errorChange = (nation: number, change: number): number => nation === NEUTRAL ? 0
        : (counts[nation] - targets[nation]) ** 2 - (counts[nation] + change - targets[nation]) ** 2;

    // Border transfers may improve balance only if the donor remains connected to its capital.
    for (;;) {
        let best: { id: number; nation: number; gain: number } | null = null;
        for (const id of mainland) {
            if (capitals.includes(id)) continue;
            const from = owner[id];
            const size = states[id].provinces.length;
            const recipients = new Set(adjacency[id].map((neighbor) => owner[neighbor]));
            recipients.delete(from);
            for (const nation of recipients) {
                const gain = errorChange(from, -size) + errorChange(nation, size);
                if (gain <= (best?.gain ?? 1e-8) || !canRelease(id)) continue;
                best = { id, nation, gain };
            }
        }
        if (!best) break;
        const from = owner[best.id];
        const size = states[best.id].provinces.length;
        if (from !== NEUTRAL) counts[from] -= size;
        if (best.nation !== NEUTRAL) counts[best.nation] += size;
        owner[best.id] = best.nation;
    }
    return owner;
}

function nationColors(count: number, rand: LCGRandom): string[] {
    const start = rand.nextInt(0, 360);
    const step = 360 / count;
    return Array.from({ length: count }, (_, index) => {
        const hue = (start + index * step + rand.nextInt(-6, 7) + 360) % 360;
        const saturation = rand.nextInt(62, 78);
        const lightness = rand.nextInt(47, 57);
        return hslToHex(hue, saturation, lightness);
    });
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
    const s = saturation / 100;
    const l = lightness / 100;
    const channel = (n: number): number => {
        const k = (n + hue / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return `#${[channel(0), channel(8), channel(4)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** A fresh, visually distinct colour for a carved vassal (it is hidden by the overlord's colour until released). */
function newNationColor(rand: LCGRandom, taken: readonly string[]): string {
    for (let attempt = 0; attempt < 32; attempt++) {
        const color = hslToHex(rand.nextInt(0, 360), rand.nextInt(62, 78), rand.nextInt(47, 57));
        if (!taken.includes(color)) return color;
    }
    return hslToHex(rand.nextInt(0, 360), 70, 52);
}

function shuffleIds(ids: readonly number[], rand: LCGRandom): number[] {
    const result = [...ids];
    for (let i = result.length - 1; i > 0; i--) {
        const j = rand.nextInt(0, i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/** The overlord must stay connected to its capital after losing one state. */
function remainingConnected(owned: ReadonlySet<number>, adjacency: readonly number[][], start: number): boolean {
    if (!owned.has(start)) return false;
    const seen = new Set<number>([start]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
        for (const neighbor of adjacency[queue[head]]) {
            if (!owned.has(neighbor) || seen.has(neighbor)) continue;
            seen.add(neighbor);
            queue.push(neighbor);
        }
    }
    return seen.size === owned.size;
}

/**
 * Pick a province-rich border state far from the overlord's capital that can be
 * detached without splitting the remaining realm.
 */
function pickCarveState(
    graph: VoronoiGraph,
    provinces: readonly Province[],
    states: readonly StateRegion[],
    adjacency: readonly number[][],
    nations: readonly Nation[],
    overlordId: number,
    rand: LCGRandom,
): number | null {
    const overlord = nations[overlordId];
    if (!overlord) return null;
    const capitalState = provinces[overlord.capital].stateId;
    const owned = new Set(states
        .filter((region) => provinces[region.center].owner === overlordId)
        .map((region) => region.id));
    if (owned.size < 3 || !owned.has(capitalState)) return null;

    const candidates = [...owned]
        .filter((id) => id !== capitalState)
        .map((id) => ({
            id,
            distance: periodicDistance(graph.sites[states[id].center], graph.sites[overlord.capital], graph.domain),
        }))
        .sort((a, b) => b.distance - a.distance || a.id - b.id)
        .slice(0, 4);
    for (const candidate of shuffleIds(candidates.map((entry) => entry.id), rand)) {
        const remaining = new Set([...owned].filter((id) => id !== candidate));
        if (remainingConnected(remaining, adjacency, capitalState)) return candidate;
    }
    return null;
}

function rollVassalType(rand: LCGRandom): VassalType {
    const roll = rand.nextFloat();
    if (roll < 0.45) return "cooperative";
    if (roll < 0.85) return "autonomous";
    return "oppressive";
}

function applyGeneratedContract(nation: Nation, overlordId: number, type: VassalType): void {
    const profile = VASSAL_PROFILES[type];
    nation.overlord = overlordId;
    nation.vassalType = type;
    nation.independence = profile.independenceStart;
    nation.tributeRate = profile.resourceShare;
}

function nationSizes(nations: readonly Nation[], provinces: readonly Province[]): Map<number, number> {
    const sizes = new Map<number, number>();
    for (const nation of nations) sizes.set(nation.id, 0);
    for (const province of provinces) {
        const owner = province.owner;
        if (sizes.has(owner)) sizes.set(owner, (sizes.get(owner) ?? 0) + 1);
    }
    return sizes;
}

function nationsBorder(
    provinces: readonly Province[],
    graph: VoronoiGraph,
    a: number,
    b: number,
): boolean {
    for (const province of provinces) {
        if (province.owner !== a) continue;
        for (const edge of graph.adjacency[province.site]) {
            if (provinces[edge.site].owner === b) return true;
        }
    }
    return false;
}

/**
 * Seed the world with both kinds of vassal:
 * - carved: a new minor state is detached from an AI great power's border;
 * - independent: an already generated minor power voluntarily attaches to a
 *   stronger neighbour.
 *
 * Only one layer is ever generated: vassals never rule vassals, and a vassal
 * is never promoted to overlord in the same pass.
 */
function seedWorldVassals(
    graph: VoronoiGraph,
    provinces: Province[],
    states: readonly StateRegion[],
    adjacency: readonly number[][],
    nations: Nation[],
    rand: LCGRandom,
    names: NameGenerator,
    tendencies: readonly AITendencyId[],
): void {
    const requested = nations.length;
    if (requested < 5) return;
    const budget = requested >= 10 ? 3 : requested >= 8 ? 2 : 1;
    const carvedBudget = Math.ceil(budget / 2);
    let carved = 0;

    // Carve minor vassals out of AI great powers, never the default player (id 0).
    for (let attempt = 0; attempt < carvedBudget * 3 && carved < carvedBudget; attempt++) {
        const sizes = nationSizes(nations, provinces);
        const candidates = nations
            .filter((nation) => nation.id !== 0 && !(nation.overlord !== undefined && nation.overlord >= 0) &&
                (sizes.get(nation.id) ?? 0) > 0 &&
                states.filter((region) => provinces[region.center].owner === nation.id).length >= 3)
            .sort((a, b) => (sizes.get(b.id) ?? 0) - (sizes.get(a.id) ?? 0) || a.id - b.id);
        if (candidates.length === 0) break;
        const overlord = candidates[rand.nextInt(0, Math.min(2, candidates.length))];
        const stateId = pickCarveState(graph, provinces, states, adjacency, nations, overlord.id, rand);
        if (stateId === null) continue;
        const center = states[stateId].center;
        for (const site of states[stateId].provinces) provinces[site].owner = nations.length;
        makeCity(provinces[center], true);
        const id = nations.length;
        const tendency = tendencies[id % tendencies.length] ?? "opportunist";
        const nation: Nation = {
            id,
            name: names.nationName(),
            color: newNationColor(rand, nations.map((entry) => entry.color)),
            isPlayer: false,
            tendency,
            capital: center,
            funds: START_FUNDS,
            manpower: START_MANPOWER,
            industry: START_INDUSTRY,
            politicalPower: START_PP,
            policies: { ...DEFAULT_POLICIES },
            policyTransitions: {},
            alive: true,
            overlord: overlord.id,
            vassalType: rollVassalType(rand),
            independence: 0,
            tributeRate: 0,
        };
        applyGeneratedContract(nation, overlord.id, nation.vassalType ?? "cooperative");
        nations.push(nation);
        carved++;
    }

    // Attach existing minor powers to a much stronger neighbour.
    const attached = new Set(nations.filter((nation) => nation.overlord !== undefined && nation.overlord >= 0)
        .map((nation) => nation.id));
    // Never turn an existing overlord into a vassal: the generated hierarchy stays one layer deep.
    const overlords = new Set(nations
        .filter((nation) => nation.overlord === undefined || nation.overlord < 0)
        .filter((nation) => nations.some((other) => other.overlord === nation.id))
        .map((nation) => nation.id));
    let independent = 0;
    for (let attempt = 0; attempt < budget * 4 && independent < budget - carved; attempt++) {
        const sizes = nationSizes(nations, provinces);
        const pairs: { vassal: number; overlord: number }[] = [];
        for (const vassal of nations) {
            if (vassal.id === 0 || attached.has(vassal.id) || overlords.has(vassal.id)) continue;
            if (vassal.overlord !== undefined && vassal.overlord >= 0) continue;
            for (const candidate of nations) {
                if (candidate.id === vassal.id || attached.has(candidate.id) || overlords.has(candidate.id)) continue;
                if (candidate.overlord !== undefined && candidate.overlord >= 0) continue;
                if ((sizes.get(candidate.id) ?? 0) < (sizes.get(vassal.id) ?? 0) * 1.8) continue;
                if (!nationsBorder(provinces, graph, vassal.id, candidate.id)) continue;
                pairs.push({ vassal: vassal.id, overlord: candidate.id });
            }
        }
        if (pairs.length === 0) break;
        const pick = pairs[rand.nextInt(0, pairs.length)];
        const vassal = nations[pick.vassal];
        applyGeneratedContract(vassal, pick.overlord, rollVassalType(rand));
        attached.add(pick.vassal);
        overlords.add(pick.overlord);
        independent++;
    }
}

export function generateNations(
    graph: VoronoiGraph,
    provinces: Province[],
    states: readonly StateRegion[],
    mainland: readonly number[],
    nationCount: number,
    rand: LCGRandom,
    names: NameGenerator,
    seed: number,
): Nation[] {
    const candidates = [...new Set(mainland.map((site) => provinces[site].stateId))];
    const count = Math.min(nationCount, candidates.length, NATION_COUNT_MAX);
    const capitals = pickCapitalStates(graph, states, candidates, count, rand);
    const weights = nationSizeWeights(capitals.length, rand);
    const adjacency = stateAdjacency(graph, provinces, states);
    const owners = assignStateTerritories(states, adjacency, capitals, weights);
    for (const region of states) {
        for (const site of region.provinces) provinces[site].owner = owners[region.id];
    }
    const colors = nationColors(capitals.length, rand);
    // A shuffled deck gives every nation a stable temperament without touching the world RNG.
    const tendencies = aiTendencyDeck(seed);
    const nations = capitals.map((id, nation) => {
        const capital = states[id].center;
        makeCity(provinces[capital], true);
        const tendency = tendencies[nation % tendencies.length];
        return {
            id: nation,
            name: names.nationName(),
            color: colors[nation],
            isPlayer: nation === 0,
            tendency,
            capital,
            funds: START_FUNDS,
            manpower: START_MANPOWER,
            industry: START_INDUSTRY,
            politicalPower: START_PP,
            policies: { ...DEFAULT_POLICIES },
            policyTransitions: {},
            alive: true,
            overlord: -1,
            independence: 100,
            tributeRate: 0,
        } satisfies Nation;
    });
    seedWorldVassals(graph, provinces, states, adjacency, nations, rand, names, tendencies);
    return nations;
}
