import type { GameCore } from "./core.ts";
import { refreshGarrisonCapacity } from "./battle.ts";
import { canBuild, canBuildProvince, canTrain, constructionAssignments, factoryTotals, infrastructureLevel, REINFORCE_COST } from "./economy.ts";
import { armyAt, armyCap, isValidDeploySite, nationArmyCount, resolveDeploySite } from "./rules.ts";
import {
    BUILD_REFUND,
    BUILDING_PROFILES,
    DEPLOY_ORG,
    DEPLOY_REFUND,
    MAX_HP,
    REGIMENT_CAP,
    UNIT_PROFILES,
} from "./types.ts";
import type { Army, BuildingKind, ProvinceBuildingKind, StateBuildingKind, UnitKind } from "./types.ts";
import { spawnArmy } from "./armies.ts";

// ---- training and deployment ----

export function enqueueTrain(core: GameCore, nationId: number, kind: UnitKind, destination: number | null): boolean {
    const state = core.state;
    if (state.winner !== null) return false;
    const nation = state.nations[nationId];
    if (!nation?.alive || !canTrain(state, nationId, kind)) return false;

    const profile = UNIT_PROFILES[kind];
    const preferred =
        destination !== null && isValidDeploySite(state, nationId, destination) ? destination : null;
    nation.funds -= profile.cost;
    nation.manpower -= profile.manpowerCost;
    nation.industry -= profile.industryCost;
    state.deployments.push({
        id: state.nextDeploymentId++,
        nation: nationId,
        kind,
        daysLeft: profile.trainDays,
        destination: preferred,
        paidFunds: profile.cost,
        paidManpower: profile.manpowerCost,
        paidIndustry: profile.industryCost,
        status: "training",
        createdDay: state.day,
    });
    core.log(
        `${core.nationChip(nationId)} 训练 ${profile.name}`,
        "econ",
        nationId,
        false,
        {
            kind: "production",
            nation: nationId,
            action: "train",
            stage: "start",
            items: [{ label: profile.name, count: 1 }],
        },
    );
    core.emit({ type: "state" });
    return true;
}

export function cancelTrain(core: GameCore, orderId: number): boolean {
    const state = core.state;
    const index = state.deployments.findIndex((order) => order.id === orderId && order.nation === 0);
    if (index < 0) return false;
    const order = state.deployments[index];
    const nation = state.nations[0];
    const refundFunds = Math.floor(order.paidFunds * DEPLOY_REFUND);
    nation.funds += refundFunds;
    nation.manpower += Math.floor(order.paidManpower * DEPLOY_REFUND);
    nation.industry += Math.floor(order.paidIndustry * DEPLOY_REFUND);
    state.deployments.splice(index, 1);
    core.log(`${core.nationChip(0)} 取消训练 ${UNIT_PROFILES[order.kind].name}`, "econ", 0);
    core.emit({ type: "state" });
    return true;
}

export function setTrainDestination(core: GameCore, orderId: number, site: number | null): boolean {
    const order = core.state.deployments.find((entry) => entry.id === orderId && entry.nation === 0);
    if (!order) return false;
    if (site !== null && !isValidDeploySite(core.state, 0, site)) return false;
    order.destination = site;
    core.emit({ type: "state" });
    return true;
}

export function processDeployments(core: GameCore): void {
    const state = core.state;
    for (let i = state.deployments.length - 1; i >= 0; i--) {
        const order = state.deployments[i];
        const nation = state.nations[order.nation];
        if (!nation.alive) {
            state.deployments.splice(i, 1);
            continue;
        }
        if (order.status === "training") {
            order.daysLeft--;
            if (order.daysLeft > 0) continue;
            order.status = "ready";
        }

        const site = resolveDeploySite(state, order.nation, order.destination);
        if (site === null) {
            order.status = "blocked";
            continue;
        }

        const occupant = armyAt(state, site);
        let armyId: number;
        if (occupant && occupant.nation === order.nation && occupant.regiments.length < REGIMENT_CAP) {
            const added = 1;
            occupant.org = Math.round(
                (occupant.org * occupant.regiments.length + DEPLOY_ORG * added) /
                    (occupant.regiments.length + added),
            );
            occupant.regiments.push({ id: state.nextRegimentId++, kind: order.kind, hp: MAX_HP });
            armyId = occupant.id;
        } else if (nationArmyCount(state, order.nation) < armyCap(state, order.nation)) {
            const army = spawnArmy(state, order.nation, site, [order.kind], DEPLOY_ORG);
            armyId = army.id;
        } else {
            order.status = "blocked";
            continue;
        }

        state.deployments.splice(i, 1);
        state.stats.recruited++;
        core.log(
            `${core.nationChip(order.nation)} 部署 ${UNIT_PROFILES[order.kind].name} ${state.provinces[site].name}`,
            "econ",
            order.nation,
            false,
            {
                kind: "production",
                nation: order.nation,
                action: "deploy",
                stage: "done",
                site,
                items: [{ label: UNIT_PROFILES[order.kind].name, count: 1 }],
                places: [state.provinces[site].name],
            },
        );
        core.emit({ type: "deploy", province: site, armyId, nationId: order.nation, kind: order.kind });
    }
}

// ---- construction ----

export function enqueueBuild(core: GameCore, nationId: number, stateId: number, kind: StateBuildingKind): boolean {
    if (!canBuild(core.state, nationId, stateId, kind)) return false;
    return createConstruction(core, nationId, core.state.states[stateId].center, kind);
}

export function enqueueProvinceBuild(core: GameCore, nationId: number, site: number, kind: ProvinceBuildingKind): boolean {
    if (!canBuildProvince(core.state, nationId, site, kind)) return false;
    return createConstruction(core, nationId, site, kind);
}

function createConstruction(core: GameCore, nationId: number, site: number, kind: BuildingKind): boolean {
    const state = core.state;
    const nation = state.nations[nationId];
    const profile = BUILDING_PROFILES[kind];
    nation.funds -= profile.costFunds;
    nation.industry -= profile.costIndustry;
    state.construction.push({
        id: state.nextConstructionId++, nation: nationId, site, kind,
        remainingPoints: profile.constructionPoints,
        paidFunds: profile.costFunds, paidIndustry: profile.costIndustry,
    });
    core.log(`${core.nationChip(nationId)} 建造 ${profile.name} ${state.provinces[site].name}`, "econ", nationId, false, {
        kind: "production",
        nation: nationId,
        action: "build",
        stage: "start",
        site,
        items: [{ label: profile.name, count: 1 }],
        places: [state.provinces[site].name],
    });
    core.emit({ type: "state" });
    return true;
}

/** National production allocation, highest infrastructure first, then state id. */
export function setFactoryProduction(core: GameCore, nationId: number, prod: number): boolean {
    const state = core.state;
    if (state.winner !== null || !state.nations[nationId]?.alive || !Number.isFinite(prod)) return false;
    let remaining = Math.max(0, Math.min(factoryTotals(state, nationId).total, Math.round(prod)));
    const regions = state.states.filter((region) => state.provinces[region.center].owner === nationId)
        .sort((a, b) => infrastructureLevel(state, b.center) - infrastructureLevel(state, a.center) || a.id - b.id);
    let changed = false;
    for (const region of regions) {
        const next = Math.min(region.factories, remaining);
        remaining -= next;
        if (region.prodFactories !== next) changed = true;
        region.prodFactories = next;
    }
    if (changed) core.emit({ type: "state" });
    return changed;
}

/** Reorder only the player's slots; enemy orders retain even their indices. */
export function reorderConstruction(core: GameCore, orderId: number, beforeId: number | null): boolean {
    const state = core.state;
    if (state.winner !== null || !state.nations[0]?.alive) return false;
    const own = state.construction.filter((order) => order.nation === 0);
    const from = own.findIndex((order) => order.id === orderId);
    if (from < 0 || beforeId === orderId || (beforeId !== null && !own.some((order) => order.id === beforeId))) return false;
    const [order] = own.splice(from, 1);
    own.splice(beforeId === null ? own.length : own.findIndex((entry) => entry.id === beforeId), 0, order);
    let next = 0;
    let changed = false;
    for (let i = 0; i < state.construction.length; i++) {
        if (state.construction[i].nation !== 0) continue;
        if (state.construction[i] !== own[next]) changed = true;
        state.construction[i] = own[next++];
    }
    if (changed) core.emit({ type: "state" });
    return changed;
}

export function cancelBuild(core: GameCore, orderId: number): boolean {
    const state = core.state;
    if (state.winner !== null || !state.nations[0]?.alive) return false;
    const index = state.construction.findIndex((order) => order.id === orderId && order.nation === 0);
    if (index < 0) return false;
    const order = state.construction[index];
    const nation = state.nations[0];
    const refundFunds = order.paidFunds * BUILD_REFUND;
    nation.funds += refundFunds;
    nation.industry += order.paidIndustry * BUILD_REFUND;
    state.construction.splice(index, 1);
    core.log(`${core.nationChip(0)} 取消建造 ${BUILDING_PROFILES[order.kind].name}`, "econ", 0);
    core.emit({ type: "state" });
    return true;
}

export function processConstruction(core: GameCore): void {
    const state = core.state;
    if (state.winner !== null) return;
    // Freeze all nations' assignments so completions cannot add or reuse workers this turn.
    const points = new Map(state.nations.flatMap((nation) => constructionAssignments(state, nation.id))
        .map((entry) => [entry.orderId, entry.pointsPerTurn]));
    const completed = [];
    let changed = false;
    for (let i = 0; i < state.construction.length;) {
        const order = state.construction[i];
        if (state.provinces[order.site]?.owner !== order.nation || !state.nations[order.nation]?.alive) {
            state.construction.splice(i, 1);
            changed = true;
            continue;
        }
        const work = points.get(order.id) ?? 0;
        order.remainingPoints = Math.max(0, order.remainingPoints - work);
        if (work > 0) changed = true;
        if (work > 0 && order.remainingPoints <= 1e-9) {
            completed.push(order);
            state.construction.splice(i, 1);
        } else i++;
    }
    for (const order of completed) {
        const province = state.provinces[order.site];
        const region = state.states[province.stateId];
        switch (order.kind) {
            case "factory": region.factories++; break;
            case "infrastructure":
                region.infrastructure++;
                state.supplyDirty = true;
                core.invalidateReach();
                break;
            case "farm": case "admin": region.buildings.push(order.kind); break;
            case "supply": province.buildings.push(order.kind); state.supplyDirty = true; break;
            case "fort": province.buildings.push(order.kind); refreshGarrisonCapacity(state, province); break;
        }
    }
    // Notify only after the entire completion batch is committed.
    for (const order of completed) {
        core.log(`${core.nationChip(order.nation)} 建成 ${BUILDING_PROFILES[order.kind].name} ${state.provinces[order.site].name}`, "econ", order.nation, false, {
            kind: "production",
            nation: order.nation,
            action: "build",
            stage: "done",
            site: order.site,
            items: [{ label: BUILDING_PROFILES[order.kind].name, count: 1 }],
            places: [state.provinces[order.site].name],
        });
        core.emit({ type: "build", province: order.site, kind: order.kind, nationId: order.nation });
    }
    if (changed) core.emit({ type: "state" });
}

/** One HP per damaged regiment per day, paid from the national stock. */
export function reinforceArmy(core: GameCore, army: Army): void {
    const nation = core.state.nations[army.nation];
    for (const regiment of army.regiments) {
        if (regiment.hp >= MAX_HP) continue;
        const cost = REINFORCE_COST[regiment.kind];
        if (nation.funds < cost.funds || nation.manpower < cost.manpower || nation.industry < cost.industry) continue;
        nation.funds -= cost.funds;
        nation.manpower -= cost.manpower;
        nation.industry -= cost.industry;
        regiment.hp++;
    }
}