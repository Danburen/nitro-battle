import { pMod } from "../utils/math.ts";

/**
 * Deep-map features (province counters, capacity badges) need this much
 * magnification, so the zoom-in ceiling never drops below it on small windows.
 */
const MIN_MAX_ZOOM = 1.6;

/**
 * The map is a torus: a viewport wider or taller than the map itself would
 * repeat the same cells and break wrapped rendering. Keep the visible strip
 * comfortably inside the world on both axes.
 */
const MAX_VIEW_RATIO = 0.9;

export class Camera {
    x: number;
    y: number;
    zoom = 1;
    readonly worldW: number;
    readonly worldH: number;
    private viewW = 0;
    private viewH = 0;

    constructor(worldW: number, worldH: number) {
        this.worldW = worldW;
        this.worldH = worldH;
        this.x = worldW / 2;
        this.y = worldH / 2;
    }

    /**
     * Zoom-out floor derived from the viewport: at this zoom the visible world
     * is at most `MAX_VIEW_RATIO` of the map on either axis, so no periodic copy
     * can leak into view.
     */
    get minZoom(): number {
        if (!(this.viewW > 0 && this.viewH > 0)) return 0;
        if (!(this.worldW > 0 && this.worldH > 0)) return 0;
        return Math.max(
            this.viewW / (this.worldW * MAX_VIEW_RATIO),
            this.viewH / (this.worldH * MAX_VIEW_RATIO),
        );
    }

    /**
     * Zoom-in ceiling derived from the map itself: the visible world strip can
     * never be narrower than min(worldW, worldH), so no map can be magnified
     * into a single hex tile. Deep-map zoom and the torus floor still win.
     */
    get maxZoom(): number {
        const shortSide = Math.min(this.worldW, this.worldH);
        if (!(shortSide > 0)) return MIN_MAX_ZOOM;
        const wide = Math.max(this.viewW, this.viewH) / shortSide;
        return Math.max(MIN_MAX_ZOOM, wide, this.minZoom);
    }

    private clampZoom(value: number): number {
        return Math.min(this.maxZoom, Math.max(this.minZoom, value));
    }

    /** Remember the canvas size and keep the current zoom inside its new bounds. */
    setViewport(viewW: number, viewH: number): void {
        this.viewW = viewW;
        this.viewH = viewH;
        this.zoom = this.clampZoom(this.zoom);
    }

    fit(viewW: number, viewH: number): void {
        this.setViewport(viewW, viewH);
        const fitZoom = this.worldW > 0 && this.worldH > 0
            ? Math.min(viewW / this.worldW, viewH / this.worldH) * 0.98
            : MIN_MAX_ZOOM;
        // A very large window cannot show the whole map without violating the
        // torus limit; the floor takes priority over a complete overview.
        this.zoom = this.clampZoom(fitZoom);
        this.x = this.worldW / 2;
        this.y = this.worldH / 2;
    }

    pan(dxScreen: number, dyScreen: number): void {
        this.x = pMod(this.x - dxScreen / this.zoom, this.worldW);
        this.y = pMod(this.y - dyScreen / this.zoom, this.worldH);
    }

    zoomAt(sx: number, sy: number, factor: number, viewW: number, viewH: number): void {
        this.setViewport(viewW, viewH);
        const before = this.screenToWorld(sx, sy, viewW, viewH);
        this.zoom = this.clampZoom(this.zoom * factor);
        const after = this.screenToWorld(sx, sy, viewW, viewH);
        this.x = pMod(this.x + (before.x - after.x), this.worldW);
        this.y = pMod(this.y + (before.y - after.y), this.worldH);
    }

    screenToWorld(sx: number, sy: number, viewW: number, viewH: number): { x: number; y: number } {
        return {
            x: this.x + (sx - viewW / 2) / this.zoom,
            y: this.y + (sy - viewH / 2) / this.zoom,
        };
    }

    centerOn(x: number, y: number): void {
        this.x = pMod(x, this.worldW);
        this.y = pMod(y, this.worldH);
    }
}
