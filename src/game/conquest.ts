import { t } from "../i18n/index.ts";
import type { GameCore } from "./core.ts";
import { refreshGarrisonCapacity } from "./battle.ts";
import { BUILD_REFUND } from "./types/unit.ts";
import type { BattleReport } from "./types/log.ts";

export function transferControl(core: GameCore, site: number, nation: number): boolean {
    const state = core.state;
    const province = state.provinces[site];
    if (province.owner === nation) return false;
    province.owner = nation;
    province.garrison = 0;
    province.occupation = province.coreNation === nation ? 100 : 0;
    for (let i = state.construction.length - 1; i >= 0; i--) {
        const order = state.construction[i];
        if (order.site !== site || order.nation === nation) continue;
        const owner = state.nations[order.nation];
        if (owner?.alive) {
            owner.funds += order.paidFunds * BUILD_REFUND;
            owner.industry += order.paidIndustry * BUILD_REFUND;
        }
        state.construction.splice(i, 1);
    }
    const region = state.states[province.stateId];
    for (const member of region?.provinces ?? [site]) refreshGarrisonCapacity(state, state.provinces[member]);
    state.supplyDirty = true;
        return true;
}

export function claimProvince(core: GameCore, site: number, nation: number, previousOwner: number, battle?: BattleReport): void {
    const state = core.state;
    const province = state.provinces[site];
    if (province.owner !== previousOwner || !transferControl(core, site, nation)) return;
    state.stats.captures++;
    const region = state.states[province.stateId];
    const stateChanged = region !== undefined && site === region.center;
    const battleNote = battle
        ? t("game.conquest.battleNote", {
            province: province.name, day: battle.rounds,
            attackerLoss: battle.totalAttackLoss ?? battle.attackLoss,
            defenderLoss: battle.totalDefenseLoss ?? battle.defenseLoss,
            breach: battle.breach ? t("game.conquest.breach") : "",
        })
        : "";
    const flag = province.isCapital ? t("game.conquest.capitalFlag")
        : province.isCity ? t("game.conquest.cityFlag") : "";
    core.log(
        stateChanged
            ? t("game.conquest.captureState", {
                nation: core.nationChip(nation), province: province.name, state: region.name, flag, battleNote,
            })
            : t("game.conquest.captureProvince", {
                nation: core.nationChip(nation), province: province.name, flag, battleNote,
            }),
        "capture",
        nation,
        stateChanged,
        {
            kind: "capture",
            nation,
            previousOwner,
            site,
            province: province.name,
            stateName: region?.name,
            stateFlipped: stateChanged,
            battle,
        },
    );
    core.emit({ type: "capture", province: site, nationId: nation, eliminated: null, stateFlipped: stateChanged });
}

export function checkVictory(core: GameCore): void {
    const state = core.state;
    if (state.winner !== null) return;
    const player = state.nations[0];
    if (!player.alive) {
        state.winner = -1;
        core.log(t("game.conquest.defeat", { nation: core.nationChip(0) }), "system", 0, true, { kind: "global", nation: 0 });
        core.emit({ type: "gameover", winner: -1 });
        return;
    }
    if (!state.nations.some((nation) => !nation.isPlayer && nation.alive)) {
        state.winner = player.id;
        core.log(t("game.conquest.victory", { nation: core.nationChip(0) }), "system", 0, true, { kind: "global", nation: 0 });
        core.emit({ type: "gameover", winner: player.id });
    }
}
