/**
 * Return positive mod
 * @param v     {@link number}  the value to be mod
 * @param N     {@link number}  the mod base
 * @returns     {@link number}  the positive mod result
 */
export const pMod = (v: number, N: number) => {
    return ((v % N) + N) % N;
};


/**
 * Return no order key
 * @param a     {@link number}  the first value
 * @param b    {@link number}  the second value
 * @param N     {@link number}  the mod base
 * @returns     {@link number}  the no order key result
 */
export const getNoOrderDoubleKey = (a: number, b: number, N: number): number => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    return lo * N + hi;
}

export function clamp01(value: number): number {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}