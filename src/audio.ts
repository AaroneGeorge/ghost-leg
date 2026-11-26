// Ghost Leg "danger level" music.
//
// If /audio/level1..5.wav and /audio/end.wav exist they are played as beat-aligned
// loops; otherwise an original track is synthesised live with Web Audio. Same API either way.
//
//   level 1  calm: heartbeat + dark drone                     (site, lobby)
//   level 2  + ticking hats                                    (round, first half)
//   level 3  + minor arpeggio, brighter                        (round, second half)
//   level 4  + double-time heartbeat, dissonant stabs          (danger zone: the music may stop any second)
//   level 5  + 16th hats, siren, fast arps                     (deep in the danger zone)
//   stop()   hard stop: the music dies the instant the round ends (musical chairs)
//   sting()  result sting (major lift for a win, low hit otherwise)

export type Level = 0 | 1 | 2 | 3 | 4 | 5;

const BPM: Record<Level, number> = { 0: 92, 1: 92, 2: 100, 3: 108, 4: 122, 5: 138 };
const CUTOFF: Record<Level, number> = { 0: 200, 1: 320, 2: 520, 3: 900, 4: 1600, 5: 2800 };
const A = 55; // A1
const hz = (semi: number) => A * Math.pow(2, semi / 12);
const ARP = [24, 27, 31, 34, 31, 27, 36, 34]; // A3 C4 E4 G4 … (A minor 7)

class DangerMusic {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode; // music only (cut by stop())
  private drone!: { filter: BiquadFilterNode; gain: GainNode };
  private noise!: AudioBuffer;
  private level: Level = 0;
  private step = 0;
  private nextAt = 0;
  private timer: number | null = null;
  private buffers: AudioBuffer[] | null = null; // [level1..level5, end]
  private loading = false;
  private cur: { src: AudioBufferSourceNode; gain: GainNode; startedAt: number; len: number } | null = null;
  private ending = false; // the end song is looping (result screen → until a new table opens)
  muted = typeof localStorage !== "undefined" && localStorage.getItem("gl:muted") === "1";

  /** Must run inside a user gesture the first time (browser autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      this.bus = this.ctx.createGain();
      this.bus.connect(this.master);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.drone = this.makeDrone();
      void this.load();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (this.level > 0 && !this.buffers) this.run();
  }

  private async load() {
    if (this.loading || !this.ctx) return;
    this.loading = true;
    try {
      const names = ["level1", "level2", "level3", "level4", "level5", "end"];
      const ctx = this.ctx;
      this.buffers = await Promise.all(
        names.map(async (n) => {
          const r = await fetch(`/audio/${n}.wav`);
          if (!r.ok || !(r.headers.get("content-type") ?? "").includes("audio")) throw new Error("missing");
          return ctx.decodeAudioData(await r.arrayBuffer());
        }),
      );
      // recordings available: hand over from the synth
      this.halt();
      this.drone.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      if (this.level > 0) this.playSample(this.level);
    } catch {
      this.buffers = null; // keep the synth
    }
  }

  /** Crossfade to another loop. Danger levels share one 4-bar length, so the new loop starts at the same bar
   *  position and the beat carries on; the end song starts from its top. */
  private playSample(l: Level) {
    this.playLoop(this.buffers![l - 1]);
  }

  private playLoop(buf: AudioBuffer) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    let offset = 0;
    if (this.cur) {
      if (Math.abs(this.cur.len - buf.duration) < 0.01) offset = ((t - this.cur.startedAt) % this.cur.len) % buf.duration;
      this.cur.gain.gain.setTargetAtTime(0, t, 0.04);
      this.cur.src.stop(t + 0.3);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.06);
    src.connect(gain).connect(this.bus);
    src.start(t, offset);
    this.cur = { src, gain, startedAt: t - offset, len: buf.duration };
  }

  /** True while the end song loops; the site keeps it playing until a new table opens. */
  get isEnding() {
    return this.ending;
  }

  get unlocked() {
    return !!this.ctx && this.ctx.state === "running";
  }

  setMuted(m: boolean) {
    this.muted = m;
    localStorage.setItem("gl:muted", m ? "1" : "0");
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  setLevel(l: Level) {
    if (l === this.level && !this.ending) return;
    const wasOff = this.level === 0 && !this.ending;
    this.ending = false;
    this.level = l;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (l === 0) {
      if (this.cur) {
        this.cur.gain.gain.setTargetAtTime(0, t, 0.2);
        this.cur.src.stop(t + 1.2);
        this.cur = null;
      }
      this.halt();
      this.drone.gain.gain.setTargetAtTime(0, t, 0.3);
      return;
    }
    if (wasOff) {
      this.bus.gain.cancelScheduledValues(t);
      this.bus.gain.setValueAtTime(1, t);
    }
    if (this.buffers) return this.playSample(l);
    this.drone.gain.gain.setTargetAtTime(l >= 4 ? 0.16 : 0.12, t, 0.4);
    this.drone.filter.frequency.setTargetAtTime(CUTOFF[l], t, 0.6);
    this.run();
  }

  /** The music stops dead: a 0.45 s tape-stop, then silence. */
  stop() {
    // Musical chairs: the music dies on the exact frame the board freezes. A 12 ms fade only avoids a click.
    if (!this.ctx) return void (this.level = 0);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const FADE = 0.012;
    this.level = 0;
    this.halt();
    if (this.cur) {
      const { src, gain } = this.cur;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + FADE);
      src.stop(t + FADE + 0.005);
      this.cur = null;
    }
    this.drone.gain.gain.cancelScheduledValues(t);
    this.drone.gain.gain.setValueAtTime(this.drone.gain.gain.value, t);
    this.drone.gain.gain.linearRampToValueAtTime(0, t + FADE);
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(0, t + FADE);
  }

  /** Result sting. */
  sting(win: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (this.buffers) {
      // the end song loops until a new table opens (setLevel ends it)
      const t0 = ctx.currentTime;
      this.halt();
      this.level = 0;
      this.bus.gain.cancelScheduledValues(t0);
      this.bus.gain.setValueAtTime(1, t0);
      this.ending = true;
      this.playLoop(this.buffers[5]);
      return;
    }
    const t = ctx.currentTime + 0.05;
    const hit = (at: number, semis: number[], dur: number, vol: number, type: OscillatorType = "sawtooth") => {
      for (const s of semis) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const f = ctx.createBiquadFilter();
        o.type = type;
        o.frequency.value = hz(s);
        f.type = "lowpass";
        f.frequency.setValueAtTime(3200, at);
        f.frequency.exponentialRampToValueAtTime(500, at + dur);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(vol, at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.connect(f).connect(g).connect(this.master);
        o.start(at);
        o.stop(at + dur + 0.05);
      }
    };
    this.kick(t, 1.2);
    hit(t, [0, 12, 15], 0.22, 0.12);
    this.kick(t + 0.3, 1.2);
    hit(t + 0.3, [0, 12, 15], 0.22, 0.12);
    this.kick(t + 0.6, 1.4);
    if (win) {
      hit(t + 0.6, [12, 16, 19, 24], 2.6, 0.09); // A major lift
      [36, 40, 43, 48, 52].forEach((s, i) => hit(t + 0.75 + i * 0.09, [s], 0.5, 0.06, "triangle"));
    } else {
      hit(t + 0.6, [0, 3, 6, 12], 2.2, 0.1); // diminished thud
    }
  }

  // ── internals

  private makeDrone() {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = CUTOFF[1];
    filter.Q.value = 6;
    for (const [semi, det] of [[0, -7], [0, 7], [7, 0], [-12, 0]] as const) {
      const o = ctx.createOscillator();
      o.type = semi === -12 ? "sine" : "sawtooth";
      o.frequency.value = hz(semi);
      o.detune.value = det;
      o.connect(filter);
      o.start();
    }
    filter.connect(gain).connect(this.master);
    return { filter, gain };
  }

  private run() {
    if (!this.ctx || this.timer !== null || this.level === 0) return;
    this.nextAt = Math.max(this.nextAt, this.ctx.currentTime + 0.05);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private halt() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    const ctx = this.ctx!;
    while (this.nextAt < ctx.currentTime + 0.12) {
      this.playStep(this.step % 16, this.nextAt);
      this.nextAt += 60 / BPM[this.level] / 4;
      this.step++;
    }
  }

  private playStep(s: number, t: number) {
    const L = this.level;
    // heartbeat (lub-dub); doubles up as danger rises
    const beats = L <= 3 ? [0, 3] : L === 4 ? [0, 3, 8, 11] : [0, 3, 4, 8, 11, 12];
    if (beats.includes(s)) this.kick(t, s % 4 === 0 ? 1 : 0.65);
    // hats
    if (L >= 2 && (L >= 4 ? true : s % 2 === 0)) this.hat(t, s % 4 === 2 ? 0.09 : 0.05);
    // arpeggio
    if (L >= 3 && (L >= 5 || s % 2 === 0)) {
      const n = ARP[(L >= 5 ? s : s / 2) % ARP.length];
      this.pluck(t, hz(n + (L >= 5 && s >= 8 ? 12 : 0)), L >= 5 ? 0.05 : 0.07);
    }
    // dissonant stabs on beats 2 and 4
    if (L >= 4 && (s === 4 || s === 12)) {
      this.pluck(t, hz(36), 0.06, "square", 0.18);
      this.pluck(t, hz(37), 0.05, "square", 0.18);
    }
    // siren
    if (L >= 5 && (s === 6 || s === 14)) this.siren(t);
  }

  private kick(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.3);
  }

  private hat(t: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(f).connect(g).connect(this.bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.05);
  }

  private pluck(t: number, f0: number, vol: number, type: OscillatorType = "triangle", dur = 0.16) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = f0;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private siren(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(hz(48), t);
    o.frequency.linearRampToValueAtTime(hz(51), t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.25);
  }
}

export const music = new DangerMusic();
if (import.meta.env.DEV) (window as unknown as { __music: DangerMusic }).__music = music;
