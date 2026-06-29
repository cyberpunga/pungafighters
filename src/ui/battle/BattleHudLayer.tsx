import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { SUPER_HITS_REQUIRED, type BattleState } from "../../game/simulation/battle";
import type { LoadedFighter, PlayerSlot } from "../../types/game";
import { useI18n } from "../../i18n/react";
import { formatBattleMessage } from "./stageInput";

export function BattleHudLayer(props: { fighters: { p1: LoadedFighter; p2: LoadedFighter }; state: BattleState; controlsHint: string; statusMessage?: string }) {
  const { t } = useI18n();
  const { camera, size } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const p1Ref = useRef<THREE.Mesh>(null);
  const p2Ref = useRef<THREE.Mesh>(null);
  const centerRef = useRef<THREE.Mesh>(null);
  const p1Texture = useHudTexture(640, 190);
  const p2Texture = useHudTexture(640, 190);
  const centerTexture = useHudTexture(280, 220);
  const p1Runtime = props.state.fighters.p1;
  const p2Runtime = props.state.fighters.p2;
  const p1Health = Math.max(0, Math.min(1, p1Runtime.health / 100));
  const p2Health = Math.max(0, Math.min(1, p2Runtime.health / 100));
  const p1SuperRatio = SUPER_HITS_REQUIRED > 0 ? Math.max(0, Math.min(1, p1Runtime.superMeter / SUPER_HITS_REQUIRED)) : 1;
  const p2SuperRatio = SUPER_HITS_REQUIRED > 0 ? Math.max(0, Math.min(1, p2Runtime.superMeter / SUPER_HITS_REQUIRED)) : 1;
  const message = formatBattleMessage(props.state, t, props.statusMessage);
  const hint = props.state.status === "matchOver" ? t("battle.restartHint") : props.controlsHint;
  const seconds = Math.ceil(props.state.timer);

  useEffect(() => {
    drawFighterHudCanvas(p1Texture.canvas, {
      health: p1Health,
      name: props.fighters.p1.name,
      roundsWon: p1Runtime.roundsWon,
      slot: "p1",
      superRatio: p1SuperRatio,
      superReady: p1Runtime.superMeter >= SUPER_HITS_REQUIRED,
      maxLabel: t("battle.max"),
    });
    p1Texture.texture.needsUpdate = true;
  }, [p1Health, p1Runtime.roundsWon, p1Runtime.superMeter, p1SuperRatio, p1Texture, props.fighters.p1.name, t]);

  useEffect(() => {
    drawFighterHudCanvas(p2Texture.canvas, {
      health: p2Health,
      name: props.fighters.p2.name,
      roundsWon: p2Runtime.roundsWon,
      slot: "p2",
      superRatio: p2SuperRatio,
      superReady: p2Runtime.superMeter >= SUPER_HITS_REQUIRED,
      maxLabel: t("battle.max"),
    });
    p2Texture.texture.needsUpdate = true;
  }, [p2Health, p2Runtime.roundsWon, p2Runtime.superMeter, p2SuperRatio, p2Texture, props.fighters.p2.name, t]);

  useEffect(() => {
    drawCenterHudCanvas(centerTexture.canvas, { hint, message, seconds });
    centerTexture.texture.needsUpdate = true;
  }, [centerTexture, hint, message, seconds]);

  useFrame(() => {
    const group = groupRef.current;
    const p1 = p1Ref.current;
    const p2 = p2Ref.current;
    const center = centerRef.current;
    if (!group || !p1 || !p2 || !center || !(camera instanceof THREE.PerspectiveCamera)) {
      return;
    }
    const distance = 4.25;
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
    const width = height * (size.width / Math.max(1, size.height));
    const marginX = width * 0.024;
    const marginY = height * 0.034;
    const fighterWidth = Math.min(width * 0.42, 2.55);
    const fighterHeight = fighterWidth * (190 / 640);
    const centerWidth = Math.min(width * 0.14, 0.78);
    const centerHeight = centerWidth * (220 / 280);
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    group.position.copy(camera.position).addScaledVector(direction, distance);
    group.quaternion.copy(camera.quaternion);
    p1.position.set(-width / 2 + marginX + fighterWidth / 2, height / 2 - marginY - fighterHeight / 2, 0);
    p2.position.set(width / 2 - marginX - fighterWidth / 2, height / 2 - marginY - fighterHeight / 2, 0);
    center.position.set(0, height / 2 - marginY - centerHeight / 2, 0.002);
    p1.scale.set(fighterWidth, fighterHeight, 1);
    p2.scale.set(fighterWidth, fighterHeight, 1);
    center.scale.set(centerWidth, centerHeight, 1);
  });

  return (
    <group ref={groupRef} renderOrder={80}>
      <HudPlane meshRef={p1Ref} texture={p1Texture.texture} />
      <HudPlane meshRef={centerRef} texture={centerTexture.texture} />
      <HudPlane meshRef={p2Ref} texture={p2Texture.texture} />
    </group>
  );
}

function HudPlane(props: { meshRef: RefObject<THREE.Mesh>; texture: THREE.Texture }) {
  return (
    <mesh ref={props.meshRef} renderOrder={80}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={props.texture} transparent depthTest={false} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function useHudTexture(width: number, height: number) {
  const hudTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return { canvas, texture };
  }, [height, width]);

  useEffect(() => () => hudTexture.texture.dispose(), [hudTexture]);

  return hudTexture;
}

function drawFighterHudCanvas(
  canvas: HTMLCanvasElement,
  options: {
    health: number;
    maxLabel: string;
    name: string;
    roundsWon: number;
    slot: PlayerSlot;
    superRatio: number;
    superReady: boolean;
  },
) {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const isP1 = options.slot === "p1";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  if (!isP1) {
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }

  context.fillStyle = "rgba(5, 8, 16, 0.82)";
  context.strokeStyle = "rgba(248, 244, 223, 0.2)";
  context.lineWidth = 3;
  drawSkewPanel(context, 22, 22, 590, 128, 38);
  context.fill();
  context.stroke();

  const accent = isP1 ? "#2ec4b6" : "#f45b69";
  const healthGradient = context.createLinearGradient(158, 70, 550, 70);
  healthGradient.addColorStop(0, accent);
  healthGradient.addColorStop(1, "#f8f4df");
  drawHudBar(context, 154, 58, 390, 28, options.health, healthGradient, 22);

  const superGradient = context.createLinearGradient(154, 110, 398, 110);
  superGradient.addColorStop(0, "#f7b267");
  superGradient.addColorStop(1, "#f8f4df");
  drawHudBar(context, 154, 104, 260, 16, options.superRatio, superGradient, 12);
  context.strokeStyle = "rgba(248, 244, 223, 0.2)";
  context.lineWidth = 1;
  for (let index = 1; index < Math.max(1, SUPER_HITS_REQUIRED); index += 1) {
    const x = 154 + (260 * index) / SUPER_HITS_REQUIRED;
    context.beginPath();
    context.moveTo(x, 105);
    context.lineTo(x + 8, 119);
    context.stroke();
  }

  context.fillStyle = "rgba(247, 178, 103, 0.18)";
  context.strokeStyle = "rgba(247, 178, 103, 0.42)";
  roundRect(context, 34, 48, 88, 88, 44);
  context.fill();
  context.stroke();

  if (isP1) {
    context.fillStyle = "#f8f4df";
    context.font = "900 34px Arial, sans-serif";
    context.textBaseline = "middle";
    context.textAlign = "left";
    context.fillText(fitCanvasText(context, options.name, 300), 154, 34);

    context.fillStyle = "#f7b267";
    context.font = "900 18px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(options.slot.toUpperCase(), 78, 42);
    context.fillText(String(options.roundsWon), 78, 98);
    if (options.superReady) {
      context.fillStyle = "#f7b267";
      context.font = "900 22px Arial, sans-serif";
      context.textAlign = "left";
      context.fillText(options.maxLabel, 430, 114);
    }
  }

  context.restore();
  if (!isP1) {
    context.save();
    context.fillStyle = "#f8f4df";
    context.font = "900 34px Arial, sans-serif";
    context.textBaseline = "middle";
    context.textAlign = "right";
    context.fillText(fitCanvasText(context, options.name, 300), 486, 34);
    context.fillStyle = "#f7b267";
    context.font = "900 18px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(options.slot.toUpperCase(), 562, 42);
    context.fillText(String(options.roundsWon), 562, 98);
    if (options.superReady) {
      context.font = "900 22px Arial, sans-serif";
      context.textAlign = "right";
      context.fillText(options.maxLabel, 210, 114);
    }
    context.restore();
  }
}

function drawCenterHudCanvas(canvas: HTMLCanvasElement, options: { hint: string; message: string; seconds: number }) {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(5, 8, 16, 0.86)";
  context.strokeStyle = "rgba(248, 244, 223, 0.2)";
  context.lineWidth = 3;
  drawSkewPanel(context, 22, 18, 236, 150, 28);
  context.fill();
  context.stroke();

  context.fillStyle = "#f8f4df";
  context.font = "900 76px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(options.seconds), canvas.width / 2, 70);

  context.fillStyle = "#f7b267";
  context.font = "900 24px Arial, sans-serif";
  context.fillText(fitCanvasText(context, options.message, 210), canvas.width / 2, 122);

  context.fillStyle = "rgba(248, 244, 223, 0.72)";
  context.font = "800 13px Arial, sans-serif";
  wrapCanvasText(context, options.hint, canvas.width / 2, 154, 214, 16);
}

function drawHudBar(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, ratio: number, fill: CanvasGradient, tip: number) {
  context.save();
  context.fillStyle = "rgba(248, 244, 223, 0.12)";
  drawSkewPanel(context, x, y, width, height, tip);
  context.fill();
  context.clip();
  context.fillStyle = fill;
  context.fillRect(x, y, width * ratio, height);
  context.restore();
}

function drawSkewPanel(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, skew: number) {
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + width - skew, y);
  context.lineTo(x + width, y + height);
  context.lineTo(x + skew, y + height);
  context.closePath();
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function fitCanvasText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) {
    return value;
  }
  let next = value;
  while (next.length > 1 && context.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next}...`;
}

function wrapCanvasText(context: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = value.split(/\s+/);
  let line = "";
  let lineIndex = 0;
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (context.measureText(test).width > maxWidth && line) {
      context.fillText(line, x, y + lineIndex * lineHeight);
      line = word;
      lineIndex += 1;
      return;
    }
    line = test;
  });
  if (line) {
    context.fillText(line, x, y + lineIndex * lineHeight);
  }
}
