/**
 * Pakshee — Tone.js Audio Sonification Engine
 * Maps atmospheric particulate density (PM2.5) to dissonance, timbre, and harmonic tension.
 */

window.pakshee = window.pakshee || {};

(function () {
  'use strict';

  let isInitialized = false;
  let isMuted = false;

  // Master Audio Bus & Effects
  let masterGain = null;
  let masterFilter = null;
  let masterDistortion = null;
  let masterReverb = null;

  // Instruments
  let harmonicSynth = null;
  let resonantFmSynth = null;
  let particulateNoise = null;

  /**
   * Soundscape stems placeholder (For user-composed vocal & acoustic samples)
   */
  const CUSTOM_STEMS = {
    clean_drone: null,
    haze_drone: null,
    toxic_drone: null
  };

  /**
   * Initialize Tone.js audio graph after user interaction
   */
  async function initAudio() {
    if (isInitialized) return true;

    if (typeof Tone === 'undefined') {
      console.warn('[Pakshee Audio] Tone.js not loaded. Audio will be disabled.');
      return false;
    }

    try {
      await Tone.start();
      console.log('[Pakshee Audio] AudioContext state:', Tone.context.state);

      // 1. Master Output Chain (Use standard, universally supported nodes)
      masterGain = new Tone.Gain(0.85).toDestination();

      masterFilter = new Tone.Filter({
        frequency: 8000,
        type: 'lowpass',
        rolloff: -12
      }).connect(masterGain);

      masterDistortion = new Tone.Distortion({
        distortion: 0.0,
        wet: 0.0
      }).connect(masterFilter);

      // Freeverb is synchronous, lightweight, and works across all browsers
      masterReverb = new Tone.Freeverb({
        roomSize: 0.6,
        dampening: 3000,
        wet: 0.25
      }).connect(masterDistortion);

      // 2. Harmonic PolySynth (Base chordal voice)
      harmonicSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: {
          attack: 0.2,
          decay: 0.7,
          sustain: 0.4,
          release: 1.6
        }
      }).connect(masterReverb);

      // 3. Resonant FM Synth (Airy high frequencies)
      resonantFmSynth = new Tone.FMSynth({
        harmonicity: 2.0,
        modulationIndex: 1.5,
        oscillator: { type: 'triangle' },
        modulation: { type: 'sine' },
        envelope: {
          attack: 0.15,
          decay: 0.5,
          sustain: 0.2,
          release: 1.2
        }
      }).connect(masterReverb);

      // 4. Particulate Noise Synth (Atmospheric grain)
      particulateNoise = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: {
          attack: 0.2,
          decay: 0.4,
          sustain: 0.1,
          release: 0.6
        }
      }).connect(masterFilter);

      isInitialized = true;
      console.log('[Pakshee Audio] Audio engine initialized successfully.');
      return true;
    } catch (err) {
      console.error('[Pakshee Audio] Initialization failed:', err);
      return false;
    }
  }

  /**
   * Translate PM2.5 concentration into harmonic chords, detuning, and timbre
   */
  function mapPm25ToAcousticParams(pm25) {
    if (pm25 === null || pm25 === undefined) {
      return {
        notes: ['A3', 'E4'],
        fmNote: 'A5',
        filterCutoff: 1200,
        distortion: 0.0,
        noiseVolume: -60,
        textureDesc: 'Unmonitored / Silent: Muted baseline interval.'
      };
    }

    if (pm25 <= 30) {
      // Good (0-30): Pristine consonant D Major 9 chord, open filter, bright birdsong FM
      return {
        notes: ['D4', 'F#4', 'A4', 'E5'],
        fmNote: 'F#6',
        filterCutoff: 9000,
        distortion: 0.0,
        noiseVolume: -50,
        textureDesc: 'Consonant D Major 9 with airy resonant harmonics. Pure atmosphere.'
      };
    } else if (pm25 <= 60) {
      // Satisfactory (31-60): Warm major with slight flat 7th, subtle warmth
      return {
        notes: ['D4', 'F#4', 'A4', 'C5'],
        fmNote: 'D6',
        filterCutoff: 6500,
        distortion: 0.05,
        noiseVolume: -38,
        textureDesc: 'Mild acoustic warmth with slight harmonic flattening.'
      };
    } else if (pm25 <= 90) {
      // Moderate (61-90): Minor suspended chords
      return {
        notes: ['D4', 'G4', 'A4', 'C5'],
        fmNote: 'A5',
        filterCutoff: 3800,
        distortion: 0.18,
        noiseVolume: -26,
        textureDesc: 'Suspended tension. Filter ceiling lowered to 3800Hz with light saturation.'
      };
    } else if (pm25 <= 120) {
      // Poor (91-120): Tritone dissonance, filter choke, noticeable grain
      return {
        notes: ['D4', 'G#4', 'C5', 'F5'],
        fmNote: 'G#5',
        filterCutoff: 2200,
        distortion: 0.4,
        noiseVolume: -18,
        textureDesc: 'Tritone dissonance (diminished 5th). Saturated filter drive.'
      };
    } else if (pm25 <= 250) {
      // Very Poor (121-250): Minor 2nd clusters, abrasive distortion, suffocating lowpass
      return {
        notes: ['D4', 'Eb4', 'Ab4', 'A4'],
        fmNote: 'Eb5',
        filterCutoff: 1400,
        distortion: 0.65,
        noiseVolume: -10,
        textureDesc: 'Abrasive semitone clusters. Dense particulate noise with 65% distortion.'
      };
    } else {
      // Severe (250+): Full degradation, crushed bits, screeching sub-choke
      return {
        notes: ['C#4', 'D4', 'D#4', 'G#4'],
        fmNote: 'D4',
        filterCutoff: 900,
        distortion: 0.85,
        noiseVolume: -5,
        textureDesc: 'Suffocating sub-1000Hz choke and harsh noise wash.'
      };
    }
  }

  /**
   * Play the atmospheric sonic signature of an air quality station
   */
  async function playStation(stationProps) {
    if (!isInitialized) {
      const ok = await initAudio();
      if (!ok) return mapPm25ToAcousticParams(stationProps.pm25);
    }
    if (isMuted || !harmonicSynth) return mapPm25ToAcousticParams(stationProps.pm25);

    const pm25 = stationProps.pm25;
    const params = mapPm25ToAcousticParams(pm25);

    try {
      const now = Tone.now();
      if (masterFilter && masterFilter.frequency) {
        masterFilter.frequency.rampTo(params.filterCutoff, 0.15, now);
      }
      if (masterDistortion) {
        masterDistortion.distortion = params.distortion;
        masterDistortion.wet.rampTo(params.distortion > 0 ? 0.7 : 0, 0.15, now);
      }

      // Trigger chord
      harmonicSynth.triggerAttackRelease(params.notes, '2.0s', now);

      // Trigger FM high accent
      if (params.fmNote && resonantFmSynth) {
        resonantFmSynth.triggerAttackRelease(params.fmNote, '1.4s', now + 0.1, 0.3);
      }

      // Trigger noise wash for higher pollution
      if (params.noiseVolume > -40 && particulateNoise) {
        particulateNoise.volume.rampTo(params.noiseVolume, 0.1, now);
        particulateNoise.triggerAttackRelease('1.2s', now + 0.1);
      }
    } catch (e) {
      console.warn('[Pakshee Audio] Play error:', e);
    }

    return params;
  }

  /**
   * Play silent zone indicator (a haunting muted tap with lingering low sine)
   */
  async function playSilentZone(districtName) {
    if (!isInitialized) await initAudio();
    if (isMuted || !harmonicSynth) return;

    try {
      const now = Tone.now();
      if (masterFilter && masterFilter.frequency) {
        masterFilter.frequency.rampTo(500, 0.2, now);
      }
      harmonicSynth.triggerAttackRelease(['A2', 'E3'], '2.5s', now, 0.25);
    } catch (e) {
      console.warn('[Pakshee Audio] Silent zone play error:', e);
    }
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (masterGain && masterGain.gain) {
      masterGain.gain.rampTo(isMuted ? 0 : 0.85, 0.15);
    }
    return !isMuted;
  }

  function isAudioActive() {
    return isInitialized && !isMuted;
  }

  // Export public API
  window.pakshee.audio = {
    init: initAudio,
    playStation: playStation,
    playSilentZone: playSilentZone,
    toggleMute: toggleMute,
    isAudioActive: isAudioActive,
    mapPm25ToParams: mapPm25ToAcousticParams
  };

})();
