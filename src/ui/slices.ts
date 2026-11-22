/**
 * Cooperative time slicing for expensive, on-demand panel work.
 *
 * Steps run in order, but only until the per-frame budget is spent; the rest
 * continue on later animation frames. Nothing runs while the panel is closed,
 * so opening a panel pays the cost once instead of every game refresh.
 */
export type SliceStep = () => void;

export function runSlices(steps: readonly SliceStep[], done: () => void, budgetMs = 4): () => void {
    const queue = [...steps];
    let cancelled = false;
    let frame = 0;

    const tick = (): void => {
        frame = 0;
        if (cancelled) return;
        const deadline = performance.now() + budgetMs;
        while (queue.length > 0 && performance.now() < deadline) queue.shift()!();
        if (queue.length > 0) {
            frame = requestAnimationFrame(tick);
        } else {
            done();
        }
    };

    frame = requestAnimationFrame(tick);
    return () => {
        cancelled = true;
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
    };
}
