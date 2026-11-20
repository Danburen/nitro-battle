import { pMod } from "../utils/math.ts";

export class Camera {
    x: number;
    y: number;
    zoom = 1;
    readonly worldW: number;
    readonly worldH: number;
    minZoom = 0.3;
    maxZoom = 5;

    constructor(worldW: number, worldH: number) {
        this.worldW = worldW;
        this.worldH = worldH;
        this.x = worldW / 2;
        this.y = worldH / 2;
    }

    fit(viewW: number, viewH: number): void {
        this.zoom = Math.min(viewW / this.worldW, viewH / this.worldH) * 0.98;
        this.minZoom = this.zoom * 0.6;
        this.x = this.worldW / 2;
        this.y = this.worldH / 2;
    }

    pan(dxScreen: number, dyScreen: number): void {
        this.x = pMod(this.x - dxScreen / this.zoom, this.worldW);
        this.y = pMod(this.y - dyScreen / this.zoom, this.worldH);
    }

    zoomAt(sx: number, sy: number, factor: number, viewW: number, viewH: number): void {
        const before = this.screenToWorld(sx, sy, viewW, viewH);
        this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
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