import { LCGRandom } from "../utils/LCGRandom.ts";
import { StandardAI } from "./ai.ts";
import type { AIController } from "./ai.ts";
import { attackTargets, reachable } from "./rules.ts";
import type { ReachResult } from "./rules.ts";
import { NEUTRAL } from "./types.ts";
import type { Army, Battle, EngineEvent, GameState, LogEvent, LogTone } from "./types.ts";

type Listener = (event: EngineEvent) => void;

const LOG_CAP = 240;

/** Shared state access and low-level army bookkeeping used by every domain module. */
export class GameCore {
    readonly state: GameState;
    readonly controllers: AIController[];
    readonly rand: LCGRandom;
    private readonly listeners = new Set<Listener>();
    private reachCache: ReachResult | null = null;
    private reachArmyId = -1;

    constructor(state: GameState) {
        this.state = state;
        this.rand = new LCGRandom(state.settings.seed ^ 0x51ab3c);
        this.controllers = state.nations
            .filter((nation) => !nation.isPlayer)
            .map((nation) => new StandardAI(nation.id, state.settings.seed));
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit(event: EngineEvent): void {
        for (const listener of this.listeners) listener(event);
    }

    log(text: string, tone: LogTone, nationId: number, major = false, event?: LogEvent): void {
        this.state.log.push({ day: this.state.day, text, tone, nationId, major, event });
        if (this.state.log.length > LOG_CAP) this.state.log.shift();
    }

    nationName(id: number): string {
        return id === NEUTRAL ? "中立守军" : this.state.nations[id].name;
    }

    /** Colored nation chip for log lines; falls back to plain text for invalid colors. */
    nationChip(id: number): string {
        if (id === NEUTRAL) return "中立守军";
        const nation = this.state.nations[id];
        const label = nation.name.replace(/[\\[\]]/g, "\\$&");
        return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(nation.color) ? `[[chip:${nation.color}|${label}]]` : label;
    }

    invalidateReach(): void {
        this.reachCache = null;
        this.reachArmyId = -1;
    }

    /** Movement flood for one army, cached until the next state mutation. */
    reachFor(army: Army): ReachResult {
        if (this.reachCache && this.reachArmyId === army.id) return this.reachCache;
        this.reachCache = reachable(this.state, army);
        this.reachArmyId = army.id;
        return this.reachCache;
    }

    targetsFor(army: Army): number[] {
        return attackTargets(this.state, army);
    }

    battleAt(site: number): Battle | null {
        return this.state.battles.find((battle) => battle.province === site) ?? null;
    }

    inBattle(armyId: number): boolean {
        return this.state.battles.some(
            (battle) => battle.attackerId === armyId || battle.defenderId === armyId,
        );
    }

    // ---- selection ----

    select(site: number | null): void {
        const state = this.state;
        state.selected = site;
        state.selectedArmyId = null;
        state.redeployArmyId = null;
        this.invalidateReach();
        this.emit({ type: "state" });
    }

    selectArmy(armyId: number): void {
        const army = this.state.armies.get(armyId);
        if (!army) return;
        this.state.selected = army.province;
        this.state.selectedArmyId = army.nation === 0 ? army.id : null;
        this.state.redeployArmyId = null;
        this.invalidateReach();
        this.emit({ type: "state" });
    }

    selectedArmy(): Army | null {
        const id = this.state.selectedArmyId;
        return id === null ? null : this.state.armies.get(id) ?? null;
    }

    cancelModes(): void {
        if (this.state.redeployArmyId !== null) {
            this.state.redeployArmyId = null;
            this.emit({ type: "state" });
        }
    }

    // ---- army bookkeeping ----

    placeArmy(army: Army, site: number): void {
        if (this.state.armyAt[army.province] === army.id) {
            this.state.armyAt[army.province] = null;
        }
        army.province = site;
        this.state.armyAt[site] = army.id;
    }

    removeArmy(army: Army, countLoss: boolean): void {
        const state = this.state;
        if (state.armyAt[army.province] === army.id) state.armyAt[army.province] = null;
        state.armies.delete(army.id);
        if (countLoss && army.nation === 0) state.stats.losses += army.regiments.length;
        if (countLoss) this.emit({ type: "army-lost", armyId: army.id, province: army.province, nationId: army.nation });
        for (let i = state.battles.length - 1; i >= 0; i--) {
            const battle = state.battles[i];
            if (battle.attackerId === army.id) state.battles.splice(i, 1);
            else if (battle.defenderId === army.id) battle.defenderId = null;
        }
        if (state.selectedArmyId === army.id) state.selectedArmyId = null;
        if (state.redeployArmyId === army.id) state.redeployArmyId = null;
    }

    /** Fold the moving army into the stationed one; org is strength-weighted. */
    mergeArmies(moving: Army, target: Army): void {
        const total = moving.regiments.length + target.regiments.length;
        target.org = Math.round(
            (target.org * target.regiments.length + moving.org * moving.regiments.length) / total,
        );
        target.regiments.push(...moving.regiments);
        this.removeArmy(moving, false);
        if (this.state.selectedArmyId === moving.id) this.state.selectedArmyId = target.id;
    }
}