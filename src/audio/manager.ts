import { MixBus } from "./mix.ts";
import type { PlaybackHandle } from "./mix.ts";
import {
    concurrencyFor,
    DEFAULT_SOUND_CONTEXT,
    gainFor,
    mergeSoundContext,
    profileDurationMs,
    SOUND_POLICY,
    SOUND_PROFILES,
} from "./strategy.ts";
import type { SoundContext, SoundName, SoundProfile } from "./strategy.ts";

interface ActiveSound {
    readonly name: SoundName;
    readonly profile: SoundProfile;
    readonly handle: PlaybackHandle;
    readonly startedAt: number;
    readonly endsAt: number;
}

interface PendingSound {
    readonly name: SoundName;
    readonly profile: SoundProfile;
    context: SoundContext;
    count: number;
}

/**
 * Event-facing audio API. The strategy layer throttles same sounds and arbitrates
 * by priority; the mix layer keeps the master bus from clipping.
 */
export class SoundManager {
    muted = false;
    private readonly mix = new MixBus();
    private readonly active: ActiveSound[] = [];
    private readonly pending = new Map<SoundName, PendingSound>();
    private readonly lastPlayed = new Map<SoundName, number>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private flushAt = 0;
    private holdUntil = 0;

    /** Must be called from a user gesture at least once. */
    unlock(): void {
        this.mix.unlock();
    }

    toggle(): boolean {
        this.muted = !this.muted;
        if (this.muted) {
            this.clearPending();
            this.stopAll();
            this.lastPlayed.clear();
            this.holdUntil = 0;
        }
        return this.muted;
    }

    play(name: SoundName, context: SoundContext = DEFAULT_SOUND_CONTEXT): void {
        if (this.muted) return;
        this.mix.unlock();
        const profile = SOUND_PROFILES[name];
        const now = performance.now();
        this.prune(now);
        if (now - (this.lastPlayed.get(name) ?? -Infinity) < profile.minIntervalMs) return;
        if (concurrencyFor(profile, context) <= 0) return;

        if (profile.mode === "immediate") {
            if (profile.clearPending) this.clearPending();
            this.holdUntil = Math.max(this.holdUntil, now + (profile.holdMs ?? 0));
            if (this.pending.size) this.schedule();
            this.start(name, profile, context, 1, now);
            return;
        }

        const queued = this.pending.get(name);
        if (queued) {
            queued.count++;
            queued.context = mergeSoundContext(queued.context, context);
        } else {
            this.pending.set(name, { name, profile, context, count: 1 });
        }
        this.schedule();
    }

    private schedule(): void {
        if (!this.pending.size) return;
        const now = performance.now();
        if (this.flushTimer !== null) {
            if (this.holdUntil <= this.flushAt) return;
            clearTimeout(this.flushTimer);
        }
        this.flushAt = Math.max(now + SOUND_POLICY.windowMs, this.holdUntil);
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flushAt = 0;
            this.flush();
        }, Math.max(0, this.flushAt - now));
    }

    private flush(): void {
        if (this.muted) {
            this.pending.clear();
            return;
        }
        const now = performance.now();
        const ready = [...this.pending.values()]
            .filter((item) => now - (this.lastPlayed.get(item.name) ?? -Infinity) >= item.profile.minIntervalMs)
            .filter((item) => concurrencyFor(item.profile, item.context) > 0)
            .sort((a, b) => b.profile.priority - a.profile.priority);
        this.pending.clear();
        for (const item of ready) {
            const gainScale = Math.min(1 + (item.count - 1) * SOUND_POLICY.duplicateGain, SOUND_POLICY.maxDuplicateGain);
            this.start(item.name, item.profile, item.context, gainScale, now);
        }
    }

    private start(
        name: SoundName,
        profile: SoundProfile,
        context: SoundContext,
        gainScale: number,
        now: number,
    ): boolean {
        this.prune(now);
        const maxConcurrency = concurrencyFor(profile, context);
        if (maxConcurrency <= 0) return false;

        const same = this.active.filter((item) => item.name === name);
        if (same.length >= maxConcurrency) {
            if (profile.overflow === "drop-new") return false;
            // Free the same-sound slot first; the policy distinction matters at bus level.
            this.stop(same.reduce((oldest, item) => (item.startedAt < oldest.startedAt ? item : oldest)));
            this.prune(now);
        }

        if (this.active.length >= SOUND_POLICY.maxActive) {
            const victim = profile.overflow === "stop-oldest"
                ? this.oldestBelow(profile.priority)
                : profile.overflow === "sacrifice-lowest"
                    ? this.lowestBelow(profile.priority)
                    : null;
            if (!victim) return false;
            this.stop(victim);
            this.prune(now);
        }

        const handle = this.mix.play(profile, Math.min(gainScale * gainFor(profile, context), SOUND_POLICY.maxDuplicateGain));
        if (!handle) return false;
        this.active.push({
            name,
            profile,
            handle,
            startedAt: now,
            endsAt: now + profileDurationMs(profile),
        });
        this.lastPlayed.set(name, now);
        return true;
    }

    private oldestBelow(priority: number): ActiveSound | null {
        let victim: ActiveSound | null = null;
        for (const item of this.active) {
            if (item.profile.priority >= priority) continue;
            if (!victim || item.startedAt < victim.startedAt) victim = item;
        }
        return victim;
    }

    /** Cross-sound arbitration never sacrifices an equal or higher priority voice. */
    private lowestBelow(priority: number): ActiveSound | null {
        let victim: ActiveSound | null = null;
        for (const item of this.active) {
            if (item.profile.priority >= priority) continue;
            if (!victim || item.profile.priority < victim.profile.priority ||
                (item.profile.priority === victim.profile.priority && item.startedAt < victim.startedAt)) {
                victim = item;
            }
        }
        return victim;
    }

    private prune(now: number): void {
        for (let i = this.active.length - 1; i >= 0; i--) {
            if (this.active[i].endsAt <= now) this.active.splice(i, 1);
        }
    }

    private stop(item: ActiveSound): void {
        item.handle.stop();
        const index = this.active.indexOf(item);
        if (index >= 0) this.active.splice(index, 1);
    }

    private stopAll(): void {
        for (const item of this.active) item.handle.stop();
        this.active.length = 0;
    }

    private clearPending(): void {
        this.pending.clear();
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.flushAt = 0;
    }
}
