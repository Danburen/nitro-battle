import { pMod } from "../../utils/math.ts";

// Eight unit gradients for 2D Perlin noise.
const GRADIENTS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.70710678, 0.70710678],
    [-0.70710678, 0.70710678],
    [0.70710678, -0.70710678],
    [-0.70710678, -0.70710678],
] as const;

const AMPLITUDE = Math.SQRT2;

function hash(x: number, y: number, seed: number): number {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h += Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}

function fade(t: number): number {
    return t * t * (3 - 2 * t);
}

/**
 * 2D Perlin noise with an integer lattice period.
 *
 * Wrapping the lattice indices with `pMod` makes the bottom/right gradients
 * identical to the top/left ones, so the field is continuous across the seam.
 * `periodX` / `periodY` must be positive integers; 0 disables wrapping.
 *
 * @returns noise value in [-1, 1]
 */
export function periodicNoise2D(
    x: number,
    y: number,
    periodX: number,
    periodY: number,
    seed: number,
): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);

    const x0 = periodX > 0 ? pMod(xi, periodX) : xi;
    const x1 = periodX > 0 ? pMod(xi + 1, periodX) : xi + 1;
    const y0 = periodY > 0 ? pMod(yi, periodY) : yi;
    const y1 = periodY > 0 ? pMod(yi + 1, periodY) : yi + 1;

    const g00 = GRADIENTS[hash(x0, y0, seed) & 7];
    const g10 = GRADIENTS[hash(x1, y0, seed) & 7];
    const g01 = GRADIENTS[hash(x0, y1, seed) & 7];
    const g11 = GRADIENTS[hash(x1, y1, seed) & 7];

    const dx0 = x - xi;
    const dy0 = y - yi;
    const dx1 = dx0 - 1;
    const dy1 = dy0 - 1;

    const n00 = g00[0] * dx0 + g00[1] * dy0;
    const n10 = g10[0] * dx1 + g10[1] * dy0;
    const n01 = g01[0] * dx0 + g01[1] * dy1;
    const n11 = g11[0] * dx1 + g11[1] * dy1;

    const u = fade(dx0);
    const v = fade(dy0);

    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    const value = (nx0 + v * (nx1 - nx0)) * AMPLITUDE;

    return Math.max(-1, Math.min(1, value));
}
