// =====================================================================
//  SOUND: every sound is made in code with the Web Audio API. There are
//  no sound files. Effects are short and throttled so fast clicking or a
//  high game speed never turns into noise. The music is a slow, gentle
//  loop that writes its own melody as it goes.
// =====================================================================
(function () {
  const DEFAULTS = { mute: false, sfx: 0.6, music: 0.35 };
  let settings = Object.assign({}, DEFAULTS);
  let ctx = null, master, sfxBus, musicBus, revSend, noiseBuf;
  let hushed = false;          // true while the game catches up on time away
  const lastAt = {};           // real time each effect last played, for throttling
  const played = {};           // how many times each effect played (for testing)

  // Notes (Hz). The game is in D major; the pentatonic notes always sound pleasant together.
  const NOTE = {
    D2: 73.42, A2: 110.0, B2: 123.47, G2: 98.0, E2: 82.41, Fs2: 92.5,
    D3: 146.83, E3: 164.81, Fs3: 185.0, G3: 196.0, A3: 220.0, B3: 246.94, Cs4: 277.18,
    D4: 293.66, E4: 329.63, Fs4: 369.99, G4: 392.0, A4: 440.0, B4: 493.88, C4: 261.63,
    D5: 587.33, E5: 659.25, Fs5: 739.99, G5: 783.99, A5: 880.0, B5: 987.77, D6: 1174.66,
  };

  // ---------- setup ----------
  function clean(s) {
    const n = Object.assign({}, DEFAULTS, s || {});
    const v = x => Math.max(0, Math.min(1, Number(x) || 0));
    return { mute: !!n.mute, sfx: v(n.sfx), music: v(n.music) };
  }

  function makeContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);

    // A small room reverb, made from a burst of fading noise.
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    revSend = ctx.createGain(); revSend.connect(conv); conv.connect(wet); wet.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    applyLevels(true);
    return true;
  }

  // Browsers only allow sound after the player touches the page.
  function unlock() {
    if (!ctx && !makeContext()) return;
    if (!settings.mute && !document.hidden && ctx.state !== 'running') ctx.resume();
    Music.start();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (!settings.mute) ctx.resume();
  });

  function applyLevels(instant) {
    if (!ctx) return;
    const t = ctx.currentTime, k = instant ? 0.001 : 0.08;
    // Squared, so the sliders feel even to the ear.
    master.gain.setTargetAtTime(settings.mute ? 0 : 1, t, k);
    sfxBus.gain.setTargetAtTime(settings.sfx * settings.sfx * 1.5, t, k);
    musicBus.gain.setTargetAtTime(settings.music * settings.music * 2.0, t, k);
    if (settings.mute) setTimeout(() => { if (settings.mute && ctx.state === 'running') ctx.suspend(); }, 300);
    else if (!document.hidden && ctx.state !== 'running') ctx.resume();
  }

  function setSettings(s) { settings = clean(s); applyLevels(false); return settings; }
  function getSettings() { return Object.assign({}, settings); }
  function canPlay() { return ctx && ctx.state === 'running' && !settings.mute && !hushed; }

  // ---------- building blocks ----------
  // A single note with a quick attack and a natural fade.
  function tone(o) {
    const t = o.t !== undefined ? o.t : ctx.currentTime;
    const dur = o.dur || 0.3, vol = o.vol || 0.2;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + (o.glide || dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const atk = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dur);
    let out = g;
    osc.connect(g);
    if (o.lowpass) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lowpass; f.Q.value = 0.5;
      g.connect(f); out = f;
    }
    out.connect(o.bus || sfxBus);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; out.connect(s); s.connect(revSend); }
    osc.start(t); osc.stop(t + atk + dur + 0.05);
  }

  // A puff of filtered noise: rustles, knocks and clacks.
  function noise(o) {
    const t = o.t !== undefined ? o.t : ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter(); f.type = o.filter || 'bandpass'; f.frequency.value = o.freq || 1000; f.Q.value = o.Q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.attack || 0.003) + (o.dur || 0.08));
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(revSend); }
    src.start(t, Math.random() * 0.5); src.stop(t + (o.dur || 0.08) + 0.05);
  }

  // A bell: a few sine partials at bell-like ratios, the high ones fading first.
  function bell(freq, t, vol, dur, bus, rev) {
    const parts = [[1, 1], [2, 0.5], [2.76, 0.35], [4.07, 0.2], [5.4, 0.12], [0.5, 0.25]];
    for (const [r, a] of parts) {
      tone({ freq: freq * r, t, vol: vol * a, dur: dur / Math.sqrt(r + 0.5), bus, rev: rev === undefined ? 0.4 : rev });
    }
  }

  // A soft brass voice for horns and fanfares.
  function brass(freq, t, dur, vol, swell) {
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(250, t);
    f.frequency.linearRampToValueAtTime(swell || 1400, t + Math.min(0.35, dur * 0.4));
    f.frequency.linearRampToValueAtTime(600, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.25, dur * 0.3));
    g.gain.setValueAtTime(vol, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    f.connect(g); g.connect(sfxBus);
    const s = ctx.createGain(); s.gain.value = 0.35; g.connect(s); s.connect(revSend);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5; const lg = ctx.createGain(); lg.gain.value = 6;
    lfo.connect(lg);
    for (const det of [-6, 5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
      lg.connect(o.detune);
      o.connect(f); o.start(t); o.stop(t + dur + 0.4);
    }
    lfo.start(t); lfo.stop(t + dur + 0.4);
  }

  // Skip an effect if it played less than `gap` real seconds ago.
  function throttle(key, gap) {
    const now = performance.now() / 1000;
    if (lastAt[key] && now - lastAt[key] < gap) return false;
    lastAt[key] = now;
    return true;
  }
  const jitter = (x, amt) => x * (1 + (Math.random() * 2 - 1) * amt);

  // ---------- the effects ----------
  const FX = {
    // Gathering by hand: a soft, slightly different click every time.
    food() {
      noise({ freq: jitter(3200, 0.15), Q: 0.8, vol: 0.22, dur: 0.07, rate: 0.8 });
      noise({ freq: jitter(1800, 0.2), Q: 2, vol: 0.12, dur: 0.05, t: ctx.currentTime + 0.035 });
    },
    wood() {
      tone({ type: 'sine', freq: jitter(240, 0.08), freqEnd: 110, dur: 0.1, vol: 0.4, glide: 0.08 });
      noise({ freq: jitter(1300, 0.15), Q: 3, vol: 0.18, dur: 0.04 });
    },
    stone() {
      tone({ type: 'triangle', freq: jitter(1500, 0.1), freqEnd: 900, dur: 0.05, vol: 0.16, glide: 0.04 });
      noise({ filter: 'highpass', freq: 2800, vol: 0.16, dur: 0.035 });
      tone({ type: 'sine', freq: jitter(180, 0.05), freqEnd: 120, dur: 0.06, vol: 0.18 });
    },
    // Found skins, herbs or ore: a tiny sparkle.
    find() {
      const t = ctx.currentTime + 0.06;
      tone({ freq: NOTE.A5 * 2, t, dur: 0.18, vol: 0.06, rev: 0.4 });
      tone({ freq: NOTE.D6 * 2, t: t + 0.07, dur: 0.25, vol: 0.05, rev: 0.4 });
    },
    // Something got built: a two-note chime.
    build() {
      const t = ctx.currentTime;
      const pairs = [[NOTE.A5, NOTE.D6], [NOTE.Fs5, NOTE.B5], [NOTE.E5, NOTE.A5], [NOTE.D5, NOTE.Fs5]];
      const [a, b] = pairs[Math.floor(Math.random() * pairs.length)];
      bell(a, t, 0.09, 0.9, sfxBus, 0.3);
      bell(b, t + 0.09, 0.09, 1.2, sfxBus, 0.3);
    },
    recruit() {
      const t = ctx.currentTime;
      tone({ type: 'triangle', freq: NOTE.D5, t, dur: 0.12, vol: 0.1, lowpass: 2500 });
      tone({ type: 'triangle', freq: NOTE.A5, t: t + 0.07, dur: 0.2, vol: 0.1, lowpass: 2500, rev: 0.2 });
    },
    // Learned an upgrade: a rising arpeggio.
    learn() {
      const t = ctx.currentTime;
      [NOTE.D5, NOTE.Fs5, NOTE.A5, NOTE.D6].forEach((f, i) => bell(f, t + i * 0.08, 0.07, 1.0 + i * 0.2, sfxBus, 0.4));
    },
    coin() {
      const t = ctx.currentTime;
      tone({ type: 'triangle', freq: 1975, t, dur: 0.08, vol: 0.09 });
      tone({ type: 'triangle', freq: 2637, t: t + 0.06, dur: 0.35, vol: 0.09, rev: 0.3 });
    },
    // Raiders: a war horn, a low call then a fifth above.
    horn() {
      const t = ctx.currentTime;
      brass(NOTE.D3, t, 0.7, 0.18, 1100);
      brass(NOTE.A3, t + 0.75, 1.4, 0.2, 1500);
    },
    fanfare() {
      const t = ctx.currentTime;
      brass(NOTE.D4, t, 0.18, 0.12, 2200);
      brass(NOTE.Fs4, t + 0.2, 0.18, 0.12, 2200);
      brass(NOTE.A4, t + 0.4, 0.18, 0.12, 2200);
      brass(NOTE.D5, t + 0.6, 0.9, 0.13, 2400);
    },
    defeat() {
      const t = ctx.currentTime;
      [NOTE.A4, NOTE.G4, NOTE.E4, NOTE.D4].forEach((f, i) =>
        tone({ type: 'triangle', freq: f, t: t + i * 0.32, dur: 0.6, vol: 0.12, lowpass: 1200, rev: 0.4 }));
    },
    trader() {
      const t = ctx.currentTime;
      [NOTE.A5, NOTE.B5, NOTE.D6].forEach((f, i) => tone({ type: 'triangle', freq: f, t: t + i * 0.09, dur: 0.25, vol: 0.06, rev: 0.4 }));
      noise({ filter: 'highpass', freq: 6000, vol: 0.05, dur: 0.25, t: t + 0.05 });
    },
    // A new age: a deep bell tolls three times.
    newAge() {
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) bell(NOTE.D3, t + i * 1.6, 0.22, 5, sfxBus, 0.6);
      bell(NOTE.A3, t + 4.8, 0.12, 5, sfxBus, 0.6);
      bell(NOTE.D4, t + 4.8, 0.1, 5, sfxBus, 0.6);
    },
    wonder() {
      const t = ctx.currentTime;
      bell(NOTE.D4, t, 0.16, 4, sfxBus, 0.6);
      [NOTE.D5, NOTE.Fs5, NOTE.A5, NOTE.D6].forEach((f, i) => bell(f, t + 0.3 + i * 0.12, 0.06, 2.5, sfxBus, 0.5));
    },
    // A choice event: two soft bells, like a knock at the door.
    event() {
      const t = ctx.currentTime;
      bell(NOTE.A4, t, 0.1, 1.2, sfxBus, 0.3);
      bell(NOTE.E5, t + 0.16, 0.1, 1.6, sfxBus, 0.3);
    },
    sick() {
      tone({ type: 'sine', freq: NOTE.Fs3, freqEnd: NOTE.E3, dur: 0.8, vol: 0.08, attack: 0.1, lowpass: 900, rev: 0.3 });
    },
  };
  // Minimum real seconds between repeats, so nothing turns into a din.
  const GAP = {
    food: 0.04, wood: 0.04, stone: 0.04, find: 0.3, build: 0.15, recruit: 0.12, learn: 0.3, coin: 0.15,
    horn: 20, fanfare: 3, defeat: 3, trader: 10, newAge: 6, wonder: 6, sick: 15, event: 2,
  };

  function play(name) {
    if (!canPlay() || !FX[name] || settings.sfx <= 0) return;
    if (!throttle(name, GAP[name] || 0.1)) return;
    played[name] = (played[name] || 0) + 1;
    try { FX[name](); } catch (e) { /* never let sound break the game */ }
  }

  // For the samples in the Sound menu: ignores the repeat limits.
  function preview(name) {
    if (!ctx || settings.mute || !FX[name]) return;
    lastAt[name] = performance.now() / 1000;
    try { FX[name](); } catch (e) { /* ignore */ }
  }

  // ---------- music ----------
  // A slow folk-style loop: a warm pad holds each chord, a low note marks
  // the bar, and a plucked melody wanders the pentatonic scale. Every few
  // phrases it rests, so it never wears on you.
  const Music = (function () {
    const BEAT = 0.85;                  // seconds per beat (about 70 bpm)
    const CHORDS = {
      D: [NOTE.D3, NOTE.Fs3, NOTE.A3], G: [NOTE.G3, NOTE.B3, NOTE.D4], A: [NOTE.A3, NOTE.Cs4, NOTE.E4],
      Bm: [NOTE.B3, NOTE.D4, NOTE.Fs4], Em: [NOTE.E3, NOTE.G3, NOTE.B3],
    };
    const BASS = { D: NOTE.D2, G: NOTE.G2, A: NOTE.A2, Bm: NOTE.B2, Em: NOTE.E2 };
    const PROGS = [
      ['D', 'G', 'D', 'A', 'Bm', 'G', 'A', 'D'],
      ['D', 'Bm', 'G', 'A', 'D', 'Em', 'A', 'D'],
      ['G', 'D', 'Em', 'A', 'G', 'D', 'A', 'D'],
    ];
    const SCALE = [NOTE.D4, NOTE.E4, NOTE.Fs4, NOTE.A4, NOTE.B4, NOTE.D5, NOTE.E5, NOTE.Fs5, NOTE.A5];
    let timer = null, nextBar = 0, bar = 0, prog = PROGS[0], idx = 4, phrase = 0;

    function pad(chord, t, dur) {
      for (const f of CHORDS[chord]) {
        for (const det of [-7, 7]) {
          tone({ type: 'triangle', freq: f, t, dur, vol: 0.022, attack: 1.0, detune: det, lowpass: 900, bus: musicBus, rev: 0.5 });
        }
      }
      tone({ type: 'sine', freq: BASS[chord], t, dur: dur * 0.8, vol: 0.09, attack: 0.08, bus: musicBus });
    }
    function pluck(f, t, vol) {
      tone({ type: 'triangle', freq: f, t, dur: 1.3, vol, lowpass: 2600, bus: musicBus, rev: 0.45 });
      tone({ type: 'sine', freq: f * 2, t, dur: 0.4, vol: vol * 0.25, bus: musicBus, rev: 0.45 });
    }
    function melody(chord, t, resting) {
      if (resting) return;
      for (let beat = 0; beat < 4; beat++) {
        const bt = t + beat * BEAT;
        if (beat === 0) {
          // Land on a note of the chord at the start of each bar.
          const tones = CHORDS[chord].map(f => f * 2);
          let best = 0, bestD = 1e9;
          SCALE.forEach((f, i) => { const d = Math.min(...tones.map(c => Math.abs(Math.log(f / c)))); if (d < 0.03 && Math.abs(i - idx) < bestD) { bestD = Math.abs(i - idx); best = i; } });
          if (bestD < 1e9) idx = best;
          pluck(SCALE[idx], bt, 0.07);
          continue;
        }
        if (Math.random() < 0.35) continue;      // breathing room
        idx = Math.max(0, Math.min(SCALE.length - 1, idx + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
        pluck(SCALE[idx], bt, 0.055);
        if (Math.random() < 0.2) {                // an occasional passing note
          const j = Math.max(0, Math.min(SCALE.length - 1, idx + (Math.random() < 0.5 ? -1 : 1)));
          pluck(SCALE[j], bt + BEAT / 2, 0.04);
        }
      }
    }
    function schedule() {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (nextBar < now) nextBar = now + 0.2;
      while (nextBar < now + 1.5) {
        if (settings.music > 0 && !settings.mute) {
          const chord = prog[bar];
          const resting = phrase % 4 === 3;       // every fourth phrase is pad only
          pad(chord, nextBar, BEAT * 4 + 0.6);
          melody(chord, nextBar, resting);
        }
        nextBar += BEAT * 4;
        bar++;
        if (bar >= prog.length) { bar = 0; phrase++; prog = PROGS[Math.floor(Math.random() * PROGS.length)]; }
      }
    }
    return {
      start() { if (!timer) timer = setInterval(schedule, 250); schedule(); },
    };
  })();

  window.Sound = {
    play, preview,
    setSettings, getSettings, DEFAULTS,
    clean,
    // Quiet while the game fast-forwards through time away.
    hush(on) { hushed = !!on; },
    get running() { return !!ctx && ctx.state === 'running'; },
    // For testing in the console: the audio graph and play counts.
    _debug() { return { ctx, master, played }; },
  };
})();
