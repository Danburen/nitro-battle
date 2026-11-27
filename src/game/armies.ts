/** Province army storage: one Army record per province, never a mobile force. */

import { t } from "../i18n/index.ts";
import { MAX_HP } from "./types/unit.ts";
import type { Army } from "./types/organization.ts";
import type { GameState } from "./types/state.ts";
import type { UnitKind } from "./types/unit.ts";

const ARMY_NAME_KEYS = [
    "game.armies.name.1", "game.armies.name.2", "game.armies.name.3", "game.armies.name.4", "game.armies.name.5",
    "game.armies.name.6", "game.armies.name.7", "game.armies.name.8", "game.armies.name.9", "game.armies.name.10",
] as const;

export function nextArmyName(state: GameState, nation: number): string {
    const used = new Set<string>();
    for (const army of state.armies.values()) {
        if (army.nation === nation) used.add(army.name);
    }
    for (const key of ARMY_NAME_KEYS) {
        const name = t(key);
        if (!used.has(name)) return name;
    }
    return t("game.armies.name.fallback", { id: state.nextArmyId });
}

export function spawnArmy(state: GameState, nation: number, province: number, kinds: UnitKind[], org: number): Army {
    const army: Army = {
        id: state.nextArmyId++,
        nation,
        name: nextArmyName(state, nation),
        province,
        regiments: kinds.map((kind) => ({ id: state.nextRegimentId++, kind, hp: MAX_HP })),
        org,
    };
    state.armies.set(army.id, army);
    state.armyAt[province] = army.id;
    return army;
}