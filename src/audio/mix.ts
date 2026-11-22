import type { NoiseVoice, SoundProfile, ToneVoice } from "./strategy.ts";

export interface PlaybackHandle {
    stop(): void;
}

interface VoiceStop {
    readonly source: AudioScheduledSourceNode;
    readonly env: GainNode;
    readonly start: number;
}

const MASTER_GAIN = 0.16;
const COMPRESSOR = { threshold: -18, knee: 12, ratio: 4, attack: 0.003, release: 0.25 } as const;
const LIMITER = { threshold: -1.5, knee: 0, ratio: 20, attack: 0.001, release: 0.05 } as const;

/**
 * Mix layer: renders voices and keeps the master bus bounded with a compressor
 * followed by a hard limiter so simultaneous sounds cannot clip.
 */
export class MixBus {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private limiter: DynamicsCompressorNode | null = null;

    /** Must be called from a user gesture at least once. */
    unlock(): void {
        if (this.ctx) {
            if (this.ctx.state === "suspended") void this.ctx.resume();
            return;
        }
        if (typeof window === "undefined") return;
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = MASTER_GAIN;
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = COMPRESSOR.threshold;
        this.compressor.knee.value = COMPRESSOR.knee;
        this.compressor.ratio.value = COMPRESSOR.ratio;
        this.compressor.attack.value = COMPRESSOR.attack;
        this.compressor.release.value = COMPRESSOR.release;
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = LIMITER.threshold;
        this.limiter.knee.value = LIMITER.knee;
        this.limiter.ratio.value = LIMITER.ratio;
        this.limiter.attack.value = LIMITER.attack;
        this.limiter.release.value = LIMITER.release;
        this.master.connect(this.compressor);
        this.compressor.connect(this.limiter);
        this.limiter.connect(this.ctx.destination);
    }

    play(profile: SoundProfile, gainScale = 1): PlaybackHandle | null {
        if (!this.ctx || !this.master) return null;
        const start = this.ctx.currentTime;
        const stops: VoiceStop[] = [];
        for (const voice of profile.voices) {
            const stop = voice.kind === "tone" ? this.tone(voice, start, gainScale) : this.noise(voice, start, gainScale);
            if (stop) stops.push(stop);
        }
        if (!stops.length) return null;
        let stopped = false;
        return {
            stop: () => {
                if (stopped || !this.ctx) return;
                stopped = true;
                const now = this.ctx.currentTime;
                for (const voice of stops) {
                    try {
                        if (voice.start > now) {
                            voice.source.stop(now);
                        } else {
                            voice.env.gain.cancelScheduledValues(now);
                            voice.env.gain.setTargetAtTime(0.0001, now, 0.008);
                            voice.source.stop(now + 0.03);
                        }
                    } catch {
                        // The voice may already have ended; there is nothing left to stop.
                    }
                }
            },
        };
    }

    private tone(voice: ToneVoice, start: number, gainScale: number): VoiceStop | null {
        if (!this.ctx || !this.master) return null;
        const t = start + voice.delay;
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        osc.type = voice.wave;
        osc.frequency.setValueAtTime(voice.freq, t);
        if (voice.slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(voice.slideTo, t + voice.duration);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(voice.gain * gainScale, t + 0.008);
        env.gain.exponentialRampToValueAtTime(0.001, t + voice.duration);
        osc.connect(env);
        env.connect(this.master);
        osc.start(t);
        osc.stop(t + voice.duration + 0.02);
        osc.onended = () => {
            osc.disconnect();
            env.disconnect();
        };
        return { source: osc, env, start: t };
    }

    private noise(voice: NoiseVoice, start: number, gainScale: number): VoiceStop | null {
        if (!this.ctx || !this.master) return null;
        const t = start + voice.delay;
        const length = Math.max(1, Math.floor(this.ctx.sampleRate * voice.duration));
        const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        const env = this.ctx.createGain();
        env.gain.value = voice.gain * gainScale;
        const filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 900;
        source.connect(filter);
        filter.connect(env);
        env.connect(this.master);
        source.start(t);
        source.stop(t + voice.duration + 0.02);
        source.onended = () => {
            source.disconnect();
            filter.disconnect();
            env.disconnect();
        };
        return { source, env, start: t };
    }
}
