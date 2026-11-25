import type { GameEngine } from "../game/engine.ts";
import type { BuildingKind } from "../game/types/building.ts";
import type { SoundManager } from "../audio/index.ts";
import type { ConfirmSpec } from "./confirm.ts";
import type { ColorMode } from "../render/types.ts";

/** Shared services every UI module and action handler relies on. */
export interface UIContext {
    readonly engine: GameEngine;
    readonly sound: SoundManager;
    readonly multiSelect: Set<number>;
    readonly splitChecks: Set<number>;
    toast(text: string): void;
    /** Router for the shared confirm/cancel card. */
    confirm(spec: ConfirmSpec): void;
    refresh(): void;
    centerSite(site: number): void;
}

export interface UICallbacks {
    onNewGame: () => void;
    onRestart: () => void;
    onHome: () => void;
    onMapMode: (mode: "province" | "state") => void;
    onColorMode: (mode: ColorMode) => void;
    onDeepZoom: (value: number) => void;
    getColorMode: () => ColorMode;
    getDeepZoom: () => number;
    onConstructionView: (kind: BuildingKind | null) => void;
    onClaimFocus: (stateId: number | null) => void;
    onClaimsOverlay: (on: boolean) => void;
    onCenterSite: (site: number) => void;
    /** Briefing selection changed: highlight the nation's borders; the camera is untouched. */
    onBriefingInspect: (nationId: number) => void;
    /** Briefing ended with a committed nation: start the campaign as it. */
    onBriefingEnd: (nationId: number) => void;
}