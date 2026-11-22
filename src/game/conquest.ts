import type { GameCore } from "./core.ts";
import { refreshGarrisonCapacity } from "./battle.ts";
import { BUILD_REFUND } from "./types.ts";
import type { BattleReport } from "./types.ts";

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
    core.invalidateReach();
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
        ? `（${province.name}会战 D${battle.rounds}，攻损${battle.totalAttackLoss ?? battle.attackLoss}/守损${battle.totalDefenseLoss ?? battle.defenseLoss}${battle.breach ? "，防线崩溃" : ""}）`
        : "";
    const flag = province.isCapital ? "（首都）" : province.isCity ? "（城市）" : "";
    core.log(
        stateChanged
            ? `${core.nationChip(nation)} 攻占 ${province.name}，${region.name} 州易手${flag}${battleNote}`
            : `${core.nationChip(nation)} 占领 ${province.name}${flag}${battleNote}`,
        "capture",
        nation,
        stateChanged,
        {
            kind: "capture",
            nation,
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
        core.log(`${core.nationChip(0)} 失去全部正式领土，战役失败`, "system", 0, true, { kind: "global", nation: 0 });
        core.emit({ type: "gameover", winner: -1 });
        return;
    }
    if (!state.nations.some((nation) => !nation.isPlayer && nation.alive)) {
        state.winner = player.id;
        core.log(`${core.nationChip(0)} 吞并全部对手，赢得战役！`, "system", 0, true, { kind: "global", nation: 0 });
        core.emit({ type: "gameover", winner: player.id });
    }
}
