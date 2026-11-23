/**
 * Stateless rendering toolkit. Import from here when you only need geometry,
 * overlays or markers — this module graph never pulls in the DOM-bound
 * `MapRenderer` (import that directly from `./renderer.ts`).
 */
export { Camera } from "./camera.ts";
export {
    buildConstructionOverlay,
    CONSTRUCTION_BLOCKED_COLOR,
    CONSTRUCTION_COLORS,
    CONSTRUCTION_PENDING_TINT,
    PROVINCE_CAPACITY_MIN_ZOOM,
    constructionColor,
} from "./constructionOverlay.ts";
export type { ConstructionAreaOverlay, ConstructionOverlay } from "./constructionOverlay.ts";
export type { ColorMode, MapMode, NationHighlight } from "./types.ts";

// Rendering tooling, split by responsibility for reuse and testing.
export { addWrappedPolygonPath, drawEdges, pushRim, stateBoundary } from "./geometry.ts";
export {
    drawClaimFocus,
    drawClaimLand,
    drawClaimablePulse,
    drawConstructionLand,
    drawNationHighlight,
    drawPulseRegion,
} from "./overlays.ts";
export {
    drawCityMarker,
    drawProvinceCapacityMarkers,
    drawProvinceMarkers,
    drawRegionMarkers,
} from "./markers.ts";
export type { MarkerOptions } from "./markers.ts";
