import Phaser from "phaser";
import {
  VOICE_CLIPS,
  type BattleConfig,
  type BattlePostEffect,
  type FighterPose,
  type LoadedFighter,
  type PlayerInputSnapshot,
  type PlayerSlot,
  type RuntimeBattleBackground,
  type VoiceClipType,
} from "../../types/game";
import { createEmptyActions, KEYBOARD_BINDINGS } from "../../game/input/actions";
import { createCpuActions } from "../../game/input/cpu";
import {
  BATTLE_TICK_SECONDS,
  createBattleState,
  getBattleChecksum,
  restartMatch,
  stepBattleFrame,
  SUPER_HITS_REQUIRED,
  type BattleState,
} from "../../game/simulation/battle";
import { NETPLAY_CHECKSUM_INTERVAL } from "../../game/network/protocol";
import type { NetworkInputController } from "../../game/network/networkInputController";
import { BAD_TV_POST_FX_PIPELINE_KEY, getBadTvPostFxConfig } from "../effects/BadTvPostFxPipeline";
import { CRT_POST_FX_PIPELINE_KEY, getCrtPostFxConfig } from "../effects/CrtPostFxPipeline";
import { PIXEL_POST_FX_PIPELINE_KEY, getPixelPostFxConfig } from "../effects/PixelPostFxPipeline";
import { STATIC_POST_FX_PIPELINE_KEY, getStaticPostFxConfig } from "../effects/StaticPostFxPipeline";
import { playPunchImpactSfx } from "../audio/punchImpactSfx";
import { playSuperSfx } from "../audio/superSfx";
import {
  createFighterRenderState,
  updateFighterRenderState,
  type FighterRenderState,
  type FighterRenderTransform,
} from "../render/fighterAnimation";

interface FighterView {
  sprite: Phaser.GameObjects.Image;
  previousSprite: Phaser.GameObjects.Image;
  renderState: FighterRenderState;
  name: Phaser.GameObjects.Text;
  portrait: Phaser.GameObjects.Image;
  setName: (value: string) => void;
  rounds: Phaser.GameObjects.Text;
  updateHealthMeter: (ratio: number) => void;
  updateSuperMeter: (ratio: number) => void;
}

export interface BattleSceneOptions {
  mode?: "local" | "online";
  localSlot?: PlayerSlot;
  networkController?: NetworkInputController;
  background?: RuntimeBattleBackground;
  displayEffects?: BattlePostEffect[];
}

const FIGHTER_DISPLAY_SIZE = 190;
const CUSTOM_STAGE_TEXTURE = "custom-stage-background";
const ARENA_WIDTH = 960;
const ARENA_HEIGHT = 540;
const ARENA_CENTER_X = ARENA_WIDTH / 2;
const ARENA_CENTER_Y = ARENA_HEIGHT / 2;
const CUSTOM_STAGE_OVERSCAN = 1.08;
const CUSTOM_STAGE_HORIZONTAL_DRIFT = 0.12;
const CUSTOM_STAGE_VERTICAL_DRIFT = 0.04;
const CUSTOM_STAGE_PAN_EASE = 4.5;
const FIGHTER_BASE_DEPTH = 2;
const FIGHTER_DEFAULT_DEPTH_STEP = 0.01;
const FIGHTER_FOREGROUND_DEPTH = 3;
const FIGHTER_PREVIOUS_DEPTH_OFFSET = 0.1;
const FIGHTER_HIT_FOREGROUND_FRAMES = Math.ceil(0.24 / BATTLE_TICK_SECONDS);
const SUPER_FLASH_DEPTH = 30;
const SUPER_BACKDROP_COLOR = 0x8f3dff;
const SUPER_BACKDROP_SIZE = FIGHTER_DISPLAY_SIZE * 4;
const HUD_PANEL_WIDTH = 320;
const HUD_PANEL_HEIGHT = 96;
const HUD_PORTRAIT_SIZE = 88;
const HUD_HEALTH_LENGTH = 206;
const HUD_HEALTH_HEIGHT = 24;
const HUD_HEALTH_TIP = 26;
const HUD_HEALTH_ANCHOR = 118;
const HUD_HEALTH_TOP = 32;
const HUD_SUPER_LENGTH = 188;
const HUD_SUPER_HEIGHT = 16;
const HUD_SUPER_TIP = 18;
const HUD_SUPER_TOP = 66;
const HUD_SUPER_ANCHOR = HUD_HEALTH_ANCHOR;
const HUD_NAME_MAX_WIDTH = 180;
const HUD_NAME_MIN_SCALE = 0.68;
const VOICE_VOLUME: Record<VoiceClipType, number> = {
  attack: 0.82,
  hit: 0.76,
  win: 0.9,
};

export class BattleScene extends Phaser.Scene {
  private state: BattleState;
  private readonly configData: BattleConfig;
  private readonly fighters: { p1: LoadedFighter; p2: LoadedFighter };
  private readonly onExit: () => void;
  private readonly mode: "local" | "online";
  private readonly localSlot: PlayerSlot;
  private readonly networkController?: NetworkInputController;
  private readonly background?: RuntimeBattleBackground;
  private displayEffects: BattlePostEffect[];
  private hasCreated = false;
  private views?: Record<PlayerSlot, FighterView>;
  private timerText?: Phaser.GameObjects.Text;
  private messageText?: Phaser.GameObjects.Text;
  private restartHint?: Phaser.GameObjects.Text;
  private stageImage?: Phaser.GameObjects.Image;
  private pressedCodes = new Set<string>();
  private lastHitAt = -1;
  private lastSuperAt = -1;
  private accumulator = 0;
  private onlineStatus?: string;
  private haltedMessage?: string;
  private readonly checksumHistory = new Map<number, string>();
  private readonly pendingRemoteChecksums = new Map<number, string>();
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    this.captureKey(event);
    this.pressedCodes.add(event.code);
  };
  private readonly handleKeyUp = (event: KeyboardEvent) => {
    this.captureKey(event);
    this.pressedCodes.delete(event.code);
  };

  constructor(config: BattleConfig, fighters: { p1: LoadedFighter; p2: LoadedFighter }, onExit: () => void, options: BattleSceneOptions = {}) {
    super("BattleScene");
    this.configData = config;
    this.fighters = fighters;
    this.onExit = onExit;
    this.mode = options.mode ?? "local";
    this.localSlot = options.localSlot ?? "p1";
    this.networkController = options.networkController;
    this.background = options.background;
    this.displayEffects = options.displayEffects ?? [];
    this.state = createBattleState(config, {
      p1: { id: fighters.p1.id, name: fighters.p1.name },
      p2: { id: fighters.p2.id, name: fighters.p2.name },
    });
  }

  preload() {
    if (this.background?.imageUrl) {
      this.load.image(CUSTOM_STAGE_TEXTURE, this.background.imageUrl);
    }
    this.loadFighterTextures("p1", this.fighters.p1);
    this.loadFighterTextures("p2", this.fighters.p2);
    this.loadFighterVoices("p1", this.fighters.p1);
    this.loadFighterVoices("p2", this.fighters.p2);
  }

  create() {
    this.createArena();
    this.createInputs();
    this.views = {
      p1: this.createFighterView("p1", 72, 32),
      p2: this.createFighterView("p2", 888, 32),
    };
    this.timerText = this.add
      .text(480, 22, "60", {
        fontFamily: "Impact, Arial Black, sans-serif",
        fontSize: "48px",
        color: "#fff4d6",
        stroke: "#150722",
        strokeThickness: 10,
      })
      .setOrigin(0.5, 0);
    this.timerText.setShadow(0, 6, "#06040d", 16, true, true);
    this.messageText = this.add
      .text(480, 212, "Ready", {
        fontFamily: "Impact, Arial Black, sans-serif",
        fontSize: "54px",
        color: "#ffe9f5",
        stroke: "#151433",
        strokeThickness: 10,
        align: "center",
      })
      .setOrigin(0.5);
    this.messageText.setShadow(0, 8, "#040309", 18, true, true);
    this.restartHint = this.add
      .text(480, 478, "Enter: restart  |  Esc: menu", {
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
        color: "#e4dcff",
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.restartHint.setShadow(0, 3, "#05040b", 8, true, true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hasCreated = false;
    });
    this.hasCreated = true;
    this.applyDisplayEffects();
  }

  setDisplayEffects(effects: BattlePostEffect[]) {
    this.displayEffects = effects;
    if (this.hasCreated) {
      this.applyDisplayEffects();
    }
  }

  private applyDisplayEffect(effect: BattlePostEffect) {
    const pixelConfig = getPixelPostFxConfig(effect);
    if (pixelConfig) {
      this.cameras.main.setPostPipeline(PIXEL_POST_FX_PIPELINE_KEY, pixelConfig, false);
      return;
    }
    const badTvConfig = getBadTvPostFxConfig(effect);
    if (badTvConfig) {
      this.cameras.main.setPostPipeline(BAD_TV_POST_FX_PIPELINE_KEY, badTvConfig, false);
      return;
    }
    const crtConfig = getCrtPostFxConfig(effect);
    if (crtConfig) {
      this.cameras.main.setPostPipeline(CRT_POST_FX_PIPELINE_KEY, crtConfig, false);
      return;
    }
    const staticConfig = getStaticPostFxConfig(effect);
    if (staticConfig) {
      this.cameras.main.setPostPipeline(STATIC_POST_FX_PIPELINE_KEY, staticConfig, false);
    }
  }

  private applyDisplayEffects() {
    const game = this.game as Phaser.Game | undefined;
    if (!game || game.renderer.type !== Phaser.WEBGL) {
      return;
    }
    this.cameras.main.resetPostPipeline(true);
    this.displayEffects.forEach((effect) => this.applyDisplayEffect(effect));
  }

  update(_time: number, delta: number) {
    this.processNetworkEvents();
    if (this.pressedCodes.has("Enter") && this.state.status === "matchOver") {
      this.state = restartMatch(this.state);
      this.resetSyncState();
      this.networkController?.requestRestart(this.state.frame);
    }
    if (this.pressedCodes.has("Escape")) {
      this.networkController?.sendExit("Opponent returned to menu.");
      this.onExit();
      return;
    }

    if (!this.haltedMessage) {
      this.stepFixedFrames(delta / 1000);
    }
    this.renderState();
  }

  private loadFighterTextures(slot: PlayerSlot, fighter: LoadedFighter) {
    Object.entries(fighter.frameUrls).forEach(([pose, url]) => {
      if (url) {
        this.load.image(`${slot}-${pose}`, url);
      }
    });
  }

  private loadFighterVoices(slot: PlayerSlot, fighter: LoadedFighter) {
    VOICE_CLIPS.forEach((clip) => {
      const url = fighter.voiceUrls[clip];
      if (url) {
        this.load.audio(this.getVoiceKey(slot, clip), url);
      }
    });
  }

  private createArena() {
    const hasCustomStage = this.background?.imageUrl && this.textures.exists(CUSTOM_STAGE_TEXTURE);
    const bg = this.add.graphics().setDepth(-2);

    if (hasCustomStage) {
      this.stageImage = this.add.image(ARENA_CENTER_X, ARENA_CENTER_Y, CUSTOM_STAGE_TEXTURE).setOrigin(0.5).setDepth(-4);
      const coverScale =
        Math.max(ARENA_WIDTH / Math.max(this.stageImage.width, 1), ARENA_HEIGHT / Math.max(this.stageImage.height, 1)) *
        CUSTOM_STAGE_OVERSCAN;
      this.stageImage.setScale(coverScale);
      bg.fillStyle(0x08070d, 0.28);
      bg.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
      bg.fillStyle(0x08070d, 0.4);
      bg.fillRect(0, 428, ARENA_WIDTH, 112);
    } else {
      this.stageImage = undefined;
      bg.fillGradientStyle(0x25223a, 0x25223a, 0x101018, 0x101018, 1);
      bg.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    }

    bg.fillStyle(0x2ec4b6, hasCustomStage ? 0.18 : 0.14);
    bg.fillRect(0, 428, ARENA_WIDTH, 112);
    bg.lineStyle(3, 0xf8f4df, 0.4);
    bg.lineBetween(0, 430, ARENA_WIDTH, 430);

    for (let x = 80; x < ARENA_WIDTH; x += 140) {
      bg.lineStyle(2, 0xf45b69, hasCustomStage ? 0.24 : 0.18);
      bg.lineBetween(x, 430, x + 80, ARENA_HEIGHT);
    }
  }

  private createInputs() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyInputs());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroyInputs());
  }

  private destroyInputs() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.pressedCodes.clear();
    this.networkController?.destroy();
  }

  private captureKey(event: KeyboardEvent) {
    const isGameControl =
      event.code === "Enter" ||
      event.code === "Escape" ||
      Object.values(KEYBOARD_BINDINGS).some((bindings) => event.code in bindings);
    if (isGameControl) {
      event.preventDefault();
    }
  }

  private createFighterView(slot: PlayerSlot, hudX: number, hudY: number): FighterView {
    const runtime = this.state.fighters[slot];
    const isP1 = slot === "p1";
    const defaultDepth = this.getDefaultFighterDepth(slot);
    const previousSprite = this.add
      .image(runtime.x, runtime.y, `${slot}-idle`)
      .setOrigin(0.5, 0.9)
      .setDisplaySize(FIGHTER_DISPLAY_SIZE, FIGHTER_DISPLAY_SIZE)
      .setAlpha(0)
      .setDepth(defaultDepth - FIGHTER_PREVIOUS_DEPTH_OFFSET);
    const sprite = this.add
      .image(runtime.x, runtime.y, `${slot}-idle`)
      .setOrigin(0.5, 0.9)
      .setDisplaySize(FIGHTER_DISPLAY_SIZE, FIGHTER_DISPLAY_SIZE)
      .setDepth(defaultDepth);
    if (!isP1) {
      previousSprite.setFlipX(true);
      sprite.setFlipX(true);
    }

    const orient = (value: number) => (isP1 ? value : HUD_PANEL_WIDTH - value);
    const orientPoints = (points: { x: number; y: number }[]) => {
      const oriented = points.map(({ x, y }) => ({ x: orient(x), y }));
      return isP1 ? oriented : oriented.reverse();
    };

    const panelX = isP1 ? hudX : hudX - HUD_PANEL_WIDTH;
    const container = this.add.container(panelX, hudY).setDepth(6);
    container.setScrollFactor(0);

    const frameColor = 0xf8f4df;
    const baseDark = isP1 ? 0x09122b : 0x240a10;
    const baseDarkAlt = isP1 ? 0x15255a : 0x3f1425;
    const accentPrimary = isP1 ? 0x4ca7ff : 0xff5c72;
    const accentSecondary = isP1 ? 0x7ff6ff : 0xffcb71;

    const wingBackground = this.add.graphics();
    wingBackground.fillGradientStyle(baseDark, baseDarkAlt, baseDark, baseDarkAlt, 0.92);
    wingBackground.lineStyle(2, frameColor, 0.58);
    const wingShape = orientPoints([
      { x: 8, y: 6 },
      { x: HUD_PANEL_WIDTH - 88, y: 0 },
      { x: HUD_PANEL_WIDTH - 14, y: 30 },
      { x: HUD_PANEL_WIDTH - 96, y: 88 },
      { x: 12, y: HUD_PANEL_HEIGHT },
    ]);
    wingBackground.fillPoints(wingShape, true);
    wingBackground.strokePoints(wingShape, true);
    container.add(wingBackground);

    const wingAccent = this.add.graphics();
    wingAccent.fillGradientStyle(accentPrimary, accentSecondary, accentPrimary, accentSecondary, 0.74);
    wingAccent.fillPoints(
      orientPoints([
        { x: HUD_PANEL_WIDTH - 142, y: 12 },
        { x: HUD_PANEL_WIDTH - 22, y: 56 },
        { x: HUD_PANEL_WIDTH - 168, y: 90 },
        { x: HUD_PANEL_WIDTH - 214, y: 90 },
      ]),
      true,
    );
    container.add(wingAccent);

    const techLines = this.add.graphics();
    techLines.lineStyle(1, accentSecondary, 0.36);
    techLines.strokePoints(
      orientPoints([
        { x: HUD_HEALTH_ANCHOR - 12, y: 22 },
        { x: HUD_PANEL_WIDTH - 20, y: 22 },
      ]),
      false,
    );
    techLines.strokePoints(
      orientPoints([
        { x: HUD_HEALTH_ANCHOR - 10, y: HUD_PANEL_HEIGHT - 6 },
        { x: HUD_PANEL_WIDTH - 104, y: HUD_PANEL_HEIGHT - 6 },
      ]),
      false,
    );
    container.add(techLines);

    const portraitCenterX = orient(HUD_HEALTH_ANCHOR - 60);
    const portraitCenterY = HUD_PANEL_HEIGHT - 6;
    const portraitPlate = this.add.graphics();
    portraitPlate.fillStyle(0x050810, 0.82);
    portraitPlate.fillCircle(portraitCenterX, portraitCenterY, HUD_PORTRAIT_SIZE * 0.5);
    container.add(portraitPlate);

    const portrait = this.add
      .image(portraitCenterX, portraitCenterY - 6, this.getPortraitTexture(slot))
      .setOrigin(0.5)
      .setDisplaySize(HUD_PORTRAIT_SIZE, HUD_PORTRAIT_SIZE)
      .setFlipX(!isP1);
    container.add(portrait);

    const portraitRing = this.add.graphics();
    portraitRing.lineStyle(3, frameColor, 0.72);
    portraitRing.strokeCircle(portraitCenterX, portraitCenterY, HUD_PORTRAIT_SIZE * 0.5);
    portraitRing.lineStyle(2, accentSecondary, 0.54);
    portraitRing.strokeCircle(portraitCenterX, portraitCenterY, HUD_PORTRAIT_SIZE * 0.42);
    container.add(portraitRing);
    container.bringToTop(portrait);

    const name = this.add
      .text(orient(HUD_HEALTH_ANCHOR), 6, runtime.name, {
        fontFamily: "Impact, Arial Black, sans-serif",
        fontSize: "22px",
        color: "#fef6e4",
        stroke: "#120714",
        strokeThickness: 6,
      })
      .setOrigin(isP1 ? 0 : 1, 0);
    name.setShadow(0, 4, "#07030c", 12, true, true);
    container.add(name);

    const applyNameText = (value: string) => {
      const textValue = value || "?";
      name.setScale(1);
      name.setText(textValue);
      if (name.displayWidth <= HUD_NAME_MAX_WIDTH) {
        return;
      }
      const scale = Phaser.Math.Clamp(HUD_NAME_MAX_WIDTH / name.displayWidth, HUD_NAME_MIN_SCALE, 1);
      name.setScale(scale);
      if (scale > HUD_NAME_MIN_SCALE + 0.001) {
        return;
      }
      let truncated = textValue;
      const allowedWidth = HUD_NAME_MAX_WIDTH / scale;
      while (truncated.length > 1) {
        truncated = truncated.slice(0, -1);
        name.setText(`${truncated}...`);
        if (name.width <= allowedWidth) {
          break;
        }
      }
      if (name.width > allowedWidth) {
        name.setText("...");
      }
    };
    applyNameText(runtime.name);

    const rounds = this.add
      .text(orient(HUD_HEALTH_ANCHOR), HUD_PANEL_HEIGHT - 8, "Rounds: 0", {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: "16px",
        color: "#dcd0ff",
        stroke: "#1a0a1f",
        strokeThickness: 4,
      })
      .setOrigin(isP1 ? 0 : 1, 1);
    rounds.setShadow(0, 3, "#040207", 8, true, true);
    container.add(rounds);

    const healthTrack = this.add.graphics();
    const healthTrackShape = orientPoints([
      { x: HUD_HEALTH_ANCHOR, y: HUD_HEALTH_TOP },
      { x: HUD_HEALTH_ANCHOR + HUD_HEALTH_LENGTH, y: HUD_HEALTH_TOP },
      { x: HUD_HEALTH_ANCHOR + HUD_HEALTH_LENGTH + HUD_HEALTH_TIP, y: HUD_HEALTH_TOP + HUD_HEALTH_HEIGHT },
      { x: HUD_HEALTH_ANCHOR, y: HUD_HEALTH_TOP + HUD_HEALTH_HEIGHT },
    ]);
    healthTrack.fillStyle(0x04070f, 0.84);
    healthTrack.fillPoints(healthTrackShape, true);
    healthTrack.lineStyle(1, frameColor, 0.46);
    healthTrack.strokePoints(healthTrackShape, true);
    container.add(healthTrack);

    const healthFill = this.add.graphics();
    container.add(healthFill);
    const healthShine = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    container.add(healthShine);

    const updateHealthMeter = (ratio: number) => {
      const clamped = Phaser.Math.Clamp(ratio, 0, 1);
      healthFill.clear();
      healthShine.clear();
      if (clamped <= 0) {
        return;
      }
      const width = HUD_HEALTH_LENGTH * clamped;
      const tip = HUD_HEALTH_TIP * Math.min(1, clamped);
      const healthPoints = orientPoints([
        { x: HUD_HEALTH_ANCHOR, y: HUD_HEALTH_TOP },
        { x: HUD_HEALTH_ANCHOR + width, y: HUD_HEALTH_TOP },
        { x: HUD_HEALTH_ANCHOR + width + tip, y: HUD_HEALTH_TOP + HUD_HEALTH_HEIGHT },
        { x: HUD_HEALTH_ANCHOR, y: HUD_HEALTH_TOP + HUD_HEALTH_HEIGHT },
      ]);
      healthFill.fillGradientStyle(accentSecondary, accentPrimary, accentSecondary, accentPrimary, 0.95);
      healthFill.fillPoints(healthPoints, true);
      healthFill.lineStyle(1, 0xffffff, 0.14);
      healthFill.strokePoints(healthPoints, true);

      if (width > 14) {
        const shinePoints = orientPoints([
          { x: HUD_HEALTH_ANCHOR + 4, y: HUD_HEALTH_TOP + 4 },
          { x: HUD_HEALTH_ANCHOR + width - 6, y: HUD_HEALTH_TOP + 4 },
          { x: HUD_HEALTH_ANCHOR + width + Math.min(tip, 12) - 6, y: HUD_HEALTH_TOP + HUD_HEALTH_HEIGHT * 0.45 },
          { x: HUD_HEALTH_ANCHOR + 4, y: HUD_HEALTH_TOP + HUD_HEALTH_HEIGHT * 0.45 },
        ]);
        healthShine.fillStyle(0xffffff, 0.18);
        healthShine.fillPoints(shinePoints, true);
      }
    };

    const superTrack = this.add.graphics();
    const superTrackShape = orientPoints([
      { x: HUD_SUPER_ANCHOR, y: HUD_SUPER_TOP },
      { x: HUD_SUPER_ANCHOR + HUD_SUPER_LENGTH, y: HUD_SUPER_TOP },
      { x: HUD_SUPER_ANCHOR + HUD_SUPER_LENGTH + HUD_SUPER_TIP, y: HUD_SUPER_TOP + HUD_SUPER_HEIGHT },
      { x: HUD_SUPER_ANCHOR, y: HUD_SUPER_TOP + HUD_SUPER_HEIGHT },
    ]);
    superTrack.fillStyle(0x050810, 0.86);
    superTrack.fillPoints(superTrackShape, true);
    superTrack.lineStyle(1, frameColor, 0.4);
    superTrack.strokePoints(superTrackShape, true);
    container.add(superTrack);

    const superFill = this.add.graphics();
    container.add(superFill);
    const superGlow = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    container.add(superGlow);
    const superSegments = this.add.graphics();
    superSegments.lineStyle(1, frameColor, 0.22);
    for (let i = 1; i < SUPER_HITS_REQUIRED; i += 1) {
      const ratio = i / SUPER_HITS_REQUIRED;
      const lineX = HUD_SUPER_ANCHOR + ratio * HUD_SUPER_LENGTH;
      const segment = orientPoints([
        { x: lineX, y: HUD_SUPER_TOP + 2 },
        { x: lineX + (isP1 ? HUD_SUPER_TIP * 0.4 : -HUD_SUPER_TIP * 0.4), y: HUD_SUPER_TOP + HUD_SUPER_HEIGHT - 2 },
      ]);
      superSegments.strokePoints(segment, false);
    }
    container.add(superSegments);

    const superMaxBadge = this.add
      .text(orient(HUD_SUPER_ANCHOR + HUD_SUPER_LENGTH + HUD_SUPER_TIP + 10), HUD_SUPER_TOP + HUD_SUPER_HEIGHT + 10, "MAX", {
        fontFamily: "Impact, Arial Black, sans-serif",
        fontSize: "14px",
        color: "#fff6d6",
        stroke: "#1d0a11",
        strokeThickness: 4,
      })
      .setOrigin(isP1 ? 0 : 1, 1)
      .setAlpha(0);
    container.add(superMaxBadge);

    const updateSuperMeter = (ratio: number) => {
      const clamped = Phaser.Math.Clamp(ratio, 0, 1);
      superFill.clear();
      superGlow.clear();
      superFill.setAlpha(0.68 + clamped * 0.32);
      if (clamped <= 0) {
        superMaxBadge.setAlpha(0);
        return;
      }
      const width = HUD_SUPER_LENGTH * clamped;
      const tip = HUD_SUPER_TIP * Math.min(1, clamped);
      const superPoints = orientPoints([
        { x: HUD_SUPER_ANCHOR, y: HUD_SUPER_TOP },
        { x: HUD_SUPER_ANCHOR + width, y: HUD_SUPER_TOP },
        { x: HUD_SUPER_ANCHOR + width + tip, y: HUD_SUPER_TOP + HUD_SUPER_HEIGHT },
        { x: HUD_SUPER_ANCHOR, y: HUD_SUPER_TOP + HUD_SUPER_HEIGHT },
      ]);
      superFill.fillGradientStyle(accentPrimary, accentSecondary, accentPrimary, accentSecondary, 0.9);
      superFill.fillPoints(superPoints, true);
      superFill.lineStyle(1, 0xffffff, 0.1);
      superFill.strokePoints(superPoints, true);

      if (clamped >= 0.999) {
        const glowPoints = orientPoints([
          { x: HUD_SUPER_ANCHOR - 6, y: HUD_SUPER_TOP - 6 },
          { x: HUD_SUPER_ANCHOR + HUD_SUPER_LENGTH + HUD_SUPER_TIP + 10, y: HUD_SUPER_TOP - 6 },
          { x: HUD_SUPER_ANCHOR + HUD_SUPER_LENGTH + HUD_SUPER_TIP + 22, y: HUD_SUPER_TOP + HUD_SUPER_HEIGHT + 12 },
          { x: HUD_SUPER_ANCHOR - 6, y: HUD_SUPER_TOP + HUD_SUPER_HEIGHT + 12 },
        ]);
        superGlow.fillGradientStyle(accentSecondary, accentPrimary, accentSecondary, accentPrimary, 0.34);
        superGlow.fillPoints(glowPoints, true);
        superMaxBadge.setAlpha(1);
      } else {
        superMaxBadge.setAlpha(0);
      }
    };

    return {
      sprite,
      previousSprite,
      renderState: createFighterRenderState(runtime, isP1 ? 0 : 0.7),
      name,
      portrait,
      setName: applyNameText,
      rounds,
      updateHealthMeter,
      updateSuperMeter,
    };
  }

  private stepFixedFrames(deltaSeconds: number) {
    this.accumulator += Math.min(deltaSeconds, 0.1);
    let steps = 0;
    while (this.accumulator >= BATTLE_TICK_SECONDS && steps < 6) {
      const inputs = this.mode === "online" ? this.readNetworkInputsForFrame() : this.readLocalInputs();
      if (!inputs) {
        this.accumulator = Math.min(this.accumulator, BATTLE_TICK_SECONDS);
        break;
      }
      const previousState = this.state;
      this.state = stepBattleFrame(this.state, inputs);
      this.afterSimulationFrame(previousState);
      this.accumulator -= BATTLE_TICK_SECONDS;
      steps += 1;
    }
  }

  private readLocalInputs(): PlayerInputSnapshot {
    const inputs: PlayerInputSnapshot = { p1: createEmptyActions(), p2: createEmptyActions() };
    (["p1", "p2"] as PlayerSlot[]).forEach((slot) => {
      inputs[slot] = this.configData.playerControls?.[slot] === "cpu" ? createCpuActions(this.state, slot) : this.readActionsForSlot(slot);
    });
    return inputs;
  }

  private readNetworkInputsForFrame(): PlayerInputSnapshot | undefined {
    if (!this.networkController) {
      return this.readLocalInputs();
    }
    const localInput = this.readActionsForSlot(this.localSlot);
    this.networkController.queueLocalInput(this.state.frame, localInput);
    const inputs = this.networkController.getInputsForFrame(this.state.frame);
    if (!inputs) {
      const missingFrame = this.networkController.getMissingFrame(this.state.frame) ?? this.state.frame;
      this.onlineStatus = `Syncing frame ${missingFrame}`;
      return undefined;
    }
    this.onlineStatus = undefined;
    return inputs;
  }

  private readActionsForSlot(slot: PlayerSlot) {
    const next = createEmptyActions();
    this.applyKeyboardBindings(next, slot);
    if (this.mode === "online" && slot === "p2") {
      this.applyKeyboardBindings(next, "p1");
    }
    return next;
  }

  private applyKeyboardBindings(actions: ReturnType<typeof createEmptyActions>, slot: PlayerSlot) {
    Object.entries(KEYBOARD_BINDINGS[slot]).forEach(([code, action]) => {
      actions[action] ||= this.pressedCodes.has(code);
    });
  }

  private afterSimulationFrame(previousState: BattleState) {
    this.playVoiceEvents(previousState);
    if (this.mode !== "online" || !this.networkController || this.state.frame % NETPLAY_CHECKSUM_INTERVAL !== 0) {
      return;
    }
    const checksum = getBattleChecksum(this.state);
    this.checksumHistory.set(this.state.frame, checksum);
    this.networkController.sendChecksum(this.state.frame, checksum);
    const pending = this.pendingRemoteChecksums.get(this.state.frame);
    if (pending) {
      this.pendingRemoteChecksums.delete(this.state.frame);
      this.compareRemoteChecksum(this.state.frame, pending);
    }
  }

  private playVoiceEvents(previousState: BattleState) {
    (["p1", "p2"] as PlayerSlot[]).forEach((slot) => {
      const previousAttack = previousState.fighters[slot].attack;
      const currentAttack = this.state.fighters[slot].attack;
      if (currentAttack && !previousAttack) {
        this.playVoice(slot, "attack");
      }
    });

    const hit = this.state.lastHit;
    if (hit && hit.at !== previousState.lastHit?.at) {
      this.playVoice(hit.defender, "hit");
    }

    if (this.state.winner && this.state.winner !== previousState.winner) {
      this.playVoice(this.state.winner, "win");
    }
  }

  private playVoice(slot: PlayerSlot, clip: VoiceClipType) {
    const key = this.getVoiceKey(slot, clip);
    if (!this.cache.audio.exists(key)) {
      return;
    }
    this.sound.play(key, { volume: VOICE_VOLUME[clip] });
  }

  private getVoiceKey(slot: PlayerSlot, clip: VoiceClipType) {
    return `${slot}-voice-${clip}`;
  }

  private processNetworkEvents() {
    if (!this.networkController) {
      return;
    }
    this.networkController.pollEvents().forEach((event) => {
      if (event.type === "checksum") {
        this.compareRemoteChecksum(event.frame, event.checksum);
      } else if (event.type === "restart") {
        this.state = restartMatch(this.state);
        this.resetSyncState();
      } else if (event.type === "exit") {
        this.haltedMessage = event.reason || "Opponent left the match.";
      } else if (event.type === "error") {
        this.haltedMessage = event.message;
      } else if (event.type === "closed") {
        this.haltedMessage = "Connection closed.";
      }
    });
  }

  private compareRemoteChecksum(frame: number, checksum: string) {
    const localChecksum = this.checksumHistory.get(frame);
    if (!localChecksum) {
      this.pendingRemoteChecksums.set(frame, checksum);
      return;
    }
    if (localChecksum !== checksum) {
      this.haltedMessage = "Sync error. Match stopped.";
      this.networkController?.sendError("Sync error. Match stopped.");
    }
  }

  private resetSyncState() {
    this.accumulator = 0;
    this.lastHitAt = -1;
    this.lastSuperAt = -1;
    this.onlineStatus = undefined;
    this.haltedMessage = undefined;
    this.checksumHistory.clear();
    this.pendingRemoteChecksums.clear();
    this.networkController?.resetSync();
  }

  private renderState() {
    if (!this.views) {
      return;
    }

    const deltaSeconds = this.game.loop.delta / 1000;
    const animationDeltaSeconds = this.state.superFreeze ? 0 : deltaSeconds;
    this.updateStageParallax(animationDeltaSeconds);

    (["p1", "p2"] as PlayerSlot[]).forEach((slot) => {
      const runtime = this.state.fighters[slot];
      const view = this.views![slot];
      const frame = updateFighterRenderState(view.renderState, runtime, animationDeltaSeconds, this.state.groundY);
      const texture = this.getFighterTexture(slot, view.renderState.currentPose);
      this.applyFighterImage(view.sprite, texture, frame.current, runtime.facing, frame.currentAlpha);

      if (frame.previous && view.renderState.previousPose) {
        const previousTexture = this.getFighterTexture(slot, view.renderState.previousPose);
        this.applyFighterImage(view.previousSprite, previousTexture, frame.previous, runtime.facing, frame.previousAlpha);
      } else {
        view.previousSprite.setAlpha(0);
      }
      const portraitTexture = this.getPortraitTexture(slot);
      if (view.portrait.texture.key !== portraitTexture) {
        view.portrait.setTexture(portraitTexture);
      }
      view.updateHealthMeter(runtime.health / 100);
      view.updateSuperMeter(runtime.superMeter / SUPER_HITS_REQUIRED);
      view.setName(runtime.name);
      view.rounds.setText(`Rounds: ${runtime.roundsWon}`);
    });
    this.syncFighterDepths();

    if (this.state.lastSuper && this.state.lastSuper.at !== this.lastSuperAt) {
      this.lastSuperAt = this.state.lastSuper.at;
      this.playSuperSound(this.state.lastSuper.attacker);
      this.createSuperFlash(this.state.lastSuper.attacker);
    }

    if (this.state.lastHit && this.state.lastHit.at !== this.lastHitAt) {
      this.lastHitAt = this.state.lastHit.at;
      this.cameras.main.shake(90, 0.004);
      this.playHitSound();
      this.createHitEffects();
    }

    this.timerText?.setText(String(Math.ceil(this.state.timer)));
    const message = this.haltedMessage || this.onlineStatus || this.state.message;
    this.messageText?.setText(message);
    this.messageText?.setAlpha(message ? 1 : 0);
    this.restartHint?.setAlpha(this.state.status === "matchOver" ? 1 : 0);
  }

  private syncFighterDepths() {
    const views = this.views;
    if (!views) {
      return;
    }

    const hitIsRecent = this.state.lastHit
      ? this.state.frame - this.state.lastHit.at <= FIGHTER_HIT_FOREGROUND_FRAMES
      : false;
    const activeAttackers = (["p1", "p2"] as PlayerSlot[]).filter((slot) =>
      Boolean(this.state.fighters[slot].attack),
    );
    const foregroundSlot = hitIsRecent
      ? this.state.lastHit?.attacker
      : activeAttackers.length === 1
        ? activeAttackers[0]
        : undefined;

    (["p1", "p2"] as PlayerSlot[]).forEach((slot) => {
      const defaultDepth = this.getDefaultFighterDepth(slot);
      const depth = foregroundSlot === slot ? FIGHTER_FOREGROUND_DEPTH : defaultDepth;
      views[slot].sprite.setDepth(depth);
      views[slot].previousSprite.setDepth(depth - FIGHTER_PREVIOUS_DEPTH_OFFSET);
    });
  }

  private getDefaultFighterDepth(slot: PlayerSlot) {
    return FIGHTER_BASE_DEPTH + (slot === "p2" ? FIGHTER_DEFAULT_DEPTH_STEP : 0);
  }

  private updateStageParallax(deltaSeconds: number) {
    if (!this.stageImage) {
      return;
    }

    const p1 = this.state.fighters.p1;
    const p2 = this.state.fighters.p2;
    const midpointX = (p1.x + p2.x) / 2;
    const averageAirHeight = Math.max(0, ((this.state.groundY - p1.y) + (this.state.groundY - p2.y)) / 2);
    const maxPanX = Math.max(0, (this.stageImage.displayWidth - ARENA_WIDTH) / 2);
    const maxPanY = Math.max(0, (this.stageImage.displayHeight - ARENA_HEIGHT) / 2);
    const targetX =
      ARENA_CENTER_X - Phaser.Math.Clamp((midpointX - ARENA_CENTER_X) * CUSTOM_STAGE_HORIZONTAL_DRIFT, -maxPanX, maxPanX);
    const targetY = ARENA_CENTER_Y + Phaser.Math.Clamp(averageAirHeight * CUSTOM_STAGE_VERTICAL_DRIFT, -maxPanY, maxPanY);
    const ease = Phaser.Math.Clamp(deltaSeconds * CUSTOM_STAGE_PAN_EASE, 0, 1);

    this.stageImage.setPosition(
      Phaser.Math.Linear(this.stageImage.x, targetX, ease),
      Phaser.Math.Linear(this.stageImage.y, targetY, ease),
    );
  }

  private getFighterTexture(slot: PlayerSlot, pose: FighterPose) {
    const texture = `${slot}-${pose}`;
    return this.textures.exists(texture) ? texture : `${slot}-idle`;
  }

  private getPortraitTexture(slot: PlayerSlot) {
    const preferred = ["portrait", "victory", "idle", "hit", "punch"];
    for (const pose of preferred) {
      const key = `${slot}-${pose}`;
      if (this.textures.exists(key)) {
        return key;
      }
    }
    return `${slot}-idle`;
  }

  private applyFighterImage(
    sprite: Phaser.GameObjects.Image,
    texture: string,
    transform: FighterRenderTransform,
    facing: 1 | -1,
    alphaMultiplier: number,
  ) {
    if (sprite.texture.key !== texture) {
      sprite.setTexture(texture);
    }
    sprite.setPosition(transform.x, transform.y);
    sprite.setFlipX(facing === -1);
    sprite.setDisplaySize(FIGHTER_DISPLAY_SIZE * transform.scaleX, FIGHTER_DISPLAY_SIZE * transform.scaleY);
    sprite.setRotation(transform.rotation);
    sprite.setAlpha(transform.alpha * alphaMultiplier);
    if (transform.tint) {
      sprite.setTint(transform.tint);
    } else {
      sprite.clearTint();
    }
  }

  private createSuperFlash(attackerSlot: PlayerSlot) {
    const attacker = this.state.fighters[attackerSlot];
    const fromLeft = attackerSlot === "p1";
    const slide = fromLeft ? 1 : -1;
    const accent = attackerSlot === "p1" ? 0xf45b69 : 0x2ec4b6;
    const texture = this.getFighterTexture(attackerSlot, "victory");
    const overlay = this.add.container(0, 0).setDepth(SUPER_FLASH_DEPTH);

    const blackout = this.add.rectangle(ARENA_CENTER_X, ARENA_CENTER_Y, ARENA_WIDTH, ARENA_HEIGHT, 0x04030a, 0);
    const flash = this.add
      .rectangle(ARENA_CENTER_X, ARENA_CENTER_Y, ARENA_WIDTH, ARENA_HEIGHT, 0xf8f4df, 0.82)
      .setBlendMode(Phaser.BlendModes.ADD);
    const impactFlash = this.add
      .rectangle(ARENA_CENTER_X, ARENA_CENTER_Y, ARENA_WIDTH, ARENA_HEIGHT, accent, 0)
      .setBlendMode(Phaser.BlendModes.ADD);
    const speedLines = this.createSuperSpeedLines(fromLeft, accent);
    const slash = this.createSuperSlash(fromLeft, accent);

    const portraitStartX = fromLeft ? -180 : ARENA_WIDTH + 180;
    const portraitX = fromLeft ? 288 : 672;
    const portraitY = 486;
    const portraitFlip = attacker.facing === -1;
    const portraitBackdrop = this.add
      .image(portraitStartX - slide * 42, portraitY + 18, texture)
      .setOrigin(0.5, 0.9)
      .setDisplaySize(SUPER_BACKDROP_SIZE, SUPER_BACKDROP_SIZE)
      .setFlipX(portraitFlip)
      .setTint(SUPER_BACKDROP_COLOR)
      .setAlpha(0.24);
    const portraitBackdropScaleX = portraitBackdrop.scaleX;
    const portraitBackdropScaleY = portraitBackdrop.scaleY;
    const portraitShadow = this.add
      .image(portraitStartX - slide * 24, portraitY + 12, texture)
      .setOrigin(0.5, 0.9)
      .setDisplaySize(500, 500)
      .setFlipX(portraitFlip)
      .setTint(0x000000)
      .setAlpha(0.48);
    const portraitGlow = this.add
      .image(portraitStartX - slide * 10, portraitY, texture)
      .setOrigin(0.5, 0.9)
      .setDisplaySize(520, 520)
      .setFlipX(portraitFlip)
      .setTint(accent)
      .setAlpha(0.34)
      .setBlendMode(Phaser.BlendModes.ADD);
    const portrait = this.add
      .image(portraitStartX, portraitY, texture)
      .setOrigin(0.5, 0.9)
      .setDisplaySize(470, 470)
      .setFlipX(portraitFlip);

    const textX = fromLeft ? 678 : 282;
    const textStartX = fromLeft ? ARENA_WIDTH + 120 : -120;
    const title = this.add
      .text(textStartX, 122, "SUPER", {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: "64px",
        color: "#f8f4df",
        stroke: "#090712",
        strokeThickness: 12,
        align: "center",
      })
      .setOrigin(0.5)
      .setRotation(-0.08 * slide)
      .setAlpha(0);
    const name = this.add
      .text(textStartX, 188, attacker.name.toUpperCase(), {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: "21px",
        color: "#f7b267",
        stroke: "#090712",
        strokeThickness: 6,
        align: "center",
        fixedWidth: 330,
      })
      .setOrigin(0.5)
      .setAlpha(0);

    overlay.add([
      blackout,
      speedLines,
      slash,
      flash,
      impactFlash,
      portraitBackdrop,
      portraitShadow,
      portraitGlow,
      portrait,
      title,
      name,
    ]);

    this.cameras.main.shake(250, 0.007);

    this.tweens.add({ targets: blackout, alpha: 0.68, duration: 70, ease: "Cubic.easeOut" });
    this.tweens.add({ targets: blackout, alpha: 0, delay: 540, duration: 220, ease: "Cubic.easeIn" });
    this.tweens.add({ targets: flash, alpha: 0, duration: 140, ease: "Cubic.easeOut" });
    this.tweens.add({ targets: impactFlash, alpha: 0.7, delay: 210, duration: 35, yoyo: true, ease: "Cubic.easeOut" });
    this.tweens.add({ targets: speedLines, x: slide * 150, alpha: 0, duration: 760, ease: "Cubic.easeOut" });
    this.tweens.add({ targets: slash, x: slide * 80, alpha: 0, delay: 420, duration: 250, ease: "Cubic.easeIn" });

    this.tweens.add({
      targets: portraitBackdrop,
      x: portraitX - slide * 42,
      duration: 175,
      ease: "Back.easeOut",
    });
    this.tweens.add({
      targets: portraitBackdrop,
      alpha: 0.34,
      scaleX: portraitBackdropScaleX * 1.04,
      scaleY: portraitBackdropScaleY * 1.04,
      delay: 170,
      duration: 180,
      yoyo: true,
      ease: "Sine.easeInOut",
    });
    this.tweens.add({
      targets: portraitShadow,
      x: portraitX - slide * 24,
      duration: 170,
      ease: "Back.easeOut",
    });
    this.tweens.add({
      targets: portraitGlow,
      x: portraitX - slide * 10,
      duration: 165,
      ease: "Back.easeOut",
    });
    this.tweens.add({
      targets: portrait,
      x: portraitX,
      duration: 160,
      ease: "Back.easeOut",
    });
    this.tweens.add({
      targets: [portraitBackdrop, portraitShadow, portraitGlow, portrait],
      alpha: 0,
      x: portraitX + slide * 78,
      delay: 565,
      duration: 190,
      ease: "Cubic.easeIn",
    });
    this.tweens.add({
      targets: [title, name],
      x: textX,
      alpha: 1,
      duration: 145,
      ease: "Back.easeOut",
    });
    this.tweens.add({
      targets: [title, name],
      x: textX - slide * 46,
      alpha: 0,
      delay: 520,
      duration: 190,
      ease: "Cubic.easeIn",
    });
    this.time.delayedCall(860, () => overlay.destroy(true));
  }

  private createSuperSpeedLines(fromLeft: boolean, accent: number) {
    const slide = fromLeft ? 1 : -1;
    const graphics = this.add.graphics().setAlpha(0.95).setBlendMode(Phaser.BlendModes.ADD);
    for (let index = 0; index < 18; index += 1) {
      const y = 42 + ((index * 47) % 456);
      const thickness = index % 3 === 0 ? 6 : 3;
      const length = 230 + (index % 5) * 46;
      const offset = (index % 4) * 36;
      const startX = fromLeft ? -80 - offset : ARENA_WIDTH + 80 + offset;
      const endX = startX + slide * length;
      graphics.lineStyle(thickness, index % 2 === 0 ? accent : 0xf8f4df, index % 3 === 0 ? 0.68 : 0.45);
      graphics.beginPath();
      graphics.moveTo(startX, y);
      graphics.lineTo(endX, y - slide * (18 + (index % 4) * 8));
      graphics.strokePath();
    }
    return graphics;
  }

  private createSuperSlash(fromLeft: boolean, accent: number) {
    const graphics = this.add.graphics().setAlpha(0.72).setBlendMode(Phaser.BlendModes.ADD);
    const leftX = fromLeft ? 70 : ARENA_WIDTH - 430;
    const rightX = fromLeft ? 560 : ARENA_WIDTH - 70;
    graphics.fillStyle(accent, 0.58);
    graphics.fillTriangle(leftX, 94, rightX, 44, rightX - 82, 150);
    graphics.fillStyle(0xf8f4df, 0.5);
    graphics.fillTriangle(leftX + 54, 394, rightX + 40, 320, rightX - 28, 430);
    return graphics;
  }

  private createHitEffects() {
    if (!this.state.lastHit || !this.views) {
      return;
    }

    const hit = this.state.lastHit;
    const defender = this.state.fighters[hit.defender];
    const attacker = this.state.fighters[hit.attacker];
    const attackerView = this.views[hit.attacker];
    const isSuperHit = attacker.attack?.kind === "special";
    const hitColor = isSuperHit ? 0xf7b267 : hit.damage >= 18 ? 0xf7b267 : 0xf8f4df;

    const damageText = this.add
      .text(defender.x, defender.y - 155, `-${hit.damage}`, {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: "22px",
        color: "#f8f4df",
        stroke: "#1b1724",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(8);
    this.tweens.add({
      targets: damageText,
      y: damageText.y - 32,
      alpha: 0,
      scale: 1.18,
      duration: 520,
      ease: "Cubic.easeOut",
      onComplete: () => damageText.destroy(),
    });

    const impact = this.add.circle(defender.x - defender.facing * 34, defender.y - 92, 18, hitColor, 0.65).setDepth(4);
    this.tweens.add({
      targets: impact,
      alpha: 0,
      scale: 2.8,
      duration: 180,
      ease: "Cubic.easeOut",
      onComplete: () => impact.destroy(),
    });

    if (hit.damage >= 12 || isSuperHit) {
      const afterimage = this.add
        .image(attacker.x - attacker.facing * 22, attacker.y, attackerView.sprite.texture.key)
        .setOrigin(0.5, 0.9)
        .setDisplaySize(attackerView.sprite.displayWidth, attackerView.sprite.displayHeight)
        .setFlipX(attacker.facing === -1)
        .setRotation(attackerView.sprite.rotation)
        .setAlpha(0.34)
        .setTint(0xf7b267)
        .setDepth(FIGHTER_FOREGROUND_DEPTH - FIGHTER_PREVIOUS_DEPTH_OFFSET);
      this.tweens.add({
        targets: afterimage,
        x: afterimage.x - attacker.facing * 34,
        alpha: 0,
        duration: 220,
        ease: "Cubic.easeOut",
        onComplete: () => afterimage.destroy(),
      });
    }
  }

  private playHitSound() {
    if (!this.state.lastHit) {
      return;
    }

    const defender = this.state.fighters[this.state.lastHit.defender];
    playPunchImpactSfx(this.sound, {
      damage: this.state.lastHit.damage,
      x: defender.x,
      arenaWidth: ARENA_WIDTH,
    });
  }

  private playSuperSound(attackerSlot: PlayerSlot) {
    const attacker = this.state.fighters[attackerSlot];
    playSuperSfx(this.sound, {
      x: attacker.x,
      arenaWidth: ARENA_WIDTH,
    });
  }
}
