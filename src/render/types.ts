import type { Vec2 } from "../terrain/voronoi/index.ts";

export type MapMode = "province" | "state";
export type ColorMode = "uniform" | "gradient" | "resource";

/** Briefing preview of one nation: its land cells and outer border segments. */
export interface NationHighlight {
    color: string;
    sites: number[];
    segments: [Vec2, Vec2][];
}
