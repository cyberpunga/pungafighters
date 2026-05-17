import type Phaser from "phaser";
import { createStereoPanner, getWebAudioSoundManager, prepareWebAudioContext } from "./webAudio";

interface SuperSfxOptions {
  x: number;
  arenaWidth: number;
}

const SUPER_DURATION_SECONDS = 0.92;
const PAN_LIMIT = 0.74;

export function playSuperSfx(sound: Phaser.Sound.BaseSoundManager, options: SuperSfxOptions) {
  const webAudio = getWebAudioSoundManager(sound);
  if (!webAudio || !prepareWebAudioContext(webAudio.context)) {
    return;
  }

  const { context, destination } = webAudio;
  const now = context.currentTime;
  const pan = clamp((options.x / options.arenaWidth) * 2 - 1, -PAN_LIMIT, PAN_LIMIT);

  const mixer = context.createGain();
  const output = context.createGain();
  const panner = createStereoPanner(context, pan);

  mixer.gain.setValueAtTime(0.42, now);
  output.gain.setValueAtTime(0.001, now);
  output.gain.exponentialRampToValueAtTime(0.96, now + 0.035);
  output.gain.setValueAtTime(0.82, now + 0.46);
  output.gain.exponentialRampToValueAtTime(0.001, now + SUPER_DURATION_SECONDS);

  mixer.connect(output);
  if (panner) {
    output.connect(panner);
    panner.connect(destination);
  } else {
    output.connect(destination);
  }

  playLaserCore(context, mixer, now);
  playRiserLayer(context, mixer, now);
  playSparkLayer(context, mixer, now);
  playSubPulse(context, mixer, now + 0.12);

  window.setTimeout(() => {
    mixer.disconnect();
    output.disconnect();
    panner?.disconnect();
  }, (SUPER_DURATION_SECONDS + 0.08) * 1000);
}

function playLaserCore(context: AudioContext, destination: AudioNode, startAt: number) {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(1280, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(360, startAt + 0.24);
  oscillator.frequency.exponentialRampToValueAtTime(980, startAt + SUPER_DURATION_SECONDS);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1760, startAt);
  filter.frequency.exponentialRampToValueAtTime(820, startAt + 0.22);
  filter.frequency.exponentialRampToValueAtTime(2450, startAt + SUPER_DURATION_SECONDS);
  filter.Q.setValueAtTime(5.2, startAt);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.38, startAt + 0.018);
  gain.gain.setValueAtTime(0.28, startAt + 0.42);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + SUPER_DURATION_SECONDS);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + SUPER_DURATION_SECONDS);
  oscillator.onended = () => {
    oscillator.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

function playRiserLayer(context: AudioContext, destination: AudioNode, startAt: number) {
  const oscillator = context.createOscillator();
  const delay = context.createDelay();
  const feedback = context.createGain();
  const gain = context.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(220, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(1480, startAt + 0.58);
  oscillator.frequency.exponentialRampToValueAtTime(980, startAt + SUPER_DURATION_SECONDS);
  delay.delayTime.setValueAtTime(0.035, startAt);
  feedback.gain.setValueAtTime(0.32, startAt);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.09);
  gain.gain.setValueAtTime(0.26, startAt + 0.52);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + SUPER_DURATION_SECONDS);

  oscillator.connect(gain);
  gain.connect(destination);
  gain.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + SUPER_DURATION_SECONDS);
  oscillator.onended = () => {
    oscillator.disconnect();
    delay.disconnect();
    feedback.disconnect();
    gain.disconnect();
  };
}

function playSparkLayer(context: AudioContext, destination: AudioNode, startAt: number) {
  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = createSparkNoiseBuffer(context);
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(1700, startAt);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(5200, startAt);
  filter.frequency.exponentialRampToValueAtTime(2900, startAt + 0.5);
  filter.Q.setValueAtTime(1.8, startAt);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.3, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.62);

  source.connect(highpass);
  highpass.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(startAt);
  source.stop(startAt + 0.66);
  source.onended = () => {
    source.disconnect();
    highpass.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

function playSubPulse(context: AudioContext, destination: AudioNode, startAt: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(84, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(46, startAt + 0.22);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.26, startAt + 0.016);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.28);

  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.3);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

function createSparkNoiseBuffer(context: AudioContext) {
  const sampleCount = Math.floor(context.sampleRate * 0.66);
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x58f7c3a9;

  for (let index = 0; index < sampleCount; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    const t = index / context.sampleRate;
    const rise = Math.min(1, t / 0.08);
    const envelope = rise * Math.exp(-t * 3.8);
    data[index] = noise * envelope;
  }

  return buffer;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
