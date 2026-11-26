/**
 * World setup / configuration shared by the app bootstrap, the game generator
 * and the UI. These describe *how a world is created*, not live game state, so
 * they belong outside the game-domain type package.
 */

import { t } from "../i18n/index.ts";

export type MapSizeId = "small" | "standard" | "large";

export interface MapSizeProfile {
    readonly label: string;
    readonly cells: number;
    readonly width: number;
    readonly height: number;
}

export const MAP_SIZES: Readonly<Record<MapSizeId, MapSizeProfile>> = {
    small: { label: t("misc.settings.mapSize.small", { cells: 900 }), cells: 900, width: 1400, height: 900 },
    standard: { label: t("misc.settings.mapSize.standard", { cells: 1500 }), cells: 1500, width: 1800, height: 1100 },
    large: { label: t("misc.settings.mapSize.large", { cells: 2400 }), cells: 2400, width: 2200, height: 1400 },
};

export const NATION_COUNT_MAX = 12;

/** Exact cell count drives the aspect ratio preset used by the generator. */
export function mapSizeForCells(cells: number): MapSizeId {
    if (cells <= 1000) return "small";
    if (cells <= 1900) return "standard";
    return "large";
}

/** Optional terrain tuning exposed by the new-game dialog (advanced section). */
export interface TerrainTuning {
    readonly seaLevel?: number;
    readonly basePeriod?: number;
    readonly elevationExponent?: number;
    readonly moistureContrast?: number;
    readonly freqMultiplier?: number;
}

export interface GameSettings {
    readonly seed: number;
    readonly mapSize: MapSizeId;
    readonly nationCount: number;
    /** Exact cell count; overrides the map-size profile while keeping its aspect ratio. */
    readonly mapCells?: number;
    /** Omitted fields fall back to the terrain defaults. */
    readonly terrain?: TerrainTuning;
    /** Optional start compensation: weaker/smaller nations get extra farms and infrastructure. */
    readonly balanceNations?: boolean;
}
