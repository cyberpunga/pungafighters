import type Phaser from "phaser";

export interface WebAudioSoundManagerLike {
  context: AudioContext;
  destination: AudioNode;
}

export function getWebAudioSoundManager(sound: Phaser.Sound.BaseSoundManager): WebAudioSoundManagerLike | undefined {
  const candidate = sound as unknown as Partial<Phaser.Sound.WebAudioSoundManager>;
  if (candidate.context && candidate.destination && typeof candidate.context.createBuffer === "function") {
    return {
      context: candidate.context,
      destination: candidate.destination,
    };
  }
  return undefined;
}

export function prepareWebAudioContext(context: AudioContext) {
  if (context.state === "closed") {
    return false;
  }
  if (context.state === "suspended") {
    void context.resume().catch(() => undefined);
  }
  return true;
}

export function createStereoPanner(context: AudioContext, pan: number) {
  if (typeof context.createStereoPanner !== "function") {
    return undefined;
  }
  const panner = context.createStereoPanner();
  panner.pan.value = pan;
  return panner;
}
