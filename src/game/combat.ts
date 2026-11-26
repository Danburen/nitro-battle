import { t } from "../i18n/index.ts";
import type { GameCore } from "./core.ts";
import { resolveBattleRound } from "./battle.ts";
import { claimProvince } from "./conquest.ts";
import { isAtWar } from "./diplomacy.ts";
import { armyAt, isHostileProvince } from "./rules.ts";
import type { Army, Battle } from "./types/organization.ts";
import type { BattleReport } from "./types/log.ts";

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
        attackLoss: 0,
        defenseLoss: 0,
    };
    state.battles.push(battle);
    state.stats.battles++;
    core.log(
        t("game.combat.attack", {
            nation: core.nationChip(army.nation), army: army.name, province: province.name,
        }),
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
        core.log(t("game.combat.cancelAttack", {
            nation: core.nationChip(army.nation), army: army.name, province: state.provinces[battle.province].name,
        }), "combat", army.nation);
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
        core.log(t("game.combat.annihilated", {
            nation: core.nationChip(defender.nation), army: defender.name, province: state.provinces[from].name,
        }), "combat", defender.nation);
        core.removeArmy(defender, true);
        return;
    }
    core.placeArmy(defender, best);
    defender.march = null;
    core.log(t("game.combat.retreat", {
        nation: core.nationChip(defender.nation), army: defender.name, province: state.provinces[from].name,
    }), "combat", defender.nation);
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
        battle.attackLoss = (battle.attackLoss ?? 0) + result.attackerLoss;
        battle.defenseLoss = (battle.defenseLoss ?? 0) + result.defenderLoss;

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
                core.log(t("game.combat.wipedOut", {
                    nation: core.nationChip(attacker.nation), province: province.name,
                }), "combat", attacker.nation);
                core.removeArmy(attacker, true);
            } else {
                core.placeArmy(attacker, battle.province);
                if (state.selectedArmyId === attacker.id) state.selected = battle.province;
                const report: BattleReport = {
                    attacker: attacker.nation,
                    defender: defenderNation,
                    rounds: battle.rounds,
                    attackLoss: result.attackerLoss,
                    defenseLoss: result.defenderLoss,
                    totalAttackLoss: battle.attackLoss,
                    totalDefenseLoss: battle.defenseLoss,
                    breach: true,
                    outcome: "captured",
                };
                claimProvince(core, battle.province, attacker.nation, defenderNation, report);
            }
        } else if (outcome === "repelled" && attacker.regiments.length === 0) {
            core.removeArmy(attacker, true);
        }

        if (outcome !== "ongoing") {
            const index = state.battles.indexOf(battle);
            if (index >= 0) state.battles.splice(index, 1);
        }

        // A capture already carries this round inside its single event-chain line.
        if (outcome !== "captured") {
            const suffix = outcome === "repelled" ? t("game.combat.suffix.repelled")
                : result.defenderBroken ? t("game.combat.suffix.breach") : "";
            const report: BattleReport = {
                attacker: attacker.nation,
                defender: defenderNation,
                rounds: battle.rounds,
                attackLoss: result.attackerLoss,
                defenseLoss: result.defenderLoss,
                totalAttackLoss: battle.attackLoss,
                totalDefenseLoss: battle.defenseLoss,
                breach: result.defenderBroken,
                outcome: outcome === "broken" ? "repelled" : outcome,
            };
            core.log(
                t("game.combat.round", {
                    nation: core.nationChip(attacker.nation), province: province.name, day: battle.rounds,
                    attackerLoss: result.attackerLoss, defenderLoss: result.defenderLoss, suffix,
                }),
                "combat",
                attacker.nation,
                false,
                {
                    kind: "battle-round",
                    nation: attacker.nation,
                    site: battle.province,
                    province: province.name,
                    battle: report,
                },
            );
        }
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