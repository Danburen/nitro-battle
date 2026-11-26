import type { Domain, Vec2 } from "./types.ts";
import { pMod } from "../../../utils/math.ts";

/** Wrap a lift-plane point back into the fundamental domain. */
export function canonicalPoint(point: Vec2, domain: Domain): Vec2 {
    return {
        x: domain.periodicX ? pMod(point.x, domain.width) : point.x,
        y: domain.periodicY ? pMod(point.y, domain.height) : point.y,
    };
}

/** Shortest displacement from `a` to `b` on a (possibly periodic) domain. */
export function periodicDelta(a: Vec2, b: Vec2, domain: Domain): Vec2 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;

    if (domain.periodicX) dx -= Math.round(dx / domain.width) * domain.width;
    if (domain.periodicY) dy -= Math.round(dy / domain.height) * domain.height;

    return { x: dx, y: dy };
}

export function periodicDistanceSq(a: Vec2, b: Vec2, domain: Domain): number {
    const d = periodicDelta(a, b, domain);
    return d.x * d.x + d.y * d.y;
}

export function periodicDistance(a: Vec2, b: Vec2, domain: Domain): number {
    const d = periodicDelta(a, b, domain);
    return Math.hypot(d.x, d.y);
}

/** 2D cross product. Positive means (b - a) is counter-clockwise from (c - a). */
export function cross(ax: number, ay: number, bx: number, by: number): number {
    return ax * by - ay * bx;
}

/**
 * Circumcenter of a triangle. Returns null for (nearly) collinear triangles,
 * whose circumcenter would be numerically unbounded.
 */
export function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));

    const scale = Math.abs(a.x) + Math.abs(a.y) +
        Math.abs(b.x) + Math.abs(b.y) +
        Math.abs(c.x) + Math.abs(c.y) + 1;

    if (Math.abs(d) < 1e-12 * scale * scale) {
        return null;
    }

    const aa = a.x * a.x + a.y * a.y;
    const bb = b.x * b.x + b.y * b.y;
    const cc = c.x * c.x + c.y * c.y;

    return {
        x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d,
        y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d,
    };
}

/** Signed polygon area and centroid in a single shoelace pass. */
export function polygonAreaCentroid(polygon: readonly Vec2[]): {
    area: number;
    centroid: Vec2;
} {
    if (polygon.length === 0) return { area: 0, centroid: { x: 0, y: 0 } };

    let area = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0, n = polygon.length; i < n; i++) {
        const p = polygon[i];
        const q = polygon[(i + 1) % n];
        const c = p.x * q.y - q.x * p.y;
        area += c;
        cx += (p.x + q.x) * c;
        cy += (p.y + q.y) * c;
    }

    const halfArea = area * 0.5;

    if (Math.abs(area) < 1e-12) {
        let sx = 0;
        let sy = 0;
        for (const p of polygon) {
            sx += p.x;
            sy += p.y;
        }
        return {
            area: halfArea,
            centroid: { x: sx / polygon.length, y: sy / polygon.length },
        };
    }

    return {
        area: halfArea,
        centroid: { x: cx / (6 * halfArea), y: cy / (6 * halfArea) },
    };
}
