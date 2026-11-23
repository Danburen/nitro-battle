import type { GameCore } from "./core.ts";
import { attack } from "./combat.ts";
import {
    armyAt,
    armyCap,
    armyMp,
    entryCost,
    isHostileProvince,
    marchPath,
    nationArmyCount,
    pathTo,
    redeployTargets,
} from "./rules.ts";
import { MAX_HP, REDEPLOY_ORG, REGIMENT_CAP } from "./types.ts";
import type { Army, GameState, UnitKind } from "./types.ts";

const ARMY_NAMES = ["第一", "第二", "第三", "第四", "第五", "第六", "第七", "第八", "第九", "第十"];

export function nextArmyName(state: GameState, nation: number): string {
    const used = new Set<string>();
    for (const army of state.armies.values()) {
        if (army.nation === nation) used.add(army.name);
    }
    for (const prefix of ARMY_NAMES) {
        const name = `${prefix}军团`;
        if (!used.has(name)) return name;
    }
    return `第${state.nextArmyId}军团`;
}

export function spawnArmy(state: GameState, nation: number, province: number, kinds: UnitKind[], org: number): Army {
    const army: Army = {
        id: state.nextArmyId++,
        nation,
        name: nextArmyName(state, nation),
        province,
        regiments: kinds.map((kind) => ({ id: state.nextRegimentId++, kind, hp: MAX_HP })),
        org,
        moved: false,
        acted: false,
        march: null,
        autoManaged: state.autoManageArmies === true,
    };
    state.armies.set(army.id, army);
    state.armyAt[province] = army.id;
    return army;
}

export function moveArmy(core: GameCore, armyId: number, to: number): boolean {
    const state = core.state;
    const army = state.armies.get(armyId);
    if (!army || state.winner !== null) return false;
    const reach = core.reachFor(army);
    if (!reach.cost.has(to)) return false;

    const path = pathTo(reach, to);
    const occupant = armyAt(state, to);
    const focused = state.selectedArmyId === army.id;

    if (occupant && occupant.nation === army.nation && occupant.id !== army.id) {
        core.mergeArmies(army, occupant);
        occupant.moved = true;
        occupant.march = null;
        if (focused) {
            state.selected = to;
            state.selectedArmyId = occupant.id;
        }
    } else {
        core.placeArmy(army, to);
        army.moved = true;
        army.march = null;
        if (focused) state.selected = to;
    }

    core.invalidateReach();
    core.emit({ type: "move", armyId, path });
    core.emit({ type: "state" });
    return true;
}

/** Queue a multi-day march; attack=true assaults the target on arrival. */
export function orderMarch(core: GameCore, armyId: number, target: number, attack: boolean): boolean {
    const state = core.state;
    const army = state.armies.get(armyId);
    if (!army || state.winner !== null) return false;
    if (army.moved || army.acted || core.inBattle(armyId)) return false;
    if (target === army.province || !state.terrain.passable[target]) return false;

    if (attack) {
        if (!isHostileProvince(state, army.nation, target)) return false;
    } else {
        const province = state.provinces[target];
        if (province.owner !== army.nation) return false;
        const occupant = armyAt(state, target);
        if (occupant && occupant.nation !== army.nation) return false;
        if (occupant && occupant.regiments.length + army.regiments.length > REGIMENT_CAP) return false;
    }
    if (marchPath(state, army, target) === null) return false;

    army.march = { target, attack };
    core.log(
        `${core.nationChip(army.nation)} ${army.name}${attack ? " 远征" : " 开赴"} ${state.provinces[target].name}`,
        "info",
        army.nation,
    );
    core.invalidateReach();
    core.emit({ type: "state" });
    return true;
}

export function cancelMarch(core: GameCore, armyId: number): boolean {
    const army = core.state.armies.get(armyId);
    if (!army || !army.march) return false;
    army.march = null;
    core.emit({ type: "state" });
    return true;
}

export function waitArmy(core: GameCore, armyId: number): boolean {
    const army = core.state.armies.get(armyId);
    if (!army || army.acted) return false;
    army.acted = true;
    army.moved = true;
    army.march = null;
    core.invalidateReach();
    core.emit({ type: "state" });
    return true;
}

// ---- strategic redeployment ----

export function beginRedeploy(core: GameCore, armyId: number): boolean {
    const army = core.state.armies.get(armyId);
    if (!army || core.state.winner !== null) return false;
    if (army.nation !== 0 || army.moved || army.acted || core.inBattle(armyId)) return false;
    core.state.redeployArmyId = armyId;
    core.emit({ type: "state" });
    return true;
}

export function cancelRedeploy(core: GameCore): void {
    if (core.state.redeployArmyId === null) return;
    core.state.redeployArmyId = null;
    core.emit({ type: "state" });
}

export function redeployTargetsFor(core: GameCore, army: Army): Set<number> {
    return redeployTargets(core.state, army);
}

export function redeploy(core: GameCore, armyId: number, to: number): boolean {
    const state = core.state;
    const army = state.armies.get(armyId);
    if (!army || state.winner !== null || state.redeployArmyId !== armyId) return false;
    if (!redeployTargetsFor(core, army).has(to)) return false;

    const from = army.province;
    core.placeArmy(army, to);
    army.org = REDEPLOY_ORG;
    army.moved = true;
    army.acted = true;
    army.march = null;
    state.selected = to;
    state.selectedArmyId = army.nation === 0 ? army.id : null;
    state.redeployArmyId = null;

    core.log(
        `${core.nationChip(army.nation)} ${army.name} 战略转移 ${state.provinces[to].name}`,
        "info",
        army.nation,
    );
    core.invalidateReach();
    core.emit({ type: "move", armyId, path: [from, to] });
    core.emit({ type: "state" });
    return true;
}

export function disbandArmy(core: GameCore, armyId: number): boolean {
    const state = core.state;
    const army = state.armies.get(armyId);
    if (!army || army.nation !== 0 || state.winner !== null) return false;
    if (core.inBattle(armyId)) return false;
    core.log(`${core.nationChip(0)} 解散 ${army.name}（${army.regiments.length} 团复员）`, "econ", 0);
    core.removeArmy(army, false);
    core.invalidateReach();
    core.emit({ type: "state" });
    return true;
}

/**
 * Detach checked regiments into a fresh army in an adjacent empty own province.
 * An explicit `targetSite` (used by the trusteeship border fill) forces a
 * specific adjacent province rather than the first free neighbour.
 */
export function splitArmy(
    core: GameCore,
    armyId: number,
    regimentIds: readonly number[],
    targetSite?: number | null,
): number | null {
    const state = core.state;
    const army = state.armies.get(armyId);
    if (!army || army.nation !== 0 || state.winner !== null) return null;
    if (army.moved || army.acted || core.inBattle(armyId)) return null;
    const picked = new Set(regimentIds);
    const moving = army.regiments.filter((regiment) => picked.has(regiment.id));
    if (moving.length === 0 || moving.length === army.regiments.length) return null;
    if (nationArmyCount(state, 0) >= armyCap(state, 0)) return null;

    const openSite = (site: number): boolean =>
        state.terrain.passable[site] && state.provinces[site].owner === 0 &&
        !armyAt(state, site) && !core.battleAt(site);
    let site: number | null = null;
    if (targetSite !== undefined && targetSite !== null) {
        if (!state.graph.adjacency[army.province].some((edge) => edge.site === targetSite) ||
            !openSite(targetSite)) return null;
        site = targetSite;
    } else {
        for (const edge of state.graph.adjacency[army.province]) {
            if (openSite(edge.site)) {
                site = edge.site;
                break;
            }
        }
    }
    if (site === null) return null;

    army.regiments = army.regiments.filter((regiment) => !picked.has(regiment.id));
    army.moved = true;
    const fresh: Army = {
        id: state.nextArmyId++,
        nation: 0,
        name: nextArmyName(state, 0),
        province: site,
        regiments: moving,
        org: army.org,
        moved: true,
        acted: true,
        march: null,
        autoManaged: state.autoManageArmies === true && army.autoManaged !== false,
    };
    state.armies.set(fresh.id, fresh);
    state.armyAt[site] = fresh.id;
    core.log(
        `${core.nationChip(0)} 拆分 ${fresh.name}（${moving.length} 团）驻 ${state.provinces[site].name}`,
        "info",
        0,
    );
    core.invalidateReach();
    core.emit({ type: "state" });
    return fresh.id;
}

/** Merge several armies: the largest holds position, the rest march to it. */
export function orderMerge(core: GameCore, armyIds: readonly number[]): boolean {
    const state = core.state;
    if (state.winner !== null || armyIds.length < 2) return false;
    if (new Set(armyIds).size !== armyIds.length) return false;
    const armies: Army[] = [];
    for (const id of armyIds) {
        const army = state.armies.get(id);
        if (!army || army.nation !== 0) return false;
        armies.push(army);
    }
    const total = armies.reduce((sum, army) => sum + army.regiments.length, 0);
    if (total > REGIMENT_CAP) return false;
    const anchor = armies.reduce((best, army) =>
        army.regiments.length > best.regiments.length ? army : best);
    const movers = armies.filter((army) => army.id !== anchor.id);
    for (const mover of movers) {
        if (mover.moved || mover.acted || core.inBattle(mover.id)) return false;
        if (mover.province === anchor.province) return false;
        if (marchPath(state, mover, anchor.province) === null) return false;
    }
    for (const mover of movers) {
        if (core.reachFor(mover).cost.has(anchor.province)) {
            moveArmy(core, mover.id, anchor.province);
        } else {
            orderMarch(core, mover.id, anchor.province, false);
        }
    }
    core.log(
        `${core.nationChip(0)} 合并 ${movers.map((army) => army.name).join("、")} → ${anchor.name}`,
        "info",
        0,
    );
    core.invalidateReach();
    core.emit({ type: "state" });
    return true;
}

/** Walk every pending march order as far as today's movement budget allows. */
export function advanceMarches(core: GameCore): void {
    const state = core.state;
    for (const army of [...state.armies.values()]) {
        const march = army.march;
        if (!march || army.moved || army.acted || core.inBattle(army.id)) continue;

        const targetProvince = state.provinces[march.target];
        if (march.attack) {
            if (!isHostileProvince(state, army.nation, march.target)) {
                army.march = null;
                continue;
            }
            if (state.graph.adjacency[army.province].some((edge) => edge.site === march.target)) {
                attack(core, army.id, march.target);
                continue;
            }
        } else {
            if (targetProvince.owner !== army.nation) {
                army.march = null;
                core.log(`${core.nationChip(army.nation)} ${army.name} 行军取消（目标失守）`, "info", army.nation);
                continue;
            }
        }

        const path = marchPath(state, army, march.target);
        if (path === null) {
            army.march = null;
            continue;
        }

        const budget = armyMp(army);
        let spent = 0;
        const walked: number[] = [army.province];
        let stop = army.province;
        for (const step of path) {
            if (march.attack && step === march.target) break;
            const occupant = armyAt(state, step);
            if (occupant && occupant.id !== army.id) {
                if (occupant.nation !== army.nation) break;
                if (occupant.regiments.length + army.regiments.length > REGIMENT_CAP) break;
            }
            const cost = entryCost(state, step);
            if (spent + cost > budget + 1e-9) break;
            spent += cost;
            stop = step;
            walked.push(step);
        }

        if (stop === army.province) {
            // Blocked today (e.g. an army ahead); try again tomorrow.
            continue;
        }

        const occupant = armyAt(state, stop);
        if (occupant && occupant.nation === army.nation && occupant.id !== army.id) {
            core.mergeArmies(army, occupant);
            occupant.moved = true;
            occupant.march = null;
            core.emit({ type: "move", armyId: occupant.id, path: walked });
            continue;
        }

        core.placeArmy(army, stop);
        army.moved = true;
        if (stop === march.target && !march.attack) army.march = null;
        core.emit({ type: "move", armyId: army.id, path: walked });

        if (march.attack && army.march &&
            state.graph.adjacency[army.province].some((edge) => edge.site === march.target)) {
            attack(core, army.id, march.target);
        }
    }
    core.invalidateReach();
}