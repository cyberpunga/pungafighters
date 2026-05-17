import type Phaser from "phaser";
import { createStereoPanner, getWebAudioSoundManager, prepareWebAudioContext } from "./webAudio";

interface KnockdownImpactSfxOptions {
  x: number;
  arenaWidth: number;
  strength: number;
}

const IMPACT_DURATION_SECONDS = 0.34;
const PAN_LIMIT = 0.72;

export function playKnockdownImpactSfx(sound: Phaser.Sound.BaseSoundManager, options: KnockdownImpactSfxOptions) {
  const webAudio = getWebAudioSoundManager(sound);
  if (!webAudio || !prepareWebAudioContext(webAudio.context)) {
    return;
  }

  const { context, destination } = webAudio;
  const now = context.currentTime;
  const strength = clamp(options.strength, 0, 1);
  const pan = clamp((options.x / options.arenaWidth) * 2 - 1, -PAN_LIMIT, PAN_LIMIT);

  const mixer = context.createGain();
  const output = context.createGain();
  const panner = createStereoPanner(context, pan);

  mixer.gain.setValueAtTime(lerp(0.2, 0.46, strength), now);
  output.gain.setValueAtTime(0.001, now);
  output.gain.exponentialRampToValueAtTime(1, now + 0.006);
  output.gain.exponentialRampToValueAtTime(0.001, now + IMPACT_DURATION_SECONDS);

  mixer.connect(output);
  if (panner) {
    output.connect(panner);
    panner.connect(destination);
  } else {
    output.connect(destination);
  }

  playBodyThudLayer(context, mixer, now, strength);
  playFloorSlapLayer(context, mixer, now, strength);
  playDustLayer(context, mixer, now, strength);

  window.setTimeout(() => {
    mixer.disconnect();
    output.disconnect();
    panner?.disconnect();
  }, (IMPACT_DURATION_SECONDS + 0.08) * 1000);
}

function playBodyThudLayer(context: AudioContext, destination: AudioNode, startAt: number, strength: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(lerp(74, 94, strength), startAt);
  oscillator.frequency.exponentialRampToValueAtTime(lerp(35, 48, strength), startAt + 0.18);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(lerp(0.34, 0.72, strength), startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + lerp(0.18, 0.29, strength));

  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + IMPACT_DURATION_SECONDS);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

function playFloorSlapLayer(context: AudioContext, destination: AudioNode, startAt: number, strength: number) {
  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const bandpass = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = createImpactNoiseBuffer(context, strength);
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(lerp(130, 220, strength), startAt);
  bandpass.type = "bandpass";
  bandpass.frequency.setValueAtTime(lerp(360, 620, strength), startAt);
  bandpass.Q.setValueAtTime(0.82, startAt);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(lerp(0.28, 0.58, strength), startAt + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + lerp(0.075, 0.12, strength));

  source.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(destination);
  source.start(startAt);
  source.stop(startAt + 0.14);
  source.onended = () => {
    source.disconnect();
    highpass.disconnect();
    bandpass.disconnect();
    gain.disconnect();
  };
}

function playDustLayer(context: AudioContext, destination: AudioNode, startAt: number, strength: number) {
  const source = context.createBufferSource();
  const lowpass = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = createImpactNoiseBuffer(context, strength * 0.6);
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(lerp(840, 1280, strength), startAt);
  lowpass.frequency.exponentialRampToValueAtTime(lerp(260, 420, strength), startAt + 0.23);
  lowpass.Q.setValueAtTime(0.7, startAt);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(lerp(0.08, 0.18, strength), startAt + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + IMPACT_DURATION_SECONDS);

  source.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(destination);
  source.start(startAt);
  source.stop(startAt + IMPACT_DURATION_SECONDS);
  source.onended = () => {
    source.disconnect();
    lowpass.disconnect();
    gain.disconnect();
  };
}

function createImpactNoiseBuffer(context: AudioContext, strength: number) {
  const sampleCount = Math.floor(context.sampleRate * IMPACT_DURATION_SECONDS);
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x35f28c11 + Math.round(strength * 4099);

  for (let index = 0; index < sampleCount; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    const t = index / context.sampleRate;
    const envelope = Math.exp(-t * lerp(14, 24, strength));
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
