export type SoundName =
    | "select"
    | "move"
    | "attack"
    | "captureTick"
    | "capture"
    | "recruit"
    | "endTurn"
    | "error"
    | "victory"
    | "defeat";

export class SoundManager {
    muted = false;
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;

    /** Must be called from a user gesture at least once. */
    unlock(): void {
        if (this.ctx) {
            if (this.ctx.state === "suspended") void this.ctx.resume();
            return;
        }
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.16;
        this.master.connect(this.ctx.destination);
    }

    toggle(): boolean {
        this.muted = !this.muted;
        return this.muted;
    }

    private tone(freq: number, start: number, dur: number, type: OscillatorType, gain = 1, slideTo?: number): void {
        if (!this.ctx || !this.master) return;
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(gain, start + 0.008);
        env.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc.connect(env);
        env.connect(this.master);
        osc.start(start);
        osc.stop(start + dur + 0.02);
    }

    private noise(start: number, dur: number, gain = 0.5): void {
        if (!this.ctx || !this.master) return;
        const length = Math.floor(this.ctx.sampleRate * dur);
        const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        const env = this.ctx.createGain();
        env.gain.value = gain;
        const filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 900;
        source.connect(filter);
        filter.connect(env);
        env.connect(this.master);
        source.start(start);
    }

    play(name: SoundName): void {
        if (this.muted) return;
        this.unlock();
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        switch (name) {
            case "select":
                this.tone(660, t, 0.06, "sine", 0.5);
                break;
            case "move":
                this.tone(330, t, 0.14, "triangle", 0.55, 520);
                break;
            case "attack":
                this.noise(t, 0.18, 0.7);
                this.tone(110, t, 0.2, "square", 0.5, 55);
                break;
            case "captureTick":
                this.tone(520, t, 0.08, "triangle", 0.55);
                break;
            case "capture":
                this.tone(523, t, 0.1, "triangle", 0.6);
                this.tone(659, t + 0.09, 0.1, "triangle", 0.6);
                this.tone(784, t + 0.18, 0.16, "triangle", 0.6);
                break;
            case "recruit":
                this.tone(880, t, 0.05, "square", 0.3);
                this.tone(1175, t + 0.05, 0.07, "square", 0.25);
                break;
            case "endTurn":
                this.tone(392, t, 0.09, "sine", 0.55);
                this.tone(523, t + 0.09, 0.12, "sine", 0.55);
                break;
            case "error":
                this.tone(180, t, 0.12, "square", 0.35);
                break;
            case "victory":
                [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.13, 0.22, "triangle", 0.6));
                break;
            case "defeat":
                [392, 330, 262, 196].forEach((f, i) => this.tone(f, t + i * 0.16, 0.26, "sine", 0.55));
                break;
        }
    }
}