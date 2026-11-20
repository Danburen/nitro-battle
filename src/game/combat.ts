import type { GameCore } from "./core.ts";
import { resolveBattleRound } from "./battle.ts";
import { claimProvince } from "./conquest.ts";
import { isAtWar } from "./diplomacy.ts";
import { armyAt, isHostileProvince } from "./rules.ts";
import type { Army, Battle } from "./types.ts";

export function attack(core: GameCore, armyId: number, target: number): boolean {
    const state = core.state;
    const army = state.armies.get(armyId);
    if (!army || state.winner !== null) return false;
    if (army.acted || army.regiments.length === 0 || core.inBattle(armyId)) return false;
    if (!state.terrain.passable[target] || !isHostileProvince(state, army.nation, target)) return false;
    if (!state.graph.adjacency[army.province].some((edge) => edge.site === target)) return false;
    if (core.battleAt(target)) return false;

    const province = state.provinces[target];
    const defender = armyAt(state, target);
    const defenderArmy = defender && defender.nation !== army.nation ? defender : null;

    army.acted = true;
    army.moved = true;
    army.march = null;

    // Undefended province: walk straight in.
    if (province.garrison <= 0 && !defenderArmy) {
        const previousOwner = province.owner;
        core.placeArmy(army, target);
        if (state.selectedArmyId === army.id) state.selected = target;
        claimProvince(core, target, army.nation, previousOwner);
        core.invalidateReach();
        core.emit({ type: "state" });
        return true;
    }

    const battle: Battle = {
        province: target,
        attackerId: army.id,
        defenderId: defenderArmy ? defenderArmy.id : null,
        rounds: 0,
    };
    state.battles.push(battle);
    state.stats.battles++;
    core.log(
        `${core.nationChip(army.nation)} ${army.name} 进攻 ${province.name}`,
        "combat",
        army.nation,
    );
    core.invalidateReach();
    core.emit({
        type: "battle-start",
        province: target,
        attackerNation: army.nation,
        defenderNation: province.owner,
    });
    core.emit({ type: "state" });
    return true;
}

/** Call off an assault; the army keeps its position but loses its action. */
export function cancelAttack(core: GameCore, armyId: number): boolean {
    const state = core.state;
    const index = state.battles.findIndex((battle) => battle.attackerId === armyId);
    if (index < 0) return false;
    const battle = state.battles[index];
    const army = state.armies.get(armyId);
    state.battles.splice(index, 1);
    if (army) {
        core.log(`${core.nationChip(army.nation)} ${army.name} 停止进攻 ${state.provinces[battle.province].name}`, "combat", army.nation);
    }
    core.invalidateReach();
    core.emit({ type: "state" });
    return true;
}

/** A broken defender falls back to an adjacent empty own province, or dies. */
function retreatDefenderArmy(core: GameCore, defender: Army, from: number): void {
    const state = core.state;
    if (defender.regiments.length === 0) {
        core.removeArmy(defender, true);
        return;
    }
    let best: number | null = null;
    for (const edge of state.graph.adjacency[from]) {
        const site = edge.site;
        if (!state.terrain.passable[site]) continue;
        if (state.provinces[site].owner !== defender.nation) continue;
        if (armyAt(state, site)) continue;
        if (core.battleAt(site)) continue;
        best = site;
        break;
    }
    if (best === null) {
        core.log(`${core.nationChip(defender.nation)} ${defender.name} 被歼灭 ${state.provinces[from].name}`, "combat", defender.nation);
        core.removeArmy(defender, true);
        return;
    }
    core.placeArmy(defender, best);
    defender.march = null;
    core.log(`${core.nationChip(defender.nation)} ${defender.name} 撤出 ${state.provinces[from].name}`, "combat", defender.nation);
}

export function resolveBattles(core: GameCore): void {
    const state = core.state;
    for (const battle of [...state.battles]) {
        if (!state.battles.includes(battle)) continue;
        const attacker = state.armies.get(battle.attackerId);
        if (!attacker) {
            state.battles.splice(state.battles.indexOf(battle), 1);
            continue;
        }
        const province = state.provinces[battle.province];
        const defenderNation = province.owner;
        if (!isAtWar(state, attacker.nation, defenderNation)) {
            state.battles.splice(state.battles.indexOf(battle), 1);
            continue;
        }
        const attackerBefore = attacker.regiments.length;
        const defender = battle.defenderId !== null ? state.armies.get(battle.defenderId) ?? null : null;
        const defenderBefore = defender ? defender.regiments.length : 0;

        const result = resolveBattleRound(state, battle, core.rand);

        if (attacker.nation === 0) state.stats.losses += attackerBefore - attacker.regiments.length;
        if (defender && defender.nation === 0) state.stats.losses += defenderBefore - defender.regiments.length;

        if (result.defenderBroken && defender) {
            retreatDefenderArmy(core, defender, battle.province);
            battle.defenderId = null;
        }

        let outcome = result.outcome;
        if (outcome === "captured") {
            if (attacker.regiments.length === 0) {
                // Mutual destruction: the province holds, but its garrison is gone.
                outcome = "repelled";
                core.log(`${core.nationChip(attacker.nation)} 进攻 ${province.name} 全军覆没`, "combat", attacker.nation);
                core.removeArmy(attacker, true);
            } else {
                core.placeArmy(attacker, battle.province);
                if (state.selectedArmyId === attacker.id) state.selected = battle.province;
                claimProvince(core, battle.province, attacker.nation, defenderNation);
            }
        } else if (outcome === "repelled" && attacker.regiments.length === 0) {
            core.removeArmy(attacker, true);
        }

        if (outcome !== "ongoing") {
            const index = state.battles.indexOf(battle);
            if (index >= 0) state.battles.splice(index, 1);
        }

        const suffix = outcome === "captured" ? " · 防线崩溃"
            : outcome === "repelled" ? " · 进攻击退"
            : "";
        core.log(
            `${core.nationChip(attacker.nation)} ${province.name} 会战第 ${battle.rounds} 日 · 攻 -${result.attackerLoss} 守 -${result.defenderLoss}` +
                suffix,
            outcome === "captured" ? "capture" : "combat",
            attacker.nation,
        );
        core.emit({
            type: "combat",
            province: battle.province,
            attackerNation: attacker.nation,
            defenderNation,
            outcome,
            attackerLoss: result.attackerLoss,
            defenderLoss: result.defenderLoss,
            garrisonBefore: result.garrisonBefore,
            garrisonAfter: result.garrisonAfter,
            attackerOrg: result.attackerOrg,
            defenderOrg: result.defenderOrg ?? 0,
        });
    }
    core.invalidateReach();
}