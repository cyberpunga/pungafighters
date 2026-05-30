import { ContactShadows, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { ArrowLeft, Gamepad2, RotateCcw } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { createEmptyActions, KEYBOARD_BINDINGS } from "../game/input/actions";
import { createCpuActions } from "../game/input/cpu";
import {
  BATTLE_TICK_RATE,
  BATTLE_TICK_SECONDS,
  createBattleState,
  stepBattleFrame,
  SUPER_HITS_REQUIRED,
  type BattleMessage,
  type BattleState,
  type FighterRuntime,
} from "../game/simulation/battle";
import { createFighterRenderState, updateFighterRenderState } from "../phaser/render/fighterAnimation";
import { FIGHTER_POSES, type ActionSnapshot, type BattleConfig, type LoadedFighter, type PlayerSlot } from "../types/game";
import type { Translate } from "../i18n";
import { useI18n } from "../i18n/react";

const STAGE_X_RANGE = 5.1;
const STAGE_Z = 0.1;
const STAGE_JUMP_SCALE = 150;
const MAX_DEBRIS_PIECES = 48;

interface DebrisPiece {
  id: string;
  color: string;
  impulse: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
  torque: [number, number, number];
}

export function StagePreviewView(props: {
  fighters: LoadedFighter[];
  selectedFighterIds: { p1: string; p2: string };
  config: BattleConfig;
  loading: boolean;
  onBack: () => void;
  onFight: () => void;
}) {
  const { t } = useI18n();
  const pressedCodesRef = useRef(new Set<string>());
  const fighters = useMemo(() => selectStageFighters(props.fighters, props.selectedFighterIds), [props.fighters, props.selectedFighterIds]);
  const createInitialState = useCallback(
    () => (fighters ? createBattleState(props.config, { p1: fighters.p1, p2: fighters.p2 }) : undefined),
    [fighters, props.config],
  );
  const [battleState, setBattleState] = useState<BattleState | undefined>(() => createInitialState());
  const battleStateRef = useRef<BattleState | undefined>(battleState);

  useEffect(() => {
    const next = createInitialState();
    battleStateRef.current = next;
    setBattleState(next);
  }, [createInitialState]);

  useEffect(() => {
    battleStateRef.current = battleState;
  }, [battleState]);

  const restartBattle = useCallback(() => {
    const next = createInitialState();
    battleStateRef.current = next;
    setBattleState(next);
  }, [createInitialState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.code === "Enter" && battleStateRef.current?.status === "matchOver") {
        event.preventDefault();
        restartBattle();
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        props.onBack();
        return;
      }
      if (isStageControlCode(event.code)) {
        event.preventDefault();
        pressedCodesRef.current.add(event.code);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      pressedCodesRef.current.delete(event.code);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      pressedCodesRef.current.clear();
    };
  }, [props, restartBattle]);

  return (
    <section className="stage-preview-view">
      <div className="stage-preview-canvas" aria-label={t("stagePreview.ariaStage")}>
        {fighters && battleState ? (
          <Canvas
            dpr={[1, 2]}
            camera={{ position: [0, 2.35, 6.4], fov: 39 }}
            gl={{ antialias: true, alpha: false }}
          >
            <color attach="background" args={["#14131d"]} />
            <Suspense fallback={null}>
              <PlayableStage
                battleState={battleState}
                fighters={fighters}
                pressedCodesRef={pressedCodesRef}
                setBattleState={setBattleState}
              />
            </Suspense>
          </Canvas>
        ) : (
          <div className="stage-preview-loading">{props.loading ? t("common.loading") : t("stagePreview.noFighters")}</div>
        )}
      </div>

      <div className="stage-preview-hud">
        <div className="stage-preview-topbar">
          <button className="icon-button" type="button" onClick={props.onBack} aria-label={t("common.back")} title={t("common.back")}>
            <ArrowLeft size={19} />
          </button>
          <div>
            <p className="eyebrow">{t("stagePreview.eyebrow")}</p>
            <h1>{t("stagePreview.title")}</h1>
          </div>
          <div className="stage-preview-actions">
            <button className="secondary-button" type="button" onClick={restartBattle}>
              <RotateCcw size={18} />
              {t("stagePreview.restart")}
            </button>
            <button className="primary-button" type="button" onClick={props.onFight}>
              <Gamepad2 size={19} />
              {t("stagePreview.pickFighters")}
            </button>
          </div>
        </div>

        {battleState && fighters && (
          <div className="stage-fight-hud" aria-label={t("stagePreview.fightStatus")}>
            <FighterMeter slot="p1" fighter={fighters.p1} state={battleState} />
            <div className="stage-fight-center">
              <strong>{formatBattleMessage(battleState, t)}</strong>
              <span>{t("stagePreview.timer", { seconds: Math.ceil(battleState.timer) })}</span>
              <small>{t("stagePreview.controls")}</small>
            </div>
            <FighterMeter slot="p2" fighter={fighters.p2} state={battleState} />
          </div>
        )}
      </div>
    </section>
  );
}

function PlayableStage(props: {
  battleState: BattleState;
  fighters: { p1: LoadedFighter; p2: LoadedFighter };
  pressedCodesRef: React.MutableRefObject<Set<string>>;
  setBattleState: (state: BattleState) => void;
}) {
  const accumulatorRef = useRef(0);
  const battleStateRef = useRef(props.battleState);
  const lastDebrisHitAtRef = useRef(-1);
  const debrisCleanupTimeoutsRef = useRef<number[]>([]);
  const [debrisPieces, setDebrisPieces] = useState<DebrisPiece[]>([]);

  useEffect(() => {
    battleStateRef.current = props.battleState;
  }, [props.battleState]);

  useEffect(
    () => () => {
      debrisCleanupTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      debrisCleanupTimeoutsRef.current = [];
    },
    [],
  );

  useFrame((_, deltaSeconds) => {
    accumulatorRef.current += Math.min(deltaSeconds, 0.1);
    let next = battleStateRef.current;
    let steps = 0;
    while (accumulatorRef.current >= BATTLE_TICK_SECONDS && steps < 6) {
      const inputs = {
        p1: readP1Actions(props.pressedCodesRef.current),
        p2: createCpuActions(next, "p2"),
      };
      next = stepBattleFrame(next, inputs);
      accumulatorRef.current -= BATTLE_TICK_SECONDS;
      steps += 1;
    }
    if (next !== battleStateRef.current) {
      battleStateRef.current = next;
      props.setBattleState(next);
    }

    const hit = next.lastHit;
    if (hit && hit.at !== lastDebrisHitAtRef.current) {
      lastDebrisHitAtRef.current = hit.at;
      const pieces = createImpactDebris(next);
      setDebrisPieces((current) => [...current, ...pieces].slice(-MAX_DEBRIS_PIECES));
      const timeout = window.setTimeout(() => {
        setDebrisPieces((current) => current.filter((piece) => !pieces.some((nextPiece) => nextPiece.id === piece.id)));
      }, 1800);
      debrisCleanupTimeoutsRef.current.push(timeout);
    }
  });

  return (
    <>
      <ambientLight intensity={0.72} />
      <directionalLight
        castShadow
        color="#fff4d3"
        intensity={2.35}
        position={[-3.6, 5.4, 4.2]}
        shadow-camera-far={16}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-4}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <spotLight color="#2ec4b6" intensity={1.9} position={[-4.5, 2.5, 2.2]} angle={0.48} penumbra={0.7} />
      <spotLight color="#f45b69" intensity={1.7} position={[4.5, 2.4, 2.4]} angle={0.48} penumbra={0.7} />

      <TheaterSet />
      <FightingStandee fighter={props.fighters.p1} runtime={props.battleState.fighters.p1} battleState={props.battleState} />
      <FightingStandee fighter={props.fighters.p2} runtime={props.battleState.fighters.p2} battleState={props.battleState} />
      <HitSpark state={props.battleState} />
      <CameraRig state={props.battleState} />
      <Physics gravity={[0, -8.5, 0]}>
        <StagePhysicsColliders />
        <ImpactDebris pieces={debrisPieces} />
      </Physics>
      <ContactShadows position={[0, 0.025, STAGE_Z]} opacity={0.38} blur={2.4} scale={7} far={4} resolution={1024} />
    </>
  );
}

function FighterMeter(props: { slot: PlayerSlot; fighter: LoadedFighter; state: BattleState }) {
  const runtime = props.state.fighters[props.slot];
  const health = Math.max(0, Math.min(1, runtime.health / 100));
  const superMeter = Math.max(0, Math.min(1, runtime.superMeter / SUPER_HITS_REQUIRED));

  return (
    <div className={`stage-fighter-meter ${props.slot}`}>
      <div className="stage-fighter-name">
        <span>{props.slot.toUpperCase()}</span>
        <strong>{props.fighter.name}</strong>
      </div>
      <div className="stage-meter-track health" aria-hidden="true">
        <span style={{ transform: `scaleX(${health})` }} />
      </div>
      <div className="stage-meter-track super" aria-hidden="true">
        <span style={{ transform: `scaleX(${superMeter})` }} />
      </div>
      <small>{runtime.roundsWon}</small>
    </div>
  );
}

function TheaterSet() {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[8.4, 5.4]} />
        <meshStandardMaterial color="#272132" roughness={0.88} metalness={0.03} />
      </mesh>
      <gridHelper args={[8.2, 18, "#f7b267", "#464153"]} position={[0, 0.018, 0]} />
      <mesh receiveShadow position={[0, 2.25, -2.35]}>
        <planeGeometry args={[8.4, 4.6]} />
        <meshStandardMaterial color="#1d1a28" roughness={0.92} />
      </mesh>
      <mesh position={[0, 2.4, -2.31]}>
        <planeGeometry args={[6.6, 2.6]} />
        <meshBasicMaterial color="#2ec4b6" transparent opacity={0.08} />
      </mesh>
      <mesh receiveShadow rotation={[0, Math.PI * 0.38, 0]} position={[-4.18, 2.15, -0.55]}>
        <planeGeometry args={[4.3, 4.4]} />
        <meshStandardMaterial color="#211b2b" roughness={0.9} />
      </mesh>
      <mesh receiveShadow rotation={[0, -Math.PI * 0.38, 0]} position={[4.18, 2.15, -0.55]}>
        <planeGeometry args={[4.3, 4.4]} />
        <meshStandardMaterial color="#211b2b" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 0.08, 1.55]}>
        <boxGeometry args={[6.4, 0.16, 0.22]} />
        <meshStandardMaterial color="#f7b267" roughness={0.58} />
      </mesh>
    </group>
  );
}

function FightingStandee(props: { fighter: LoadedFighter; runtime: FighterRuntime; battleState: BattleState }) {
  const textures = usePoseTextures(props.fighter);
  const groupRef = useRef<THREE.Group>(null);
  const renderStateRef = useRef(createFighterRenderState(props.runtime, props.runtime.slot === "p1" ? 0 : 0.7));
  const geometry = useMemo(() => {
    const height = 2.35;
    const frame = props.fighter.frames.idle;
    const width = height * Math.max(0.82, Math.min(1.12, frame.width / frame.height));
    const anchorY = Number.isFinite(frame.anchor.y) ? frame.anchor.y : 0.9;
    return { width, height, centerY: 0.08 + height * (anchorY - 0.5) };
  }, [props.fighter]);

  useEffect(() => {
    renderStateRef.current = createFighterRenderState(props.runtime, props.runtime.slot === "p1" ? 0 : 0.7);
  }, [props.fighter.id]);

  useFrame((_, deltaSeconds) => {
    if (!groupRef.current) {
      return;
    }
    const frame = updateFighterRenderState(renderStateRef.current, props.runtime, props.battleState.superFreeze ? 0 : deltaSeconds, props.battleState.groundY);
    const positionX = mapBattleX(frame.current.x, props.battleState.arenaWidth);
    const positionY = Math.max(0, (props.battleState.groundY - frame.current.y) / STAGE_JUMP_SCALE);
    groupRef.current.position.set(positionX, positionY, STAGE_Z);
    groupRef.current.rotation.set(0, props.runtime.facing === 1 ? 0.13 : -0.13, frame.current.rotation);
    groupRef.current.scale.set(Math.abs(frame.current.scaleX), frame.current.scaleY, 1);
  });

  const texture = textures[props.runtime.pose];
  const tint = props.runtime.hitStun > 0 ? "#f8f4df" : props.runtime.blocking ? "#d9d2b6" : props.runtime.attack?.kind === "special" ? "#f7b267" : "#ffffff";
  const alpha = props.runtime.blocking ? 0.78 : 1;
  const facingScale = props.runtime.facing === 1 ? 1 : -1;

  return (
    <group ref={groupRef}>
      <mesh castShadow position={[0, geometry.centerY, -0.065]} scale={[1.055 * facingScale, 1.055, 1]}>
        <planeGeometry args={[geometry.width, geometry.height]} />
        <meshStandardMaterial map={texture} color="#6f5134" transparent alphaTest={0.08} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh castShadow position={[0, geometry.centerY, -0.025]} scale={[facingScale, 1, 1]}>
        <planeGeometry args={[geometry.width, geometry.height]} />
        <meshStandardMaterial map={texture} color={tint} transparent opacity={alpha} alphaTest={0.08} roughness={0.72} side={THREE.DoubleSide} />
      </mesh>
      <mesh castShadow position={[0, 0.16, -0.08]}>
        <boxGeometry args={[geometry.width * 0.42, 0.16, 0.42]} />
        <meshStandardMaterial color="#8a603a" roughness={0.82} />
      </mesh>
      <mesh position={[0, 0.28, -0.03]}>
        <boxGeometry args={[geometry.width * 0.3, 0.18, 0.08]} />
        <meshStandardMaterial color="#3a2a22" roughness={0.9} />
      </mesh>
    </group>
  );
}

function HitSpark(props: { state: BattleState }) {
  const sparkRef = useRef<THREE.Group>(null);
  const visibleUntilRef = useRef(-1);
  const lastHitAtRef = useRef(-1);

  useFrame(() => {
    if (!sparkRef.current) {
      return;
    }
    const hit = props.state.lastHit;
    if (hit && hit.at !== lastHitAtRef.current) {
      lastHitAtRef.current = hit.at;
      visibleUntilRef.current = props.state.frame + 10;
      const defender = props.state.fighters[hit.defender];
      sparkRef.current.position.set(mapBattleX(defender.x, props.state.arenaWidth), 1.18, STAGE_Z + 0.04);
    }
    const visible = props.state.frame <= visibleUntilRef.current;
    sparkRef.current.visible = visible;
    if (visible) {
      const pulse = Math.sin(props.state.frame * 0.6) * 0.12;
      sparkRef.current.scale.setScalar(0.8 + pulse);
    }
  });

  return (
    <group ref={sparkRef} visible={false}>
      <mesh>
        <sphereGeometry args={[0.16, 12, 8]} />
        <meshBasicMaterial color="#f8f4df" transparent opacity={0.86} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <planeGeometry args={[0.56, 0.08]} />
        <meshBasicMaterial color="#f7b267" transparent opacity={0.78} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <planeGeometry args={[0.08, 0.56]} />
        <meshBasicMaterial color="#f45b69" transparent opacity={0.78} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function StagePhysicsColliders() {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[4.2, 0.04, 2.7]} position={[0, -0.04, 0]} />
      <CuboidCollider args={[4.2, 2.25, 0.04]} position={[0, 2.25, -2.36]} />
      <CuboidCollider args={[0.04, 1.2, 2.2]} position={[-3.85, 1.2, 0]} />
      <CuboidCollider args={[0.04, 1.2, 2.2]} position={[3.85, 1.2, 0]} />
    </RigidBody>
  );
}

function ImpactDebris(props: { pieces: DebrisPiece[] }) {
  return (
    <>
      {props.pieces.map((piece) => (
        <DebrisBody key={piece.id} piece={piece} />
      ))}
    </>
  );
}

function DebrisBody(props: { piece: DebrisPiece }) {
  const bodyRef = useRef<RapierRigidBody>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    body.applyImpulse({ x: props.piece.impulse[0], y: props.piece.impulse[1], z: props.piece.impulse[2] }, true);
    body.applyTorqueImpulse({ x: props.piece.torque[0], y: props.piece.torque[1], z: props.piece.torque[2] }, true);
  }, [props.piece]);

  return (
    <RigidBody
      ref={bodyRef}
      colliders="cuboid"
      linearDamping={1.5}
      angularDamping={1.1}
      position={props.piece.position}
      rotation={props.piece.rotation}
      restitution={0.28}
      friction={0.82}
    >
      <mesh castShadow>
        <boxGeometry args={props.piece.size} />
        <meshStandardMaterial color={props.piece.color} roughness={0.86} />
      </mesh>
    </RigidBody>
  );
}

function CameraRig(props: { state: BattleState }) {
  const { camera } = useThree();
  const shakeRef = useRef(0);
  const lastHitAtRef = useRef(-1);
  const lastSuperAtRef = useRef(-1);

  useFrame((_, deltaSeconds) => {
    if (props.state.lastHit && props.state.lastHit.at !== lastHitAtRef.current) {
      lastHitAtRef.current = props.state.lastHit.at;
      shakeRef.current = 0.14;
    }
    if (props.state.lastSuper && props.state.lastSuper.at !== lastSuperAtRef.current) {
      lastSuperAtRef.current = props.state.lastSuper.at;
      shakeRef.current = 0.22;
    }
    shakeRef.current = Math.max(0, shakeRef.current - deltaSeconds);
    const shake = shakeRef.current > 0 ? Math.sin(props.state.frame * 1.7) * shakeRef.current : 0;
    camera.position.set(shake, 2.35 + shake * 0.3, 6.4 - (props.state.superFreeze ? 0.35 : 0));
    camera.lookAt(0, 1.05, 0);
  });
  return null;
}

function usePoseTextures(fighter: LoadedFighter): Record<LoadedFighter["frames"]["idle"]["pose"], THREE.Texture> {
  const textureList = useTexture(FIGHTER_POSES.map((pose) => fighter.frameUrls[pose])) as THREE.Texture[];
  return useMemo(() => {
    const pairs = FIGHTER_POSES.map((pose, index) => {
      const texture = textureList[index];
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return [pose, texture] as const;
    });
    return Object.fromEntries(pairs) as Record<LoadedFighter["frames"]["idle"]["pose"], THREE.Texture>;
  }, [textureList]);
}

function selectStageFighters(fighters: LoadedFighter[], selected: { p1: string; p2: string }) {
  const p1 = fighters.find((fighter) => fighter.id === selected.p1) ?? fighters[0];
  const p2 = fighters.find((fighter) => fighter.id === selected.p2 && fighter.id !== p1?.id) ?? fighters.find((fighter) => fighter.id !== p1?.id) ?? p1;
  return p1 && p2 ? { p1, p2 } : undefined;
}

function readP1Actions(pressedCodes: Set<string>): ActionSnapshot {
  const actions = createEmptyActions();
  Object.entries(KEYBOARD_BINDINGS.p1).forEach(([code, action]) => {
    actions[action] ||= pressedCodes.has(code);
  });
  return actions;
}

function isStageControlCode(code: string) {
  return code in KEYBOARD_BINDINGS.p1;
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function formatBattleMessage(state: BattleState, t: Translate) {
  const message = state.message;
  if (!message) {
    return state.status === "running" ? t("battle.fight") : "";
  }
  return getBattleMessageText(message, state, t);
}

function getBattleMessageText(message: BattleMessage, state: BattleState, t: Translate) {
  switch (message.type) {
    case "ready":
      return t("battle.ready");
    case "fight":
      return t("battle.fight");
    case "match-winner":
      return t("battle.wins", { name: state.fighters[message.winner].name });
    case "round-winner":
      return t("battle.takesRound", { name: state.fighters[message.winner].name });
  }
}

function mapBattleX(x: number, arenaWidth: number) {
  return (x / arenaWidth - 0.5) * STAGE_X_RANGE;
}

function createImpactDebris(state: BattleState): DebrisPiece[] {
  const hit = state.lastHit;
  if (!hit) {
    return [];
  }
  const attacker = state.fighters[hit.attacker];
  const defender = state.fighters[hit.defender];
  const direction = defender.x >= attacker.x ? 1 : -1;
  const origin: [number, number, number] = [mapBattleX(defender.x, state.arenaWidth), 1.05, STAGE_Z + 0.08];
  return Array.from({ length: 7 }, (_, index) => {
    const seed = hit.at * 31 + index * 17;
    const outward = 0.55 + seededUnit(seed) * 0.4;
    const lift = 0.55 + seededUnit(seed + 1) * 0.65;
    const depth = (seededUnit(seed + 2) - 0.5) * 0.34;
    return {
      id: `${hit.at}-${index}`,
      color: index % 3 === 0 ? "#8a603a" : index % 3 === 1 ? "#f7b267" : "#3a2a22",
      impulse: [direction * outward, lift, depth],
      position: [origin[0] + direction * 0.08 * index, origin[1] + seededUnit(seed + 3) * 0.2, origin[2] + depth * 0.2],
      rotation: [seededUnit(seed + 4) * Math.PI, seededUnit(seed + 5) * Math.PI, seededUnit(seed + 6) * Math.PI],
      size: [0.08 + seededUnit(seed + 7) * 0.09, 0.035 + seededUnit(seed + 8) * 0.05, 0.06 + seededUnit(seed + 9) * 0.08],
      torque: [(seededUnit(seed + 10) - 0.5) * 0.32, (seededUnit(seed + 11) - 0.5) * 0.4, direction * (0.22 + seededUnit(seed + 12) * 0.42)],
    };
  });
}

function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
