import { useEffect, useRef } from "react";
import type { BattleState } from "../../game/simulation/battle";
import type { LoadedFighter, VoiceClipType } from "../../types/game";
import { PLAYER_SLOTS } from "./constants";
import { clamp } from "./math";

const VOICE_VOLUME: Record<VoiceClipType, number> = {
  attack: 0.82,
  hit: 0.9,
  win: 1,
};

let stageAudioContext: AudioContext | undefined;

export function useStageBattleAudio(state: BattleState | undefined, fighters: { p1: LoadedFighter; p2: LoadedFighter } | undefined) {
  const previousStateRef = useRef<BattleState | undefined>();

  useEffect(() => {
    previousStateRef.current = undefined;
  }, [fighters?.p1.id, fighters?.p2.id]);

  useEffect(() => {
    if (!state || !fighters) {
      return;
    }
    const previous = previousStateRef.current;
    previousStateRef.current = state;
    if (!previous) {
      return;
    }

    PLAYER_SLOTS.forEach((slot) => {
      if (state.fighters[slot].attack && !previous.fighters[slot].attack) {
        playFighterVoice(fighters[slot], "attack");
      }
      if (state.fighters[slot].health <= 0 && previous.fighters[slot].health > 0) {
        playKnockdownImpactSound(state.fighters[slot].x, state.arenaWidth);
      }
    });

    const hit = state.lastHit;
    if (hit && hit.at !== previous.lastHit?.at) {
      playFighterVoice(fighters[hit.defender], "hit");
      playPunchImpactSound(hit.damage, state.fighters[hit.defender].x, state.arenaWidth);
    }

    if (state.lastSuper && state.lastSuper.at !== previous.lastSuper?.at) {
      playSuperSound(state.fighters[state.lastSuper.attacker].x, state.arenaWidth);
    }

    if (state.winner && state.winner !== previous.winner) {
      playFighterVoice(fighters[state.winner], "win");
    }
  }, [fighters, state]);
}

export function unlockStageAudio() {
  void getStageAudioContext()?.resume();
}

function playFighterVoice(fighter: LoadedFighter, clip: VoiceClipType) {
  const url = fighter.voiceUrls[clip];
  if (!url) {
    return;
  }
  const audio = new Audio(url);
  audio.volume = VOICE_VOLUME[clip];
  void audio.play().catch(() => undefined);
}

function playPunchImpactSound(damage: number, x: number, arenaWidth: number) {
  const context = getStageAudioContext();
  if (!context) {
    return;
  }
  const now = context.currentTime;
  const intensity = clamp((damage - 3) / 15, 0, 1);
  const pan = clamp((x / arenaWidth) * 2 - 1, -0.7, 0.7);
  const output = createPannedOutput(context, pan, 0.24 + intensity * 0.22);
  const noise = createNoiseSource(context, 0.1, 0x7f4a7c15 + Math.round(intensity * 997));
  const crack = context.createBiquadFilter();
  crack.type = "bandpass";
  crack.frequency.setValueAtTime(2100 + intensity * 1200, now);
  const crackGain = context.createGain();
  crackGain.gain.setValueAtTime(0.001, now);
  crackGain.gain.exponentialRampToValueAtTime(0.9, now + 0.004);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

  const thump = context.createOscillator();
  const thumpGain = context.createGain();
  thump.type = "triangle";
  thump.frequency.setValueAtTime(240 + intensity * 70, now);
  thump.frequency.exponentialRampToValueAtTime(118, now + 0.07);
  thumpGain.gain.setValueAtTime(0.001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.26, now + 0.006);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

  noise.connect(crack);
  crack.connect(crackGain);
  crackGain.connect(output.input);
  thump.connect(thumpGain);
  thumpGain.connect(output.input);
  noise.start(now);
  noise.stop(now + 0.1);
  thump.start(now);
  thump.stop(now + 0.09);
  cleanupAudioNodes([noise, crack, crackGain, thump, thumpGain, output.input, output.panner], 220);
}

function playKnockdownImpactSound(x: number, arenaWidth: number) {
  const context = getStageAudioContext();
  if (!context) {
    return;
  }
  const now = context.currentTime;
  const output = createPannedOutput(context, clamp((x / arenaWidth) * 2 - 1, -0.72, 0.72), 0.44);
  const thud = context.createOscillator();
  const thudGain = context.createGain();
  thud.type = "sine";
  thud.frequency.setValueAtTime(86, now);
  thud.frequency.exponentialRampToValueAtTime(42, now + 0.22);
  thudGain.gain.setValueAtTime(0.001, now);
  thudGain.gain.exponentialRampToValueAtTime(0.7, now + 0.014);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  thud.connect(thudGain);
  thudGain.connect(output.input);
  thud.start(now);
  thud.stop(now + 0.34);
  cleanupAudioNodes([thud, thudGain, output.input, output.panner], 460);
}

function playSuperSound(x: number, arenaWidth: number) {
  const context = getStageAudioContext();
  if (!context) {
    return;
  }
  const now = context.currentTime;
  const output = createPannedOutput(context, clamp((x / arenaWidth) * 2 - 1, -0.74, 0.74), 0.38);
  const core = context.createOscillator();
  const coreGain = context.createGain();
  core.type = "sawtooth";
  core.frequency.setValueAtTime(1280, now);
  core.frequency.exponentialRampToValueAtTime(360, now + 0.24);
  core.frequency.exponentialRampToValueAtTime(980, now + 0.86);
  coreGain.gain.setValueAtTime(0.001, now);
  coreGain.gain.exponentialRampToValueAtTime(0.35, now + 0.025);
  coreGain.gain.exponentialRampToValueAtTime(0.001, now + 0.86);
  core.connect(coreGain);
  coreGain.connect(output.input);
  core.start(now);
  core.stop(now + 0.9);
  cleanupAudioNodes([core, coreGain, output.input, output.panner], 1040);
}

function getStageAudioContext() {
  const AudioContextCtor = window.AudioContext ?? (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    return undefined;
  }
  stageAudioContext ??= new AudioContextCtor();
  return stageAudioContext;
}

function createPannedOutput(context: AudioContext, pan: number, gainValue: number) {
  const input = context.createGain();
  input.gain.setValueAtTime(gainValue, context.currentTime);
  const panner = "createStereoPanner" in context ? context.createStereoPanner() : undefined;
  if (panner) {
    panner.pan.setValueAtTime(pan, context.currentTime);
    input.connect(panner);
    panner.connect(context.destination);
  } else {
    input.connect(context.destination);
  }
  return { input, panner };
}

function createNoiseSource(context: AudioContext, durationSeconds: number, seedStart: number) {
  const sampleCount = Math.floor(context.sampleRate * durationSeconds);
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = seedStart;
  for (let index = 0; index < sampleCount; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const t = index / context.sampleRate;
    data[index] = ((seed / 0xffffffff) * 2 - 1) * Math.exp(-t * 28);
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  return source;
}

function cleanupAudioNodes(nodes: Array<AudioNode | undefined>, delayMs: number) {
  window.setTimeout(() => {
    nodes.forEach((node) => {
      try {
        node?.disconnect();
      } catch {
        // Some browsers throw if a short-lived node already disconnected itself.
      }
    });
  }, delayMs);
}
