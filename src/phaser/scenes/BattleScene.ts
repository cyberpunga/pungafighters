import Phaser from "phaser";
import type { BattleConfig, LoadedFighter, PlayerInputSnapshot, PlayerSlot } from "../../types/game";
import { createEmptyActions, KEYBOARD_BINDINGS } from "../../game/input/actions";
import { createBattleState, restartMatch, stepBattle, type BattleState } from "../../game/simulation/battle";

interface FighterView {
  sprite: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  health: Phaser.GameObjects.Rectangle;
  rounds: Phaser.GameObjects.Text;
}

export class BattleScene extends Phaser.Scene {
  private state: BattleState;
  private readonly configData: BattleConfig;
  private readonly fighters: { p1: LoadedFighter; p2: LoadedFighter };
  private readonly onExit: () => void;
  private inputs: PlayerInputSnapshot = { p1: createEmptyActions(), p2: createEmptyActions() };
  private views?: Record<PlayerSlot, FighterView>;
  private timerText?: Phaser.GameObjects.Text;
  private messageText?: Phaser.GameObjects.Text;
  private restartHint?: Phaser.GameObjects.Text;
  private pressedCodes = new Set<string>();
  private lastHitAt = 0;
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    this.captureKey(event);
    this.pressedCodes.add(event.code);
  };
  private readonly handleKeyUp = (event: KeyboardEvent) => {
    this.captureKey(event);
    this.pressedCodes.delete(event.code);
  };

  constructor(config: BattleConfig, fighters: { p1: LoadedFighter; p2: LoadedFighter }, onExit: () => void) {
    super("BattleScene");
    this.configData = config;
    this.fighters = fighters;
    this.onExit = onExit;
    this.state = createBattleState(config, {
      p1: { id: fighters.p1.id, name: fighters.p1.name },
      p2: { id: fighters.p2.id, name: fighters.p2.name },
    });
  }

  preload() {
    this.loadFighterTextures("p1", this.fighters.p1);
    this.loadFighterTextures("p2", this.fighters.p2);
  }

  create() {
    this.createArena();
    this.createInputs();
    this.views = {
      p1: this.createFighterView("p1", 72, 32),
      p2: this.createFighterView("p2", 888, 32),
    };
    this.timerText = this.add.text(480, 28, "60", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "32px",
      color: "#f8f4df",
    }).setOrigin(0.5, 0);
    this.messageText = this.add.text(480, 212, "Ready", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "48px",
      color: "#f8f4df",
      stroke: "#1b1724",
      strokeThickness: 8,
    }).setOrigin(0.5);
    this.restartHint = this.add.text(480, 478, "Enter: restart  |  Esc: menu", {
      fontFamily: "Arial, sans-serif",
      fontSize: "16px",
      color: "#d9d2b6",
    }).setOrigin(0.5).setAlpha(0);
  }

  update(_time: number, delta: number) {
    this.readInputs();
    if (this.pressedCodes.has("Enter") && this.state.status === "matchOver") {
      this.state = restartMatch(this.state);
    }
    if (this.pressedCodes.has("Escape")) {
      this.onExit();
      return;
    }

    this.state = stepBattle(this.state, this.inputs, delta / 1000);
    this.renderState();
  }

  private loadFighterTextures(slot: PlayerSlot, fighter: LoadedFighter) {
    Object.entries(fighter.frameUrls).forEach(([pose, url]) => {
      if (url) {
        this.load.image(`${slot}-${pose}`, url);
      }
    });
  }

  private createArena() {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x25223a, 0x25223a, 0x101018, 0x101018, 1);
    bg.fillRect(0, 0, 960, 540);
    bg.fillStyle(0x2ec4b6, 0.14);
    bg.fillRect(0, 428, 960, 112);
    bg.lineStyle(3, 0xf8f4df, 0.4);
    bg.lineBetween(0, 430, 960, 430);

    for (let x = 80; x < 960; x += 140) {
      bg.lineStyle(2, 0xf45b69, 0.18);
      bg.lineBetween(x, 430, x + 80, 540);
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
    const sprite = this.add.image(runtime.x, runtime.y, `${slot}-idle`).setOrigin(0.5, 0.9).setDisplaySize(190, 190);
    if (slot === "p2") {
      sprite.setFlipX(true);
    }
    const name = this.add.text(hudX, hudY, runtime.name, {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "18px",
      color: "#f8f4df",
    }).setOrigin(slot === "p1" ? 0 : 1, 0);
    const healthBack = this.add.rectangle(hudX, hudY + 34, 300, 16, 0x0d0d12, 0.8).setOrigin(slot === "p1" ? 0 : 1, 0);
    const health = this.add.rectangle(hudX, hudY + 34, 300, 16, slot === "p1" ? 0xf45b69 : 0x2ec4b6, 1).setOrigin(slot === "p1" ? 0 : 1, 0);
    healthBack.setStrokeStyle(1, 0xf8f4df, 0.3);
    const rounds = this.add.text(hudX, hudY + 58, "Rounds: 0", {
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      color: "#d9d2b6",
    }).setOrigin(slot === "p1" ? 0 : 1, 0);
    return { sprite, name, health, rounds };
  }

  private readInputs() {
    (["p1", "p2"] as PlayerSlot[]).forEach((slot) => {
      const next = createEmptyActions();
      Object.entries(KEYBOARD_BINDINGS[slot]).forEach(([code, action]) => {
        next[action] = this.pressedCodes.has(code);
      });
      this.inputs[slot] = next;
    });
  }

  private renderState() {
    if (!this.views) {
      return;
    }

    (["p1", "p2"] as PlayerSlot[]).forEach((slot) => {
      const runtime = this.state.fighters[slot];
      const view = this.views![slot];
      const pose = runtime.pose === "victory" ? "victory" : runtime.pose;
      const texture = `${slot}-${pose}`;
      if (this.textures.exists(texture) && view.sprite.texture.key !== texture) {
        view.sprite.setTexture(texture);
      }
      view.sprite.setPosition(runtime.x, runtime.y);
      view.sprite.setFlipX(runtime.facing === -1);
      view.sprite.setAlpha(runtime.blocking ? 0.76 : 1);
      view.health.displayWidth = 300 * (runtime.health / 100);
      view.name.setText(runtime.name);
      view.rounds.setText(`Rounds: ${runtime.roundsWon}`);
    });

    if (this.state.lastHit && this.state.lastHit.at !== this.lastHitAt) {
      this.lastHitAt = this.state.lastHit.at;
      this.cameras.main.shake(90, 0.004);
      const defender = this.state.fighters[this.state.lastHit.defender];
      this.add.text(defender.x, defender.y - 155, `-${this.state.lastHit.damage}`, {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: "22px",
        color: "#f8f4df",
        stroke: "#1b1724",
        strokeThickness: 5,
      }).setOrigin(0.5);
    }

    this.timerText?.setText(String(Math.ceil(this.state.timer)));
    this.messageText?.setText(this.state.message);
    this.messageText?.setAlpha(this.state.message ? 1 : 0);
    this.restartHint?.setAlpha(this.state.status === "matchOver" ? 1 : 0);
  }
}
