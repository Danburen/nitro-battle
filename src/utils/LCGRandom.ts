/**
 * Linear congruential pseudo-random number generator.
 * Formula: X(n+1) = (a * X(n) + c) mod m
 */
export class LCGRandom {
    private seed: number;
    private readonly a: number;
    private readonly c: number;
    private readonly m: number;

    /**
     * @param seed initial seed
     * @param a multiplier
     * @param c increment
     * @param m modulus
     */
    constructor(seed: number = Date.now(), a: number = 1664525, c: number = 1013904223, m: number = 2 ** 32) {
        // Normalize into [0, m): callers may pass signed int32 results (e.g. `seed ^ constant`).
        this.seed = ((Math.trunc(seed) % m) + m) % m;
        this.a = a;
        this.c = c;
        this.m = m;
    }

    /**
     * Return the next integer in [0, m).
     */
    next(): number {
        this.seed = (this.a * this.seed + this.c) % this.m;
        return this.seed;
    }

    /**
     * Return a float in [0, 1).
     */
    nextFloat(): number {
        return this.next() / this.m;
    }

    /**
     * Return an integer in [min, max).
     */
    nextInt(min: number, max: number): number {
        return min + Math.floor(this.nextFloat() * (max - min));
    }
}