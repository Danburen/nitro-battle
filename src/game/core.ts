import { t } from "../i18n/index.ts";
import { chipToken } from "../utils/spec.ts";
import { LCGRandom } from "../utils/LCGRandom.ts";
import { nationDisplayColor } from "./access.ts";
import { StandardAI } from "./ai/index.ts";
import type { AIController } from "./ai/index.ts";
import { NEUTRAL } from "./types/world.ts";
import type { Army } from "./types/organization.ts";
import type { EngineEvent } from "./types/events.ts";
import type { GameState } from "./types/state.ts";
import type { LogEvent, LogTone } from "./types/log.ts";

type Listener = (event: EngineEvent) => void;

const LOG_CAP = 240;

/** Shared state access and low-level army bookkeeping used by every domain module. */
export class GameCore {
    readonly state: GameState;
    readonly controllers: AIController[];
    readonly rand: LCGRandom;
    private readonly listeners = new Set<Listener>();

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
        return id === NEUTRAL ? t("game.core.neutralGarrison") : this.state.nations[id].name;
    }

    /** Colored nation chip for log lines; falls back to plain text for invalid colors. */
    nationChip(id: number): string {
        if (id === NEUTRAL) return t("game.core.neutralGarrison");
        const nation = this.state.nations[id];
        return chipToken(nationDisplayColor(this.state, id), nation.name);
    }

    // ---- selection ----

    select(site: number | null): void {
        this.state.selected = site;
        this.emit({ type: "state" });
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
    }
}