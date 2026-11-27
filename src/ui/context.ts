import type { GameEngine } from "../game/engine.ts";
import type { BuildingKind } from "../game/types/building.ts";
import type { SoundManager } from "../audio/index.ts";
import type { ConfirmSpec } from "./confirm.ts";
import type { ColorMode } from "../render/types.ts";

/** Panels docked in the left shell, owned by GameUI's tab orchestrator. */
export type TabId = "deploy" | "construction" | "policy" | "diplomacy" | "trade" | "expansion";

/** Dataset-like payload so DOM clicks and debug commands share one action router. */
export interface UIDispatchData {
    readonly [key: string]: string | undefined;
}

/** DOM-derived extras that cannot be expressed in a dataset. */
export interface UIDispatchOptions {
    readonly ctrlKey?: boolean;
    readonly metaKey?: boolean;
    readonly inMapLayerOptions?: boolean;
    readonly cooldown?: boolean;
    readonly cooldownTooltip?: string | null;
    /** Selected state in the clicked diplomacy card, if any. */
    readonly selectedState?: number | null;
    /** Radio choice in the vassal request card. */
    readonly vassalType?: string;
}

/** Shared services every UI module and action handler relies on. */
export interface UIContext {
    readonly engine: GameEngine;
    readonly sound: SoundManager;
        toast(text: string): void;
    /** Router for the shared confirm/cancel card. */
    confirm(spec: ConfirmSpec): void;
    refresh(): void;
    centerSite(site: number): void;
    /** Single entry point for UI actions, used by both DOM events and debug commands. */
    dispatchAction(action: string, data?: UIDispatchData, options?: UIDispatchOptions): boolean;
    /** Open a dock panel with all dock/map-mode side effects applied. */
    openPanel(tab: TabId): void;
    /** Real turn entry point (briefing commit, sound, engine command). */
    endTurn(): void;
}

export interface UICallbacks {
    onNewGame: () => void;
    onRestart: () => void;
    onHome: () => void;
    onMapMode: (mode: "province" | "state") => void;
    onColorMode: (color: ColorMode) => void;
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
