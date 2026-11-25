/**
 * Canvas icon cache. External SVGs are loaded once, then rasterised once per
 * (icon, ink, size) into a tinted tile so the map can stamp them cheaply.
 * The UI reaches the same artwork through CSS masks (`ui/text.ts`).
 */
const ICON_DIR = "./assets/icons/";

const images = new Map<string, HTMLImageElement>();
const tiles = new Map<string, HTMLCanvasElement>();
let version = 0;

/** Bumps whenever an artwork finishes loading, so the renderer can repaint. */
export function iconVersion(): number {
    return version;
}

function imageFor(name: string): HTMLImageElement {
    let image = images.get(name);
    if (!image) {
        image = new Image();
        image.src = `${ICON_DIR}${name}.svg`;
        image.addEventListener("load", () => { version++; });
        images.set(name, image);
    }
    return image;
}

/**
 * Stamp one single-colour SVG glyph inked with `ink`, `size` px square at
 * (`x`, `y`). Returns false while the artwork is still loading.
 */
export function drawIcon(ctx: CanvasRenderingContext2D, name: string, ink: string, x: number, y: number, size: number): boolean {
    const image = imageFor(name);
    if (!image.complete || image.naturalWidth === 0) return false;
    const key = `${name}|${ink}|${size}`;
    let tile = tiles.get(key);
    if (!tile) {
        // Rasterise at 3x: the base layer is world-space and the camera zooms in.
        const px = Math.ceil(size * 3);
        tile = document.createElement("canvas");
        tile.width = px;
        tile.height = px;
        const art = tile.getContext("2d")!;
        art.drawImage(image, 0, 0, px, px);
        art.globalCompositeOperation = "source-in";
        art.fillStyle = ink;
        art.fillRect(0, 0, px, px);
        tiles.set(key, tile);
    }
    ctx.drawImage(tile, x, y, size, size);
    return true;
}