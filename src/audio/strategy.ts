export type SoundName =
    | "select"
    | "move"
    | "attack"
    | "capture"
    | "stateFlip"
    | "annihilation"
    | "recruit"
    | "endTurn"
    | "error"
    | "victory"
    | "defeat";

export type SoundCategory = "critical" | "combat" | "production" | "ui";

export type SoundOverflow = "stop-oldest" | "drop-new" | "sacrifice-lowest";

export interface ToneVoice {
    readonly kind: "tone";
    readonly freq: number;
    readonly delay: number;
    readonly duration: number;
    readonly wave: OscillatorType;
    readonly gain: number;
    readonly slideTo?: number;
}

export interface NoiseVoice {
    readonly kind: "noise";
    readonly delay: number;
    readonly duration: number;
    readonly gain: number;
}

export type SoundVoice = ToneVoice | NoiseVoice;

/** Where the event happened relative to the player and the current camera. */
export interface SoundContext {
    readonly visible: boolean;
    readonly playerInvolved: boolean;
}

export const DEFAULT_SOUND_CONTEXT: SoundContext = { visible: true, playerInvolved: true };

export interface SoundProfile {
    readonly category: SoundCategory;
    readonly priority: number;
    /** Maximum simultaneously active instances of this exact sound. */
    readonly maxConcurrency: number;
    /** Minimum delay between two starts of this exact sound. */
    readonly minIntervalMs: number;
    readonly overflow: SoundOverflow;
    readonly mode: "immediate" | "batch";
    /** After an immediate sound, hold batched sounds so they do not talk over it. */
    readonly holdMs?: number;
    /** High-level transitions cancel queued battle/production sounds. */
    readonly clearPending?: boolean;
    /** Effective cap when the player is not involved and the event is off screen. */
    readonly backgroundConcurrency: number;
    readonly backgroundGain: number;
    /** Effective cap when the player is not involved but the event is on screen. */
    readonly visibleAiConcurrency: number;
    readonly visibleAiGain: number;
    readonly voices: readonly SoundVoice[];
}

const tone = (
    freq: number,
    delay: number,
    duration: number,
    wave: OscillatorType,
    gain = 1,
    slideTo?: number,
): ToneVoice => ({ kind: "tone", freq, delay, duration, wave, gain, ...(slideTo === undefined ? {} : { slideTo }) });

const noise = (delay: number, duration: number, gain = 0.5): NoiseVoice => ({ kind: "noise", delay, duration, gain });

/** Strategy-wide bus policy. Per-sound limits live on the profiles below. */
export const SOUND_POLICY = {
    windowMs: 120,
    maxActive: 3,
    /** Repeated instances in one window raise loudness a little instead of layering. */
    duplicateGain: 0.12,
    maxDuplicateGain: 1.4,
} as const;

export const SOUND_PROFILES: Record<SoundName, SoundProfile> = {
    select: {
        category: "ui",
        priority: 30,
        maxConcurrency: 1,
        minIntervalMs: 80,
        overflow: "drop-new",
        mode: "immediate",
        backgroundConcurrency: 1,
        backgroundGain: 1,
        visibleAiConcurrency: 1,
        visibleAiGain: 1,
        voices: [tone(660, 0, 0.06, "sine", 0.5)],
    },
    move: {
        category: "production",
        priority: 15,
        maxConcurrency: 1,
        minIntervalMs: 200,
        overflow: "drop-new",
        mode: "batch",
        backgroundConcurrency: 0,
        backgroundGain: 0,
        visibleAiConcurrency: 0,
        visibleAiGain: 0,
        voices: [tone(330, 0, 0.14, "triangle", 0.55, 520)],
    },
    attack: {
        category: "combat",
        priority: 40,
        maxConcurrency: 2,
        minIntervalMs: 220,
        overflow: "stop-oldest",
        mode: "batch",
        backgroundConcurrency: 0,
        backgroundGain: 0,
        visibleAiConcurrency: 1,
        visibleAiGain: 0.7,
        voices: [noise(0, 0.18, 0.7), tone(110, 0, 0.2, "square", 0.5, 55)],
    },
    capture: {
        category: "combat",
        priority: 70,
        maxConcurrency: 2,
        minIntervalMs: 280,
        overflow: "sacrifice-lowest",
        mode: "batch",
        backgroundConcurrency: 0,
        backgroundGain: 0,
        visibleAiConcurrency: 1,
        visibleAiGain: 0.75,
        voices: [
            tone(523, 0, 0.1, "triangle", 0.6),
            tone(659, 0.09, 0.1, "triangle", 0.6),
            tone(784, 0.18, 0.16, "triangle", 0.6),
        ],
    },
    stateFlip: {
        category: "critical",
        priority: 100,
        maxConcurrency: 1,
        minIntervalMs: 800,
        overflow: "stop-oldest",
        mode: "immediate",
        holdMs: 300,
        clearPending: true,
        backgroundConcurrency: 1,
        backgroundGain: 0.6,
        visibleAiConcurrency: 1,
        visibleAiGain: 0.9,
        voices: [
            tone(196, 0, 0.28, "sine", 0.5),
            tone(392, 0.05, 0.22, "triangle", 0.55),
            tone(587, 0.13, 0.22, "triangle", 0.5),
            tone(784, 0.21, 0.3, "triangle", 0.5),
        ],
    },
    annihilation: {
        category: "critical",
        priority: 95,
        maxConcurrency: 1,
        minIntervalMs: 500,
        overflow: "sacrifice-lowest",
        mode: "immediate",
        holdMs: 220,
        backgroundConcurrency: 1,
        backgroundGain: 0.5,
        visibleAiConcurrency: 1,
        visibleAiGain: 0.8,
        voices: [noise(0, 0.22, 0.65), tone(92, 0, 0.25, "square", 0.45, 48), tone(55, 0.12, 0.3, "sine", 0.4)],
    },
    recruit: {
        category: "production",
        priority: 20,
        maxConcurrency: 1,
        minIntervalMs: 300,
        overflow: "drop-new",
        mode: "batch",
        backgroundConcurrency: 0,
        backgroundGain: 0,
        visibleAiConcurrency: 0,
        visibleAiGain: 0,
        voices: [tone(880, 0, 0.05, "square", 0.3), tone(1175, 0.05, 0.07, "square", 0.25)],
    },
    endTurn: {
        category: "ui",
        priority: 80,
        maxConcurrency: 1,
        minIntervalMs: 300,
        overflow: "drop-new",
        mode: "immediate",
        holdMs: 170,
        backgroundConcurrency: 1,
        backgroundGain: 1,
        visibleAiConcurrency: 1,
        visibleAiGain: 1,
        voices: [tone(392, 0, 0.09, "sine", 0.55), tone(523, 0.09, 0.12, "sine", 0.55)],
    },
    error: {
        category: "ui",
        priority: 90,
        maxConcurrency: 1,
        minIntervalMs: 220,
        overflow: "drop-new",
        mode: "immediate",
        backgroundConcurrency: 1,
        backgroundGain: 1,
        visibleAiConcurrency: 1,
        visibleAiGain: 1,
        voices: [tone(180, 0, 0.12, "square", 0.35)],
    },
    victory: {
        category: "critical",
        priority: 110,
        maxConcurrency: 1,
        minIntervalMs: 1200,
        overflow: "sacrifice-lowest",
        mode: "immediate",
        holdMs: 500,
        clearPending: true,
        backgroundConcurrency: 1,
        backgroundGain: 1,
        visibleAiConcurrency: 1,
        visibleAiGain: 1,
        voices: [523, 659, 784, 1047].map((freq, index) => tone(freq, index * 0.13, 0.22, "triangle", 0.6)),
    },
    defeat: {
        category: "critical",
        priority: 110,
        maxConcurrency: 1,
        minIntervalMs: 1200,
        overflow: "sacrifice-lowest",
        mode: "immediate",
        holdMs: 500,
        clearPending: true,
        backgroundConcurrency: 1,
        backgroundGain: 1,
        visibleAiConcurrency: 1,
        visibleAiGain: 1,
        voices: [392, 330, 262, 196].map((freq, index) => tone(freq, index * 0.16, 0.26, "sine", 0.55)),
    },
};

export function mergeSoundContext(a: SoundContext, b: SoundContext): SoundContext {
    return {
        visible: a.visible || b.visible,
        playerInvolved: a.playerInvolved || b.playerInvolved,
    };
}

export function concurrencyFor(profile: SoundProfile, context: SoundContext): number {
    if (context.playerInvolved) return profile.maxConcurrency;
    if (context.visible) return Math.min(profile.maxConcurrency, profile.visibleAiConcurrency);
    return profile.backgroundConcurrency;
}

export function gainFor(profile: SoundProfile, context: SoundContext): number {
    if (context.playerInvolved) return 1;
    return context.visible ? profile.visibleAiGain : profile.backgroundGain;
}

export function profileDurationMs(profile: SoundProfile): number {
    let end = 0;
    for (const voice of profile.voices) end = Math.max(end, (voice.delay + voice.duration) * 1000);
    return end + 40;
}
