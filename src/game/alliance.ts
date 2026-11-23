import type { GameCore } from "./core.ts";
import { isAtWar, nationPower, setWar } from "./diplomacy.ts";
import { tendencyProfileOf } from "./ai/tendencies.ts";
import { isProtectedRelation, overlordOf } from "./access.ts";
import { createDiplomaticRequest } from "./requests.ts";
import { deny, minus, plus } from "./decision.ts";
import type { Alliance } from "./types/diplomacy.ts";
import type { DecisionFactor, DiplomaticDecision } from "./types/decision.ts";
import type { GameState } from "./types/state.ts";

export { inSameAlliance } from "./access.ts";

/** A camp costs a large one-off political investment. */
export const ALLIANCE_CREATE_COST = 40;
export const ALLIANCE_INVITE_COOLDOWN = 15;
export const ALLIANCE_MIN_DAY = 8;
export const ALLIANCE_MAX_MEMBERS = 4;

export const ALLIANCE_HELP_BODY = [
    "联盟由领袖花费 40 政治点创建阵营，再邀请志同道合的国家加入。",
    "成员共享通行权，并把彼此的敌人视为共同敌人：任一成员开战或被攻击时，其他成员会加入同一场战争。",
    "邀约前提是双方有共同敌人，或同属扩张主义/同属防御倾向且外交意愿足够。孤立主义国家不会主动创建联盟，也极少接受邀请。",
    "玩家拒绝结盟邀请后，[[turn:15]]内不会再次收到邀请，也不能主动申请加入同一联盟。",
].join("\n");

function living(state: GameState, nation: number): boolean {
    return Number.isInteger(nation) && nation >= 0 && state.nations[nation]?.alive === true;
}

export function allianceOf(state: GameState, nation: number): Alliance | null {
    if (!living(state, nation)) return null;
    return state.alliances.find((alliance) => alliance.members.includes(nation)) ?? null;
}

export function allianceById(state: GameState, id: number): Alliance | null {
    return state.alliances.find((alliance) => alliance.id === id) ?? null;
}

export function allianceLeader(state: GameState, nation: number): number | null {
    const alliance = allianceOf(state, nation);
    return alliance ? alliance.leader : null;
}

export function allianceCooldownDays(state: GameState, a: number, b: number): number {
    return Math.max(0, (state.allianceCooldown[a]?.[b] ?? -1) - state.day);
}

function setPairCooldown(state: GameState, a: number, b: number, day: number): void {
    if (state.allianceCooldown[a]?.[b] !== undefined) state.allianceCooldown[a][b] = day;
    if (state.allianceCooldown[b]?.[a] !== undefined) state.allianceCooldown[b][a] = day;
}

/** A nation both sides are already fighting, the strongest reason to coordinate. */
export function commonEnemy(state: GameState, a: number, b: number): number | null {
    if (a === b) return null;
    for (const nation of state.nations) {
        if (!nation.alive || nation.id === a || nation.id === b) continue;
        if (isAtWar(state, a, nation.id) && isAtWar(state, b, nation.id)) return nation.id;
    }
    return null;
}

function strategicKin(state: GameState, a: number, b: number): boolean {
    const first = tendencyProfileOf(state.nations[a]?.tendency);
    const second = tendencyProfileOf(state.nations[b]?.tendency);
    if (first.id === "isolated" || second.id === "isolated") return false;
    if (first.alliance < 3 || second.alliance < 3) return false;
    return (first.expansion >= 4 && second.expansion >= 4) ||
        (first.defense >= 4 && second.defense >= 4) ||
        first.id === second.id;
}

export function canCreateAlliance(state: GameState, nationId: number): boolean {
    if (state.winner !== null || state.day < ALLIANCE_MIN_DAY || !living(state, nationId)) return false;
    if (allianceOf(state, nationId) || overlordOf(state, nationId) >= 0) return false;
    const profile = tendencyProfileOf(state.nations[nationId].tendency);
    if (profile.id === "isolated") return false;
    return state.nations[nationId].politicalPower >= ALLIANCE_CREATE_COST;
}

export function createAlliance(core: GameCore, nationId: number): Alliance | null {
    const state = core.state;
    if (!canCreateAlliance(state, nationId)) return null;
    state.nations[nationId].politicalPower -= ALLIANCE_CREATE_COST;
    const alliance: Alliance = {
        id: state.nextAllianceId++, leader: nationId, members: [nationId], createdDay: state.day,
    };
    state.alliances.push(alliance);
    core.log(`${core.nationChip(nationId)} 创建联盟阵营（-${ALLIANCE_CREATE_COST} 政治点）`, "diplo", nationId, true, {
        kind: "global",
        nation: nationId,
    });
    core.emit({ type: "state" });
    return alliance;
}

/** Membership itself is free; the leader paid for the camp. */
export function joinAlliance(core: GameCore, alliance: Alliance, nationId: number): boolean {
    const state = core.state;
    if (state.winner !== null || !living(state, nationId) || alliance.members.includes(nationId)) return false;
    if (allianceOf(state, nationId) || alliance.members.length >= ALLIANCE_MAX_MEMBERS) return false;
    if (overlordOf(state, nationId) >= 0) return false;
    if (alliance.members.some((member) => isAtWar(state, member, nationId))) return false;
    alliance.members.push(nationId);
    // Membership means the camp's current enemies become shared enemies too.
    for (const member of alliance.members) {
        if (member === nationId) continue;
        for (const enemy of state.nations) {
            if (!enemy.alive || enemy.id === nationId || !isAtWar(state, member, enemy.id)) continue;
            if (isAtWar(state, nationId, enemy.id) || isProtectedRelation(state, nationId, enemy.id)) continue;
            setWar(state, nationId, enemy.id, true);
            core.log(`${core.nationChip(nationId)} 依联盟义务加入对 ${core.nationChip(enemy.id)} 的战争`, "diplo", nationId, true, {
                kind: "war",
                nation: nationId,
            });
            core.emit({ type: "war", aggressor: nationId, defender: enemy.id });
        }
    }
    core.invalidateReach();
    core.log(`${core.nationChip(nationId)} 加入 ${core.nationChip(alliance.leader)} 的联盟`, "diplo", nationId);
    core.emit({ type: "state" });
    return true;
}

export function leaveAlliance(core: GameCore, nationId: number): boolean {
    const state = core.state;
    const alliance = allianceOf(state, nationId);
    if (!alliance) return false;
    const oldLeader = alliance.leader;
    const index = alliance.members.indexOf(nationId);
    if (index >= 0) alliance.members.splice(index, 1);
    if (alliance.members.length === 0) {
        const allianceIndex = state.alliances.indexOf(alliance);
        if (allianceIndex >= 0) state.alliances.splice(allianceIndex, 1);
    } else if (alliance.leader === nationId) {
        alliance.leader = alliance.members[0];
    }
    setPairCooldown(state, nationId, oldLeader, state.day + ALLIANCE_INVITE_COOLDOWN);
    core.invalidateReach();
    core.log(`${core.nationChip(nationId)} 退出联盟`, "diplo", nationId);
    core.emit({ type: "state" });
    return true;
}

/** Eligibility is symmetric: shared enemy or matching strategic temperament. */
export function canInviteToAlliance(state: GameState, leader: number, target: number): boolean {
    if (state.winner !== null || !living(state, leader) || !living(state, target) || leader === target) return false;
    const alliance = allianceOf(state, leader);
    if (!alliance || alliance.leader !== leader || alliance.members.length >= ALLIANCE_MAX_MEMBERS) return false;
    if (alliance.members.includes(target) || allianceOf(state, target)) return false;
    if (isAtWar(state, leader, target)) return false;
    if (overlordOf(state, target) >= 0 || isProtectedRelation(state, leader, target)) return false;
    const profile = tendencyProfileOf(state.nations[target].tendency);
    if (profile.id === "isolated" || profile.alliance < 2) return false;
    if (allianceCooldownDays(state, leader, target) > 0) return false;
    return commonEnemy(state, leader, target) !== null || strategicKin(state, leader, target);
}

/** The invited nation's willingness; eligibility itself lives in `canInviteToAlliance`. */
export function decideAllianceInvite(state: GameState, leader: number, target: number): DiplomaticDecision {
    const alliance = allianceOf(state, leader);
    if (!alliance || alliance.members.length >= ALLIANCE_MAX_MEMBERS) return deny("联盟不存在或已满员");
    const enemy = commonEnemy(state, leader, target);
    if (enemy !== null) {
        return { accepts: true, factors: [plus(`共同的敌人：${state.nations[enemy].name}`)], verdict: "sure" };
    }
    const profile = tendencyProfileOf(state.nations[target].tendency);
    const kin = strategicKin(state, leader, target);
    const factors: DecisionFactor[] = [minus("没有共同敌人")];
    factors.push(kin ? plus("战略倾向相近") : minus("战略倾向不相近"));
    factors.push(profile.alliance >= 3 ? plus("结盟意愿足够") : minus("结盟意愿不足"));
    const powerOk = profile.alliance >= 4 && nationPower(state, leader) >= nationPower(state, target) * 0.8;
    if (profile.alliance >= 4) {
        factors.push(powerOk ? plus("我方实力达到其预期") : minus("我方实力未达到其预期"));
    }
    const accepts = (kin && profile.alliance >= 3) || powerOk;
    return { accepts, factors, verdict: accepts ? "likely" : (profile.alliance >= 4 ? "unlikely" : "refuse") };
}

/**
 * AI targets join at once; the player receives a pending invitation.
 * Returns true when the offer was delivered, not necessarily accepted.
 */
export function inviteToAlliance(core: GameCore, leader: number, target: number): boolean {
    const state = core.state;
    if (!canInviteToAlliance(state, leader, target)) return false;
    if (target === 0) {
        const alliance = allianceOf(state, leader);
        if (!alliance) return false;
        const request = createDiplomaticRequest(state, "alliance", leader, target, { allianceId: alliance.id });
        if (!request) return false;
        core.log(`${core.nationChip(leader)} 邀请 ${core.nationChip(target)} 加入联盟`, "diplo", leader);
        core.emit({ type: "state" });
        return true;
    }
    if (decideAllianceInvite(state, leader, target).accepts) {
        const alliance = allianceOf(state, leader);
        return alliance ? joinAlliance(core, alliance, target) : false;
    }
    setPairCooldown(state, leader, target, state.day + ALLIANCE_INVITE_COOLDOWN);
    core.log(`${core.nationChip(target)} 拒绝 ${core.nationChip(leader)} 的结盟邀请`, "diplo", target);
    core.emit({ type: "state" });
    return false;
}

/** The camp leader's willingness to accept an unsolicited join request. */
export function decideJoinRequest(state: GameState, leader: number, applicant: number): DiplomaticDecision {
    const enemy = commonEnemy(state, leader, applicant);
    if (enemy !== null) {
        return { accepts: true, factors: [plus(`共同的敌人：${state.nations[enemy].name}`)], verdict: "sure" };
    }
    const leaderProfile = tendencyProfileOf(state.nations[leader].tendency);
    const kin = strategicKin(state, leader, applicant);
    const factors: DecisionFactor[] = [minus("没有共同敌人")];
    factors.push(kin ? plus("战略倾向相近") : minus("战略倾向不相近"));
    factors.push(leaderProfile.alliance >= 3 ? plus("领袖结盟意愿足够") : minus("领袖结盟意愿不足"));
    const powerOk = leaderProfile.alliance >= 4 &&
        nationPower(state, applicant) >= nationPower(state, leader) * 0.6;
    if (leaderProfile.alliance >= 4) {
        factors.push(powerOk ? plus("申请方实力达到其预期") : minus("申请方实力未达到其预期"));
    }
    const accepts = (kin && leaderProfile.alliance >= 3) || powerOk;
    return { accepts, factors, verdict: accepts ? "likely" : (leaderProfile.alliance >= 4 ? "unlikely" : "refuse") };
}

/** Player (or AI) asks an existing camp to join; its leader decides immediately. */
export function requestJoinAlliance(core: GameCore, applicant: number, leader: number): boolean {
    const state = core.state;
    if (state.winner !== null || !living(state, applicant) || !living(state, leader)) return false;
    const alliance = allianceOf(state, leader);
    if (!alliance || alliance.leader !== leader || alliance.members.length >= ALLIANCE_MAX_MEMBERS) return false;
    if (allianceOf(state, applicant) || overlordOf(state, applicant) >= 0) return false;
    if (allianceCooldownDays(state, applicant, leader) > 0) return false;
    if (!alliance.members.includes(applicant) && !canInviteToAlliance(state, leader, applicant)) return false;
    if (leader === 0) {
        return inviteToAlliance(core, 0, applicant);
    }
    if (decideJoinRequest(state, leader, applicant).accepts) return joinAlliance(core, alliance, applicant);
    setPairCooldown(state, applicant, leader, state.day + ALLIANCE_INVITE_COOLDOWN);
    core.log(`${core.nationChip(leader)} 拒绝 ${core.nationChip(applicant)} 的入盟申请`, "diplo", leader);
    core.emit({ type: "state" });
    return false;
}

/** Remove dead members, keep a living leader, and drop empty camps. */
export function tickAlliances(core: GameCore): void {
    const state = core.state;
    let changed = false;
    for (let i = state.alliances.length - 1; i >= 0; i--) {
        const alliance = state.alliances[i];
        for (let j = alliance.members.length - 1; j >= 0; j--) {
            const member = alliance.members[j];
            if (living(state, member)) continue;
            alliance.members.splice(j, 1);
            changed = true;
        }
        if (alliance.members.length === 0) {
            state.alliances.splice(i, 1);
            changed = true;
            continue;
        }
        if (!alliance.members.includes(alliance.leader)) {
            alliance.leader = alliance.members[0];
            changed = true;
        }
    }
    if (changed) {
        core.invalidateReach();
        core.emit({ type: "state" });
    }
}

/**
 * Shared enemies: when any member fights, the rest join that side. Joining is
 * a raw war-matrix change (no extra war goal), matching the simplified system.
 * Returns the members that joined; `quiet` lets `startWar` emit one headline.
 */
export function applyAllianceWar(core: GameCore, aggressor: number, defender: number, quiet = false): number[] {
    const state = core.state;
    const joined: number[] = [];
    const defenderAlliance = allianceOf(state, defender);
    if (defenderAlliance) {
        for (const member of [...defenderAlliance.members]) {
            if (member === defender || member === aggressor || isProtectedRelation(state, member, aggressor)) continue;
            if (isAtWar(state, member, aggressor)) continue;
            setWar(state, member, aggressor, true);
            joined.push(member);
            if (!quiet) {
                core.log(`${core.nationChip(member)} 依联盟义务加入对 ${core.nationChip(aggressor)} 的战争`, "diplo", member, true, {
                    kind: "war",
                    nation: member,
                });
                core.emit({ type: "war", aggressor: member, defender: aggressor });
            }
        }
    }
    const aggressorAlliance = allianceOf(state, aggressor);
    if (aggressorAlliance) {
        for (const member of [...aggressorAlliance.members]) {
            if (member === aggressor || member === defender || isProtectedRelation(state, member, defender)) continue;
            if (isAtWar(state, member, defender)) continue;
            setWar(state, member, defender, true);
            joined.push(member);
            if (!quiet) {
                core.log(`${core.nationChip(member)} 依联盟义务加入对 ${core.nationChip(defender)} 的战争`, "diplo", member, true, {
                    kind: "war",
                    nation: member,
                });
                core.emit({ type: "war", aggressor: member, defender });
            }
        }
    }
    return joined;
}

function eligibleInviteTargets(state: GameState, leader: number): number[] {
    return state.nations
        .filter((nation) => nation.alive && canInviteToAlliance(state, leader, nation.id))
        .map((nation) => nation.id)
        .sort((a, b) => {
            const ac = commonEnemy(state, leader, a) !== null ? 0 : 1;
            const bc = commonEnemy(state, leader, b) !== null ? 0 : 1;
            return ac - bc || nationPower(state, b) - nationPower(state, a) || a - b;
        });
}

/** AI: build a camp when there is a partner, then keep extending it. */
export function runAIAlliances(core: GameCore, nationId: number): void {
    const state = core.state;
    if (state.winner !== null || !living(state, nationId)) return;
    const existing = allianceOf(state, nationId);
    if (!existing) {
        if (!canCreateAlliance(state, nationId)) return;
        if (tendencyProfileOf(state.nations[nationId].tendency).alliance < 3) return;
        if (eligibleInviteTargets(state, nationId).length === 0) return;
        const alliance = createAlliance(core, nationId);
        if (!alliance) return;
        for (const target of eligibleInviteTargets(state, nationId).slice(0, 2)) {
            inviteToAlliance(core, nationId, target);
        }
        return;
    }
    if (existing.leader !== nationId || existing.members.length >= ALLIANCE_MAX_MEMBERS) return;
    if (state.day % 3 !== nationId % 3) return;
    const targets = eligibleInviteTargets(state, nationId);
    if (targets.length > 0) inviteToAlliance(core, nationId, targets[0]);
}
