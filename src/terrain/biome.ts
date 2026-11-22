import { periodicNoise2D } from "./noise.ts";
import type { Domain, Vec2, VoronoiGraph } from "./voronoi/index.ts";
import { fillWrappedPolygon } from "./voronoi/index.ts";
import {clamp01, pMod} from "../utils/math.ts";

/** Biome codes. A const object keeps this erasable (the project forbids enums). */
export const Biome = {
    OCEAN: 0,
    BEACH: 1,
    BARE: 2,
    ICE: 3,
    TUNDRA: 4,
    MOUNTAINS: 5,
    HILLS: 6,
    FOREST: 7,
    DESERT: 8,
    PLAINS: 9,
    MARSH: 10,

    LAKE: 11,
} as const;

export type Biome = (typeof Biome)[keyof typeof Biome];

/** Encoding order; count arrays use the same index. */
export const BIOME_VALUES: readonly Biome[] = [
    Biome.OCEAN,
    Biome.BEACH,
    Biome.BARE,
    Biome.ICE,
    Biome.TUNDRA,
    Biome.MOUNTAINS,
    Biome.HILLS,
    Biome.FOREST,
    Biome.DESERT,
    Biome.PLAINS,
    Biome.MARSH,

    Biome.LAKE,
];

/** Presentation and movement data for one biome. */
export interface BiomeProfile {
    readonly name: string;
    readonly color: string;
    readonly terrainCost: number;
    readonly passable: boolean;
}

export const BIOME_PROFILES: Readonly<Record<Biome, BiomeProfile>> = {
    [Biome.OCEAN]: { name: "Ocean", color: "#3B3F73", terrainCost: 8, passable: false },
    [Biome.BEACH]: { name: "Beach", color: "#DFCEA1", terrainCost: 1.3, passable: true },
    [Biome.DESERT]: { name: "Desert", color: "#E2B28A", terrainCost: 1.8, passable: true },
    [Biome.BARE]: { name: "Barren", color: "#CDB790", terrainCost: 1.7, passable: true },
    [Biome.PLAINS]: { name: "Plains", color: "#D2DCA9", terrainCost: 1, passable: true },
    [Biome.FOREST]: { name: "Forest", color: "#5F9E55", terrainCost: 1.6, passable: true },
    [Biome.MARSH]: { name: "Marsh", color: "#728657", terrainCost: 2.3, passable: true },
    [Biome.HILLS]: { name: "Hills", color: "#AAB898", terrainCost: 1.9, passable: true },
    [Biome.MOUNTAINS]: { name: "Mountains", color: "#B9B6BD", terrainCost: 3.2, passable: true },
    [Biome.TUNDRA]: { name: "Tundra", color: "#D6E0D9", terrainCost: 1.5, passable: true },
    [Biome.ICE]: { name: "Ice", color: "#ECECEC", terrainCost: 2.4, passable: true },
    [Biome.LAKE]: { name: "Lake", color: "#8fecff", terrainCost: 8, passable: false },
};

const BIOME_RGB = BIOME_VALUES.map((biome) => hexToRgb(BIOME_PROFILES[biome].color));

/** Continuous values for one cell. Both are normalized to [0, 1]. */
export interface TerrainSample {
    readonly elevation: number;
    readonly moisture: number;
}

/**
 * Base biome classification. This is generated once and never changes with
 * weather; snow is a separate overlay layer.
 */
export function classifyBiome(e: number, m: number, seaLevel = 0.20): Biome {
    if (e < seaLevel) return Biome.OCEAN;

    if (e > 0.42) {
        if (m < 0.35) return Biome.MOUNTAINS;
        if (m < 0.65) return Biome.TUNDRA;
        return Biome.ICE;
    }
    if (e > 0.30) {
        if (m < 0.30) return Biome.HILLS;
        return Biome.FOREST;
    }

    if (m < 0.30) return Biome.DESERT;
    if (m > 0.70) return Biome.MARSH;
    if (m > 0.50) return Biome.FOREST;
    return Biome.PLAINS;
}

/**
 * Temperature for the weather layer.
 *
 * `season` runs from -1 (deep winter) to 1 (hot summer). Only elevation and
 * season matter, so the result is seamless on a torus.
 */
export function computeTemperature(elevation: number, season: number): number {
    const elev = clamp01(elevation);
    const seasonal = Math.max(-1, Math.min(1, season)) * 0.35;
    const altitudePenalty = Math.max(0, elev - 0.32) * 2.0;

    return clamp01(0.75 + seasonal - altitudePenalty);
}

/** Snow overlay: 0 = none, 1 = shallow, 2 = deep. */
export function computeSnowCover(temperature: number, moisture: number): number {
    if (temperature < 0.15 && moisture > 0.3) return 2;
    if (temperature < 0.30 && moisture > 0.4) return 1;
    return 0;
}

export interface WeatherDebuff {
    readonly moveSpeed: number;
    readonly combatPenalty: number;
}

const NO_SNOW: WeatherDebuff = { moveSpeed: 1.0, combatPenalty: 1.0 };
const SHALLOW_SNOW: WeatherDebuff = { moveSpeed: 0.75, combatPenalty: 0.9 };
const DEEP_SNOW: WeatherDebuff = { moveSpeed: 0.50, combatPenalty: 0.8 };

/** Movement/combat multiplier for a snow-cover level. */
export function getWeatherDebuff(snowCover: number): WeatherDebuff {
    if (snowCover >= 2) return DEEP_SNOW;
    if (snowCover === 1) return SHALLOW_SNOW;
    return NO_SNOW;
}

// Terrain tuning defaults. The lab page exposes these four values.
export const BASE_PERIOD = 4;
export const ELEVATION_EXPONENT = 2;
export const MOISTURE_CONTRAST = 1.8;
/** Fixed octave frequency ratio. */
export const FREQ_MULTIPLIER = 2;

export interface TerrainParams {
    readonly seaLevel: number;
    readonly basePeriod: number;
    readonly elevationExponent: number;
    readonly moistureContrast: number;
    readonly freqMultiplier: number;
}

export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
    seaLevel: 0.20,
    basePeriod: BASE_PERIOD,
    elevationExponent: ELEVATION_EXPONENT,
    moistureContrast: MOISTURE_CONTRAST,
    freqMultiplier: FREQ_MULTIPLIER,
};

const DEFAULT_ELEVATION_AMPLITUDE = [
    1.0, 0.45, 0.2, 0.15, 0.07
];

const DEFAULT_MOISTURE_AMPLITUDE = [1.0, 0.4, 0.2, 0.1];

/** Optional per-layer amplitudes. Length = number of octaves; freq follows `freqMultiplier`. */
export interface TerrainFieldOptions extends Partial<TerrainParams> {
    elevationAmplitude?: readonly number[];
    moistureAmplitude?: readonly number[];
}

/**
 * Periodic 2D Perlin field with the same octave structure as the reference.
 *
 * `pow(e, elevationExponent)` sharpens the coast; `elevationGain` maps the
 * narrow result back into a usable [0, 1] range.
 */
export class TerrainField {
    private readonly domain: Domain;
    private readonly elevationSeed: number;
    private readonly moistureSeed: number;
    private readonly aspect: number;

    private readonly elevationAmplitude: readonly number[];
    private readonly moistureAmplitude: readonly number[];
    private readonly params: TerrainParams;

    constructor(domain: Domain, seed: number, opts: TerrainFieldOptions = {}) {
        this.domain = domain;
        this.elevationSeed = seed | 0;
        this.moistureSeed = (seed + 1) | 0;
        this.aspect = domain.width > 0 ? domain.height / domain.width : 1;

        this.elevationAmplitude = opts.elevationAmplitude ?? DEFAULT_ELEVATION_AMPLITUDE;
        this.moistureAmplitude = opts.moistureAmplitude ?? DEFAULT_MOISTURE_AMPLITUDE;

        this.params = {
            seaLevel: opts.seaLevel ?? DEFAULT_TERRAIN_PARAMS.seaLevel,
            basePeriod: opts.basePeriod ?? BASE_PERIOD,
            elevationExponent: opts.elevationExponent ?? ELEVATION_EXPONENT,
            moistureContrast: opts.moistureContrast ?? MOISTURE_CONTRAST,
            freqMultiplier: opts.freqMultiplier ?? FREQ_MULTIPLIER,
        };
    }

    sample(point: Vec2): TerrainSample {
        const nx = this.normalize(point.x, this.domain.width, this.domain.periodicX) - 0.5;
        const ny = this.normalize(point.y, this.domain.height, this.domain.periodicY) - 0.5;

        let elevation = 0;
        let elevationWeight = 0;
        let freq = 1;
        for (let i = 0; i < this.elevationAmplitude.length; i++) {
            const weight = this.elevationAmplitude[i];
            elevation += weight * this.noiseE(nx, ny, freq);
            elevationWeight += weight;
            freq *= this.params.freqMultiplier;
        }
        elevation = elevationWeight > 0 ? elevation / elevationWeight : 0.5;
        elevation = clamp01(
            Math.pow(elevation, this.params.elevationExponent),
        );

        let moisture = 0;
        let moistureWeight = 0;
        freq = 1;
        for (let i = 0; i < this.moistureAmplitude.length; i++) {
            const weight = this.moistureAmplitude[i];
            moisture += weight * this.noiseM(nx, ny, freq);
            moistureWeight += weight;
            freq *= this.params.freqMultiplier;
        }
        moisture = moistureWeight > 0 ? moisture / moistureWeight : 0.5;
        moisture = clamp01(
            (moisture - 0.5) * this.params.moistureContrast + 0.5,
        );

        return { elevation, moisture };
    }

    private noiseE(nx: number, ny: number, frequency: number): number {
        return this.noise(nx, ny, frequency, this.elevationSeed) * 0.5 + 0.5;
    }

    private noiseM(nx: number, ny: number, frequency: number): number {
        return this.noise(nx, ny, frequency, this.moistureSeed) * 0.5 + 0.5;
    }

    private noise(nx: number, ny: number, frequency: number, seed: number): number {
        const periodX = Math.max(
            2,
            Math.round(this.params.basePeriod * frequency),
        );
        const periodY = Math.max(2, Math.round(periodX * this.aspect));

        return periodicNoise2D(
            nx * periodX,
            ny * periodY,
            periodX,
            periodY,
            seed,
        );
    }

    private normalize(value: number, size: number, periodic: boolean): number {
        if (size <= 0) return 0;

        const wrapped = periodic ? pMod(value, size) : value;
        return wrapped / size;
    }
}

/** Read-only view of one cell; materialized on demand, never stored. */
export interface BiomeCell {
    readonly site: number;
    readonly elevation: number;
    readonly moisture: number;
    readonly biome: Biome;
    readonly terrainCost: number;
    readonly passable: boolean;
}

/** Compact terrain result: typed arrays, no per-cell objects. */
export class BiomeMap {
    readonly biome: Uint8Array;
    readonly elevation: Float32Array;
    readonly moisture: Float32Array;
    readonly snowCover: Uint8Array;
    readonly terrainCost: Float32Array;
    readonly passable: Uint8Array;

    constructor(count: number) {
        this.biome = new Uint8Array(count);
        this.elevation = new Float32Array(count);
        this.moisture = new Float32Array(count);
        this.snowCover = new Uint8Array(count);
        this.terrainCost = new Float32Array(count);
        this.passable = new Uint8Array(count);
    }

    get siteCount(): number {
        return this.biome.length;
    }

    biomeAt(site: number): Biome {
        return this.biome[site] as Biome;
    }

    cell(site: number): BiomeCell {
        return {
            site,
            elevation: this.elevation[site],
            moisture: this.moisture[site],
            biome: this.biomeAt(site),
            terrainCost: this.terrainCost[site],
            passable: this.passable[site] === 1,
        };
    }

    /** Number of cells per biome; index is the `Biome` code. */
    counts(): Uint32Array {
        const counts = new Uint32Array(BIOME_VALUES.length);

        for (const biome of this.biome) {
            counts[biome] += 1;
        }

        return counts;
    }

    /**
     * Recompute the snow overlay for a new season.
     *
     * The base biome, terrain cost and passability are not touched, so A*
     * never sees weather. Elevation and moisture are cached.
     */
    updateWeather(season: number): void {
        for (let site = 0; site < this.siteCount; site++) {
            if (this.biome[site] === Biome.OCEAN) {
                this.snowCover[site] = 0;
                continue;
            }

            const temperature = computeTemperature(this.elevation[site], season);
            this.snowCover[site] = computeSnowCover(
                temperature,
                this.moisture[site],
            );
        }
    }

    /** Convenience lookup for the currently cached snow level of a cell. */
    getWeatherDebuff(site: number): WeatherDebuff {
        return getWeatherDebuff(this.snowCover[site]);
    }

    /** Write terrain costs into the graph so `findCellPath` uses them by default. */
    applyToGraph(graph: VoronoiGraph): void {
        const count = Math.min(graph.cellCost.length, this.siteCount);

        for (let site = 0; site < count; site++) {
            graph.cellCost[site] = this.terrainCost[site];
        }
    }
}

/** `TerrainGenerator` only needs the graph's domain, sites and cells. */
export type TerrainSource = Pick<VoronoiGraph, "domain" | "sites" | "cells">;

/** Compose the periodic field, classifier and biome table into a `BiomeMap`. */
export class TerrainGenerator {
    private readonly field: TerrainField;
    private readonly seaLevel: number;

    constructor(seed: number, domain: Domain, opts: TerrainFieldOptions = {}) {
        this.field = new TerrainField(domain, seed, opts);
        this.seaLevel = opts.seaLevel ?? DEFAULT_TERRAIN_PARAMS.seaLevel;
    }

    build(source: TerrainSource): BiomeMap {
        const count = source.sites.length;
        const map = new BiomeMap(count);

        for (let site = 0; site < count; site++) {
            const cell = source.cells[site];
            const point = cell.bounded ? cell.centroid : source.sites[site];
            const sample = this.field.sample(point);
            const biome = classifyBiome(sample.elevation, sample.moisture, this.seaLevel);
            const profile = BIOME_PROFILES[biome];

            map.elevation[site] = sample.elevation;
            map.moisture[site] = sample.moisture;
            map.biome[site] = biome;
            map.terrainCost[site] = profile.terrainCost;
            map.passable[site] = profile.passable ? 1 : 0;
        }

        return map;
    }
}

/** Per-season color grade: tint rgb, blend amount, desaturation. Index = season. */
const SEASON_GRADES: ReadonlyArray<{ tint: readonly [number, number, number]; amount: number; desat: number }> = [
    { tint: [140, 220, 150], amount: 0.05, desat: 0 },
    { tint: [255, 196, 90], amount: 0.09, desat: 0 },
    { tint: [224, 130, 44], amount: 0.16, desat: 0.18 },
    { tint: [148, 178, 224], amount: 0.24, desat: 0.5 },
];

/** Biome color of one cell, shaded by elevation and graded by season. */
export function cellFillColor(map: BiomeMap, site: number, season = -1): string {
    const grade = season >= 0 && season < SEASON_GRADES.length ? SEASON_GRADES[season] : null;
    let rgb = shade(BIOME_RGB[map.biomeAt(site)], map.elevation[site]);
    if (grade) {
        if (grade.desat > 0) {
            const luma = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
            rgb = [
                rgb[0] + (luma - rgb[0]) * grade.desat,
                rgb[1] + (luma - rgb[1]) * grade.desat,
                rgb[2] + (luma - rgb[2]) * grade.desat,
            ];
        }
        rgb = [
            rgb[0] + (grade.tint[0] - rgb[0]) * grade.amount,
            rgb[1] + (grade.tint[1] - rgb[1]) * grade.amount,
            rgb[2] + (grade.tint[2] - rgb[2]) * grade.amount,
        ];
    }
    return `rgb(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0})`;
}

/** Fill Voronoi cells with their biome color, shaded by elevation. The range allows frame-sliced rebuilds. */
export function drawBiomes(
    ctx: CanvasRenderingContext2D,
    graph: VoronoiGraph,
    map: BiomeMap,
    width: number,
    height: number,
    season = -1,
    from = 0,
    to = graph.cells.length,
): void {
    for (let index = from; index < to; index++) {
        const cell = graph.cells[index];
        if (!cell.bounded) continue;

        ctx.fillStyle = cellFillColor(map, cell.site, season);
        fillWrappedPolygon(ctx, cell.polygon, graph, width, height);

        const snow = map.snowCover[cell.site];
        if (snow === 0) continue;

        ctx.fillStyle = snow >= 2
            ? "rgba(255, 255, 255, 0.9)"
            : "rgba(255, 255, 255, 0.5)";
        fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
    }
}

/** Render the final biome map one pixel at a time. */
export function drawPixelTerrain(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    seed: number,
    options: TerrainFieldOptions = {},
    season = 0,
): void {
    if (width <= 0 || height <= 0) return;

    const domain: Domain = { width, height, periodicX: true, periodicY: true };
    const field = new TerrainField(domain, seed, options);
    const image = ctx.createImageData(width, height);
    const data = image.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sample = field.sample({ x: x + 0.5, y: y + 0.5 });
            const biome = classifyBiome(sample.elevation, sample.moisture);
            const temperature = computeTemperature(sample.elevation, season);
            const snow = biome === Biome.OCEAN
                ? 0
                : computeSnowCover(temperature, sample.moisture);
            const rgb = applySnow(
                shade(BIOME_RGB[biome], sample.elevation),
                snow,
            );
            const index = (y * width + x) * 4;

            data[index] = rgb[0];
            data[index + 1] = rgb[1];
            data[index + 2] = rgb[2];
            data[index + 3] = 255;
        }
    }

    ctx.putImageData(image, 0, 0);
}

function hexToRgb(hex: string): readonly [number, number, number] {
    const value = Number.parseInt(hex.slice(1), 16);

    return [
        (value >> 16) & 0xff,
        (value >> 8) & 0xff,
        value & 0xff,
    ];
}

/** Slightly darken low ground and brighten high ground. */
function shade(
    rgb: readonly [number, number, number],
    elevation: number,
): readonly [number, number, number] {
    const factor = 0.7 + 0.6 * elevation;

    return [
        Math.min(255, Math.round(rgb[0] * factor)),
        Math.min(255, Math.round(rgb[1] * factor)),
        Math.min(255, Math.round(rgb[2] * factor)),
    ];
}

function applySnow(
    rgb: readonly [number, number, number],
    snowCover: number,
): readonly [number, number, number] {
    if (snowCover === 0) return rgb;

    const alpha = snowCover >= 2 ? 0.9 : 0.5;

    return [
        Math.round(rgb[0] * (1 - alpha) + 255 * alpha),
        Math.round(rgb[1] * (1 - alpha) + 255 * alpha),
        Math.round(rgb[2] * (1 - alpha) + 255 * alpha),
    ];
}
