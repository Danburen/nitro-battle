/** Engine events emitted to the renderer/UI layer. */
import type { BuildingKind } from "./building.ts";
import type { UnitKind } from "./unit.ts";

export type CombatOutcome = "ongoing" | "repelled" | "captured";

export type EngineEvent =
    | { type: "state" }
    | {
          type: "combat";
          province: number;
          attackerNation: number;
          defenderNation: number;
          outcome: CombatOutcome;
          attackerLoss: number;
          defenderLoss: number;
          garrisonBefore: number;
          garrisonAfter: number;
          attackerOrg: number;
          defenderOrg: number;
      }
    | { type: "capture"; province: number; nationId: number; eliminated: number | null; stateFlipped?: boolean }
    | { type: "army-lost"; armyId: number; province: number; nationId: number }
    | { type: "deploy"; province: number; armyId: number; nationId: number; kind: UnitKind }
    | { type: "build"; province: number; kind: BuildingKind; nationId: number }
    | { type: "war"; aggressor: number; defender: number }
    | { type: "claim-warning"; nation: number; stateId: number; stateName: string }
    | { type: "peace"; a: number; b: number }
    | { type: "relations" }
    | { type: "day"; day: number; seasonIndex: number }
    | { type: "gameover"; winner: number };
