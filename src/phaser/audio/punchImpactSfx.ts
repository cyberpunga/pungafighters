import type Phaser from "phaser";
import { createStereoPanner, getWebAudioSoundManager, prepareWebAudioContext } from "./webAudio";

interface PunchImpactSfxOptions {
  damage: number;
  x: number;
  arenaWidth: number;
}

const IMPACT_DURATION_SECONDS = 0.12;
const MIN_GAIN = 0.24;
const MAX_GAIN = 0.44;
const PAN_LIMIT = 0.68;

export function playPunchImpactSfx(sound: Phaser.Sound.BaseSoundManager, options: PunchImpactSfxOptions) {
  const webAudio = getWebAudioSoundManager(sound);
  if (!webAudio || !prepareWebAudioContext(webAudio.context)) {
    return;
  }

  const { context, destination } = webAudio;
  const now = context.currentTime;
  const intensity = clamp((options.damage - 3) / 15, 0, 1);
  const pan = clamp((options.x / options.arenaWidth) * 2 - 1, -PAN_LIMIT, PAN_LIMIT);
  const gain = lerp(MIN_GAIN, MAX_GAIN, intensity);

  const mixer = context.createGain();
  const output = context.createGain();
  const panner = createStereoPanner(context, pan);

  mixer.gain.setValueAtTime(gain, now);
  output.gain.setValueAtTime(1, now);
  output.gain.exponentialRampToValueAtTime(0.001, now + IMPACT_DURATION_SECONDS);

  mixer.connect(output);
  if (panner) {
    output.connect(panner);
    panner.connect(destination);
  } else {
    output.connect(destination);
  }

  playCrackLayer(context, mixer, now, intensity);
  playNoiseLayer(context, mixer, now, intensity);
  playThumpLayer(context, mixer, now, intensity);

  window.setTimeout(() => {
    mixer.disconnect();
    output.disconnect();
    panner?.disconnect();
  }, (IMPACT_DURATION_SECONDS + 0.08) * 1000);
}

function playNoiseLayer(context: AudioContext, destination: AudioNode, startAt: number, intensity: number) {
  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const bandpass = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = createImpactNoiseBuffer(context, intensity);
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(520 + intensity * 260, startAt);
  bandpass.type = "bandpass";
  bandpass.frequency.setValueAtTime(1450 + intensity * 580, startAt);
  bandpass.Q.setValueAtTime(0.9, startAt);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.82, startAt + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.082 + intensity * 0.018);

  source.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(destination);
  source.start(startAt);
  source.stop(startAt + IMPACT_DURATION_SECONDS);
  source.onended = () => {
    source.disconnect();
    highpass.disconnect();
    bandpass.disconnect();
    gain.disconnect();
  };
}

function playCrackLayer(context: AudioContext, destination: AudioNode, startAt: number, intensity: number) {
  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const bandpass = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = createImpactNoiseBuffer(context, 1);
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(1250 + intensity * 420, startAt);
  bandpass.type = "bandpass";
  bandpass.frequency.setValueAtTime(2850 + intensity * 850, startAt);
  bandpass.Q.setValueAtTime(1.35, startAt);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(1.08, startAt + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.038 + intensity * 0.01);

  source.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(destination);
  source.start(startAt);
  source.stop(startAt + 0.06);
  source.onended = () => {
    source.disconnect();
    highpass.disconnect();
    bandpass.disconnect();
    gain.disconnect();
  };
}

function playThumpLayer(context: AudioContext, destination: AudioNode, startAt: number, intensity: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(255 + intensity * 70, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(118 + intensity * 24, startAt + 0.062);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.34, startAt + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.068);

  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.078);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

function createImpactNoiseBuffer(context: AudioContext, intensity: number) {
  const sampleCount = Math.floor(context.sampleRate * IMPACT_DURATION_SECONDS);
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x7f4a7c15 + Math.round(intensity * 997);

  for (let index = 0; index < sampleCount; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    const t = index / context.sampleRate;
    const envelope = Math.exp(-t * (34 - intensity * 7));
    data[index] = noise * envelope;
  }

  return buffer;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}
