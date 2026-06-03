import { ContactShadows, Text, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { createEmptyActions, KEYBOARD_BINDINGS } from "../game/input/actions";
import { createCpuActions } from "../game/input/cpu";
import type { NetworkInputController } from "../game/network/networkInputController";
import { NETPLAY_CHECKSUM_INTERVAL } from "../game/network/protocol";
import {
  BATTLE_TICK_SECONDS,
  createBattleState,
  getBattleChecksum,
  restartMatch,
  stepBattleFrame,
  SUPER_HITS_REQUIRED,
  type BattleMessage,
  type BattleState,
  type FighterRuntime,
} from "../game/simulation/battle";
import { createFighterRenderState, updateFighterRenderState } from "../game/render/fighterAnimation";
import {
  FIGHTER_POSES,
  type ActionSnapshot,
  type BattleConfig,
  type BattlePostEffect,
  type LoadedFighter,
  type PlayerInputSnapshot,
  type PlayerSlot,
  type RuntimeBattleBackground,
  type VoiceClipType,
} from "../types/game";
import type { Translate } from "../i18n";
import { useI18n } from "../i18n/react";
import { BattleDisplayEffectsControl } from "./BattleDisplayEffectsControl";

const STAGE_X_RANGE = 5.1;
const STAGE_Z = 0.1;
const STAGE_JUMP_SCALE = 150;
const MAX_DEBRIS_PIECES = 48;
const CAMERA_CLOSE_DISTANCE = 0.65;
const CAMERA_FAR_DISTANCE = 4.05;
const CAMERA_NEAR_Z = 5.45;
const CAMERA_FAR_Z = 7.15;
const CAMERA_NEAR_FOV = 35;
const CAMERA_FAR_FOV = 43;
const SUPER_MOMENT_SECONDS = 0.95;
const PLAYER_SLOTS: PlayerSlot[] = ["p1", "p2"];
const VOICE_VOLUME: Record<VoiceClipType, number> = {
  attack: 0.82,
  hit: 0.9,
  win: 1,
};

interface DebrisPiece {
  id: string;
  color: string;
  impulse: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
  torque: [number, number, number];
}

export function BattleStageView(props: {
  fighters: LoadedFighter[];
  selectedFighterIds: { p1: string; p2: string };
  config: BattleConfig;
  background?: RuntimeBattleBackground;
  displayEffects: BattlePostEffect[];
  loading: boolean;
  onDisplayEffectsChange: (effects: BattlePostEffect[]) => void;
  onBack: () => void;
  mode?: "local" | "online";
  localSlot?: PlayerSlot;
  networkController?: NetworkInputController;
}) {
  const { t } = useI18n();
  const pressedCodesRef = useRef(new Set<string>());
  const checksumHistoryRef = useRef(new Map<number, string>());
  const pendingRemoteChecksumsRef = useRef(new Map<number, string>());
  const fighters = useMemo(() => selectStageFighters(props.fighters, props.selectedFighterIds), [props.fighters, props.selectedFighterIds]);
  const createInitialState = useCallback(
    () => (fighters ? createBattleState(props.config, { p1: fighters.p1, p2: fighters.p2 }) : undefined),
    [fighters, props.config],
  );
  const [battleState, setBattleState] = useState<BattleState | undefined>(() => createInitialState());
  const [onlineStatus, setOnlineStatus] = useState<string | undefined>();
  const [haltedMessage, setHaltedMessage] = useState<string | undefined>();
  const battleStateRef = useRef<BattleState | undefined>(battleState);
  const watchedHealth = battleState?.fighters[props.localSlot ?? "p1"].health ?? 100;
  const showLowHealth = Boolean(battleState && battleState.status === "running" && watchedHealth > 0 && watchedHealth <= 30);
  const stageEffectClasses = useMemo(() => props.displayEffects.map((effect) => `stage-effect-${effect}`).join(" "), [props.displayEffects]);
  useStageBattleAudio(battleState, fighters);

  const resetSyncState = useCallback(() => {
    checksumHistoryRef.current.clear();
    pendingRemoteChecksumsRef.current.clear();
    props.networkController?.resetSync();
    setOnlineStatus(undefined);
    setHaltedMessage(undefined);
  }, [props.networkController]);

  useEffect(() => {
    const next = createInitialState();
    battleStateRef.current = next;
    setBattleState(next);
    resetSyncState();
    pressedCodesRef.current.clear();
  }, [createInitialState, resetSyncState]);

  useEffect(() => {
    battleStateRef.current = battleState;
  }, [battleState]);

  useEffect(
    () => () => {
      props.networkController?.destroy();
    },
    [props.networkController],
  );

  const restartBattle = useCallback((notifyPeer: boolean) => {
    const current = battleStateRef.current;
    const next = current ? restartMatch(current) : createInitialState();
    battleStateRef.current = next;
    setBattleState(next);
    pressedCodesRef.current.clear();
    resetSyncState();
    if (notifyPeer && next) {
      props.networkController?.requestRestart(next.frame);
    }
  }, [createInitialState, props.networkController, resetSyncState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.code === "Enter" && battleStateRef.current?.status === "matchOver") {
        event.preventDefault();
        restartBattle(props.mode === "online");
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        pressedCodesRef.current.clear();
        props.networkController?.sendExit(t("battle.opponentMenu"));
        props.onBack();
        return;
      }
      if (isStageControlCode(event.code)) {
        event.preventDefault();
        unlockStageAudio();
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
  }, [props.mode, props.networkController, props.onBack, restartBattle, t]);

  return (
    <section className={`battle-stage-view ${stageEffectClasses}`} onPointerDown={unlockStageAudio}>
      <div className="battle-stage-canvas" aria-label={t("battle.ariaArena")}>
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
                background={props.background}
                fighters={fighters}
                haltedMessage={haltedMessage}
                localSlot={props.localSlot ?? "p1"}
                mode={props.mode ?? "local"}
                networkController={props.networkController}
                onlineStatus={onlineStatus}
                pressedCodesRef={pressedCodesRef}
                setHaltedMessage={setHaltedMessage}
                setBattleState={setBattleState}
                setOnlineStatus={setOnlineStatus}
                superLabel={t("battle.super")}
                checksumHistoryRef={checksumHistoryRef}
                pendingRemoteChecksumsRef={pendingRemoteChecksumsRef}
                onlineCopy={{
                  connectionClosed: t("battle.connectionClosed"),
                  opponentLeft: t("battle.opponentLeft"),
                  syncError: t("battle.syncError"),
                  syncingFrame: (frame) => t("battle.syncingFrame", { frame }),
                }}
                controlsHint={formatStageControls(props.config, t)}
                onRemoteRestart={() => restartBattle(false)}
              />
            </Suspense>
          </Canvas>
        ) : (
          <div className="battle-stage-loading">{props.loading ? t("common.loading") : t("battleStage.noFighters")}</div>
        )}
      </div>
      {props.displayEffects.length > 0 && <div className="stage-effect-overlay" aria-hidden="true" />}
      <div className={`stage-low-health-vignette${showLowHealth ? " active" : ""}`} aria-hidden="true" />

      <div className="sr-only">
        <p className="eyebrow">{t("battleStage.eyebrow")}</p>
        <h1>{t("battleStage.title")}</h1>
        {battleState && <div className="sr-only" aria-live="polite">{formatBattleMessage(battleState, t, haltedMessage ?? onlineStatus)}</div>}
      </div>

      <aside className="battle-fx-panel" aria-label={t("effects.battleDisplayEffects")}>
        <strong>{t("battle.fx")}</strong>
        <BattleDisplayEffectsControl compact effects={props.displayEffects} onChange={props.onDisplayEffectsChange} />
      </aside>
    </section>
  );
}

function PlayableStage(props: {
  battleState: BattleState;
  background?: RuntimeBattleBackground;
  checksumHistoryRef: React.MutableRefObject<Map<number, string>>;
  fighters: { p1: LoadedFighter; p2: LoadedFighter };
  haltedMessage?: string;
  localSlot: PlayerSlot;
  mode: "local" | "online";
  networkController?: NetworkInputController;
  onlineStatus?: string;
  pendingRemoteChecksumsRef: React.MutableRefObject<Map<number, string>>;
  pressedCodesRef: React.MutableRefObject<Set<string>>;
  setHaltedMessage: (message: string | undefined) => void;
  setBattleState: (state: BattleState) => void;
  setOnlineStatus: (message: string | undefined) => void;
  superLabel: string;
  onlineCopy: {
    connectionClosed: string;
    opponentLeft: string;
    syncError: string;
    syncingFrame: (frame: number) => string;
  };
  controlsHint: string;
  onRemoteRestart: () => void;
}) {
  const accumulatorRef = useRef(0);
  const battleStateRef = useRef(props.battleState);
  const onlineStatusRef = useRef<string | undefined>(props.onlineStatus);
  const haltedMessageRef = useRef<string | undefined>(props.haltedMessage);
  const lastDebrisHitAtRef = useRef(-1);
  const lastSuperDebrisAtRef = useRef(-1);
  const debrisCleanupTimeoutsRef = useRef<number[]>([]);
  const [debrisPieces, setDebrisPieces] = useState<DebrisPiece[]>([]);

  useEffect(() => {
    battleStateRef.current = props.battleState;
    if (props.battleState.frame === 0) {
      accumulatorRef.current = 0;
      lastDebrisHitAtRef.current = -1;
      lastSuperDebrisAtRef.current = -1;
    }
  }, [props.battleState]);

  useEffect(() => {
    onlineStatusRef.current = props.onlineStatus;
  }, [props.onlineStatus]);

  useEffect(() => {
    haltedMessageRef.current = props.haltedMessage;
  }, [props.haltedMessage]);

  useEffect(
    () => () => {
      debrisCleanupTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      debrisCleanupTimeoutsRef.current = [];
    },
    [],
  );

  useFrame((_, deltaSeconds) => {
    processStageNetworkEvents({
      checksumHistory: props.checksumHistoryRef.current,
      haltedMessageRef,
      networkController: props.networkController,
      onHalt: props.setHaltedMessage,
      onRemoteRestart: props.onRemoteRestart,
      copy: props.onlineCopy,
      pendingRemoteChecksums: props.pendingRemoteChecksumsRef.current,
    });

    if (haltedMessageRef.current) {
      return;
    }

    accumulatorRef.current += Math.min(deltaSeconds, 0.1);
    let next = battleStateRef.current;
    let steps = 0;
    while (accumulatorRef.current >= BATTLE_TICK_SECONDS && steps < 6) {
      const inputs = readStageInputs({
        localSlot: props.localSlot,
        mode: props.mode,
        networkController: props.networkController,
        onlineCopy: props.onlineCopy,
        onOnlineStatus: (message) => {
          if (message !== onlineStatusRef.current) {
            onlineStatusRef.current = message;
            props.setOnlineStatus(message);
          }
        },
        pressedCodes: props.pressedCodesRef.current,
        state: next,
      });
      if (!inputs) {
        accumulatorRef.current = Math.min(accumulatorRef.current, BATTLE_TICK_SECONDS);
        break;
      }
      next = stepBattleFrame(next, inputs);
      afterStageSimulationFrame({
        checksumHistory: props.checksumHistoryRef.current,
        mode: props.mode,
        networkController: props.networkController,
        onHalt: props.setHaltedMessage,
        haltedMessageRef,
        syncError: props.onlineCopy.syncError,
        pendingRemoteChecksums: props.pendingRemoteChecksumsRef.current,
        state: next,
      });
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

    const superEvent = next.lastSuper;
    if (superEvent && superEvent.at !== lastSuperDebrisAtRef.current) {
      lastSuperDebrisAtRef.current = superEvent.at;
      const pieces = createSuperDebris(next);
      setDebrisPieces((current) => [...current, ...pieces].slice(-MAX_DEBRIS_PIECES));
      const timeout = window.setTimeout(() => {
        setDebrisPieces((current) => current.filter((piece) => !pieces.some((nextPiece) => nextPiece.id === piece.id)));
      }, 2000);
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

      <TheaterSet background={props.background} />
      <BattleHudSprites fighters={props.fighters} state={props.battleState} controlsHint={props.controlsHint} statusMessage={props.haltedMessage ?? props.onlineStatus} />
      <FightingStandee fighter={props.fighters.p1} runtime={props.battleState.fighters.p1} battleState={props.battleState} />
      <FightingStandee fighter={props.fighters.p2} runtime={props.battleState.fighters.p2} battleState={props.battleState} />
      <HitSpark state={props.battleState} />
      <SuperStageMoment fighters={props.fighters} state={props.battleState} superLabel={props.superLabel} />
      <CameraRig state={props.battleState} />
      <Physics gravity={[0, -8.5, 0]}>
        <StagePhysicsColliders />
        <ImpactDebris pieces={debrisPieces} />
      </Physics>
      <ContactShadows position={[0, 0.025, STAGE_Z]} opacity={0.38} blur={2.4} scale={7} far={4} resolution={1024} />
    </>
  );
}

function BattleHudSprites(props: { fighters: { p1: LoadedFighter; p2: LoadedFighter }; state: BattleState; controlsHint: string; statusMessage?: string }) {
  const { t } = useI18n();
  const p1Texture = useBattleFighterHudTexture(props.state, props.fighters.p1, "p1", t);
  const p2Texture = useBattleFighterHudTexture(props.state, props.fighters.p2, "p2", t);
  const centerTexture = useBattleCenterHudTexture(props.state, props.controlsHint, t, props.statusMessage);

  return (
    <group position={[0, 0, STAGE_Z + 1.05]}>
      <HudSprite texture={p1Texture} position={[-2.35, 3.05, 0]} scale={[2.5, 0.74, 1]} />
      <HudSprite texture={centerTexture} position={[0, 3.12, 0.02]} scale={[0.96, 0.78, 1]} />
      <HudSprite texture={p2Texture} position={[2.35, 3.05, 0]} scale={[2.5, 0.74, 1]} />
    </group>
  );
}

function HudSprite(props: { texture: THREE.Texture; position: [number, number, number]; scale: [number, number, number] }) {
  return (
    <sprite position={props.position} scale={props.scale} renderOrder={40}>
      <spriteMaterial map={props.texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}

function TheaterSet(props: { background?: RuntimeBattleBackground }) {
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
      {props.background && <CustomStageBackdrop background={props.background} />}
      <mesh position={[0, 2.4, -2.31]}>
        <planeGeometry args={[6.7, 2.75]} />
        <meshBasicMaterial color={props.background ? "#08070d" : "#2ec4b6"} transparent opacity={props.background ? 0.24 : 0.08} />
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

function CustomStageBackdrop(props: { background: RuntimeBattleBackground }) {
  const texture = useTexture(props.background.imageUrl);
  useEffect(() => {
    const image = texture.image as HTMLImageElement | undefined;
    const imageAspect = image?.width && image.height ? image.width / image.height : 1;
    const planeAspect = 6.85 / 3.2;
    texture.offset.set(0, 0);
    texture.repeat.set(1, 1);
    if (imageAspect > planeAspect) {
      texture.repeat.x = planeAspect / imageAspect;
      texture.offset.x = (1 - texture.repeat.x) / 2;
    } else {
      texture.repeat.y = imageAspect / planeAspect;
      texture.offset.y = (1 - texture.repeat.y) / 2;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
  }, [texture]);

  return (
    <mesh position={[0, 2.38, -2.33]}>
      <planeGeometry args={[6.85, 3.2]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function FightingStandee(props: { fighter: LoadedFighter; runtime: FighterRuntime; battleState: BattleState }) {
  const textures = usePoseTextures(props.fighter);
  const groupRef = useRef<THREE.Group>(null);
  const renderStateRef = useRef(createFighterRenderState(props.runtime, props.runtime.slot === "p1" ? 0 : 0.7));
  const lastPushbackHitAtRef = useRef(-1);
  const pushbackRef = useRef<{ direction: number; progress: number } | null>(null);
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
    const hit = props.battleState.lastHit;
    if (hit && hit.defender === props.runtime.slot && hit.at !== lastPushbackHitAtRef.current) {
      lastPushbackHitAtRef.current = hit.at;
      const attacker = props.battleState.fighters[hit.attacker];
      const direction = props.runtime.x >= attacker.x ? 1 : -1;
      pushbackRef.current = { direction, progress: 0 };
    }
    const frame = updateFighterRenderState(renderStateRef.current, props.runtime, props.battleState.superFreeze ? 0 : deltaSeconds, props.battleState.groundY);
    const positionX = mapBattleX(frame.current.x, props.battleState.arenaWidth);
    const positionY = Math.max(0, (props.battleState.groundY - frame.current.y) / STAGE_JUMP_SCALE);
    let pushbackX = 0;
    let pushbackRotation = 0;
    if (pushbackRef.current) {
      pushbackRef.current.progress += deltaSeconds * 6.4;
      const progress = Math.min(1, pushbackRef.current.progress);
      const recoil = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
      pushbackX = pushbackRef.current.direction * recoil * 0.18;
      pushbackRotation = -pushbackRef.current.direction * recoil * 0.08;
      if (progress >= 1) {
        pushbackRef.current = null;
      }
    }
    groupRef.current.position.set(positionX + pushbackX, positionY, STAGE_Z);
    groupRef.current.rotation.set(0, props.runtime.facing === 1 ? 0.13 : -0.13, frame.current.rotation + pushbackRotation);
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

function SuperStageMoment(props: { fighters: { p1: LoadedFighter; p2: LoadedFighter }; state: BattleState; superLabel: string }) {
  const textures = useVictoryTextures(props.fighters);
  const groupRef = useRef<THREE.Group>(null);
  const portraitRef = useRef<THREE.Group>(null);
  const slashesRef = useRef<THREE.Group>(null);
  const signRef = useRef<THREE.Group>(null);
  const floorLightRef = useRef<THREE.Mesh>(null);
  const dimMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const floorMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const spotlightRef = useRef<THREE.SpotLight>(null);
  const activeRef = useRef<{ at: number; elapsed: number; slot: PlayerSlot; x: number } | null>(null);
  const lastSuperAtRef = useRef(-1);
  const framesSinceSuper = props.state.lastSuper ? props.state.frame - props.state.lastSuper.at : Infinity;
  const renderVisible = framesSinceSuper >= 0 && framesSinceSuper <= 58;
  const activeSlot = activeRef.current?.slot ?? props.state.lastSuper?.attacker ?? "p1";
  const fighter = props.fighters[activeSlot];
  const texture = textures[activeSlot];
  const accent = getSlotAccent(activeSlot);
  const geometry = useMemo(() => getFighterBillboardGeometry(fighter, 2.15, "victory"), [fighter]);

  useFrame((_, deltaSeconds) => {
    const superEvent = props.state.lastSuper;
    if (superEvent && superEvent.at !== lastSuperAtRef.current) {
      lastSuperAtRef.current = superEvent.at;
      activeRef.current = {
        at: superEvent.at,
        elapsed: 0,
        slot: superEvent.attacker,
        x: mapBattleX(props.state.fighters[superEvent.attacker].x, props.state.arenaWidth),
      };
      if (groupRef.current) {
        groupRef.current.visible = true;
      }
    }

    const active = activeRef.current;
    if (!active) {
      if (groupRef.current) {
        groupRef.current.visible = false;
      }
      return;
    }

    active.elapsed += deltaSeconds;
    const progress = Math.min(1, active.elapsed / SUPER_MOMENT_SECONDS);
    const intro = easeOutBack(Math.min(1, progress / 0.24));
    const outro = progress > 0.72 ? Math.max(0, 1 - (progress - 0.72) / 0.28) : 1;
    const alpha = Math.min(1, intro) * outro;
    const side = active.slot === "p1" ? -1 : 1;
    const portraitX = clamp(active.x + side * 0.82, -2.65, 2.65);
    const pulse = 0.5 + Math.sin(progress * Math.PI * 8) * 0.5;

    if (dimMaterialRef.current) {
      dimMaterialRef.current.opacity = 0.5 * alpha;
    }
    if (floorMaterialRef.current) {
      floorMaterialRef.current.opacity = 0.2 * alpha + pulse * 0.12 * alpha;
    }
    if (floorLightRef.current) {
      floorLightRef.current.position.x = portraitX;
    }
    if (spotlightRef.current) {
      spotlightRef.current.position.set(portraitX - side * 0.7, 4.5, 2.6);
      spotlightRef.current.intensity = 5.6 * alpha + pulse * 1.6 * alpha;
    }
    if (portraitRef.current) {
      portraitRef.current.position.set(portraitX, 0.03 + intro * 0.18, STAGE_Z + 0.62);
      portraitRef.current.scale.setScalar((0.54 + intro * 0.5) * alpha);
      portraitRef.current.rotation.set(0, side * -0.18, side * -0.07 * (1 - intro));
    }
    if (slashesRef.current) {
      slashesRef.current.position.set(side * (-2.8 + progress * 4.4), 1.48 + Math.sin(progress * Math.PI) * 0.22, STAGE_Z + 0.86);
      slashesRef.current.rotation.set(0, 0, side * -0.2);
      slashesRef.current.scale.set(0.9 + progress * 0.5, 1, 1);
      slashesRef.current.children.forEach((child, index) => {
        const material = child instanceof THREE.Mesh ? child.material : undefined;
        if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = alpha * (0.78 - index * 0.08);
        }
      });
    }
    if (signRef.current) {
      signRef.current.position.set(clamp(portraitX - side * 1.12, -2.4, 2.4), 2.65 + Math.sin(progress * Math.PI) * 0.08, STAGE_Z + 0.95);
      signRef.current.rotation.set(0, side * -0.12, side * 0.05);
      signRef.current.scale.setScalar((0.74 + intro * 0.28) * alpha);
    }

    if (progress >= 1) {
      activeRef.current = null;
      if (groupRef.current) {
        groupRef.current.visible = false;
      }
    }
  });

  return (
    <group ref={groupRef} visible={renderVisible}>
      <mesh position={[0, 2.2, STAGE_Z + 0.86]} renderOrder={18}>
        <planeGeometry args={[9.4, 5.2]} />
        <meshBasicMaterial ref={dimMaterialRef} color="#04030a" transparent opacity={0} depthWrite={false} />
      </mesh>
      <spotLight ref={spotlightRef} color={accent} intensity={0} position={[0, 4.4, 2.6]} angle={0.42} penumbra={0.78} distance={8} />
      <mesh ref={floorLightRef} rotation={[-Math.PI / 2, 0, 0]} position={[mapBattleX(props.state.fighters[activeSlot].x, props.state.arenaWidth), 0.032, STAGE_Z + 0.08]} renderOrder={19}>
        <circleGeometry args={[1.35, 48]} />
        <meshBasicMaterial ref={floorMaterialRef} color={accent} transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={slashesRef}>
        {Array.from({ length: 5 }, (_, index) => (
          <mesh key={index} position={[0, (index - 2) * 0.18, index * 0.012]} rotation={[0, 0, -0.54]} renderOrder={21}>
            <planeGeometry args={[2.2 - index * 0.16, 0.055 + (index % 2) * 0.035]} />
            <meshBasicMaterial color={index % 2 === 0 ? accent : "#f8f4df"} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
      <group ref={signRef}>
        <mesh position={[0, 0, -0.02]} renderOrder={25}>
          <boxGeometry args={[1.78, 0.78, 0.06]} />
          <meshStandardMaterial color="#090712" emissive={accent} emissiveIntensity={0.3} roughness={0.72} />
        </mesh>
        <mesh position={[0, 0, 0.03]} renderOrder={26}>
          <planeGeometry args={[1.68, 0.68]} />
          <meshBasicMaterial color="#08070d" transparent opacity={0.78} depthWrite={false} />
        </mesh>
        <Text
          anchorX="center"
          anchorY="middle"
          color="#f8f4df"
          fontSize={0.34}
          fontWeight={900}
          letterSpacing={0}
          outlineColor="#090712"
          outlineWidth={0.025}
          position={[0, 0.12, 0.065]}
          renderOrder={27}
        >
          {props.superLabel}
        </Text>
        <Text
          anchorX="center"
          anchorY="middle"
          color="#f7b267"
          fontSize={0.1}
          fontWeight={900}
          letterSpacing={0}
          maxWidth={1.44}
          outlineColor="#090712"
          outlineWidth={0.014}
          position={[0, -0.18, 0.068]}
          renderOrder={27}
        >
          {props.state.fighters[activeSlot].name.toUpperCase()}
        </Text>
      </group>
      <group ref={portraitRef}>
        <mesh position={[0.12, geometry.centerY + 0.08, -0.08]} scale={[1.14, 1.14, 1]} renderOrder={22}>
          <planeGeometry args={[geometry.width, geometry.height]} />
          <meshBasicMaterial map={texture} color={accent} transparent opacity={0.3} alphaTest={0.08} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh castShadow position={[0.05, geometry.centerY + 0.04, -0.04]} scale={[1.06, 1.06, 1]} renderOrder={23}>
          <planeGeometry args={[geometry.width, geometry.height]} />
          <meshBasicMaterial map={texture} color="#07050b" transparent opacity={0.5} alphaTest={0.08} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh castShadow position={[0, geometry.centerY, 0]} renderOrder={24}>
          <planeGeometry args={[geometry.width, geometry.height]} />
          <meshBasicMaterial map={texture} color="#ffffff" transparent alphaTest={0.08} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh castShadow position={[0, 0.12, -0.05]} renderOrder={22}>
          <boxGeometry args={[geometry.width * 0.46, 0.14, 0.32]} />
          <meshStandardMaterial color="#8a603a" roughness={0.82} />
        </mesh>
      </group>
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
  const cameraBaseRef = useRef({ x: 0, y: 2.35, z: 6.4, fov: 39, lookX: 0, lookY: 1.05 });
  const shakeRef = useRef(0);
  const lungeRef = useRef(0);
  const rollRef = useRef(0);
  const lastHitAtRef = useRef(-1);
  const lastSuperAtRef = useRef(-1);

  useFrame((_, deltaSeconds) => {
    if (props.state.lastHit && props.state.lastHit.at !== lastHitAtRef.current) {
      lastHitAtRef.current = props.state.lastHit.at;
      shakeRef.current = 0.14;
    }
    if (props.state.lastSuper && props.state.lastSuper.at !== lastSuperAtRef.current) {
      lastSuperAtRef.current = props.state.lastSuper.at;
      shakeRef.current = 0.36;
      lungeRef.current = 0.48;
    }
    shakeRef.current = Math.max(0, shakeRef.current + addSmoothExp(shakeRef.current, 0, 8, deltaSeconds));
    lungeRef.current = Math.max(0, lungeRef.current + addSmoothExp(lungeRef.current, props.state.superFreeze ? 0.2 : 0, 7, deltaSeconds));
    const p1X = mapBattleX(props.state.fighters.p1.x, props.state.arenaWidth);
    const p2X = mapBattleX(props.state.fighters.p2.x, props.state.arenaWidth);
    const midpointX = (p1X + p2X) / 2;
    const distance = Math.abs(p2X - p1X);
    const spread = clamp((distance - CAMERA_CLOSE_DISTANCE) / (CAMERA_FAR_DISTANCE - CAMERA_CLOSE_DISTANCE), 0, 1);
    const targetX = clamp(midpointX * 0.42, -0.72, 0.72);
    const targetLookX = clamp(midpointX * 0.32, -0.58, 0.58);
    const targetY = 2.22 + spread * 0.34;
    const targetLookY = 1.08 + spread * 0.08;
    const targetZ = CAMERA_NEAR_Z + (CAMERA_FAR_Z - CAMERA_NEAR_Z) * spread;
    const targetFov = CAMERA_NEAR_FOV + (CAMERA_FAR_FOV - CAMERA_NEAR_FOV) * spread;
    const cameraBase = cameraBaseRef.current;
    cameraBase.x += addSmoothExp(cameraBase.x, targetX, 3.6, deltaSeconds);
    cameraBase.y += addSmoothExp(cameraBase.y, targetY, 3.6, deltaSeconds);
    cameraBase.z += addSmoothExp(cameraBase.z, targetZ, 3.6, deltaSeconds);
    cameraBase.lookX += addSmoothExp(cameraBase.lookX, targetLookX, 4.2, deltaSeconds);
    cameraBase.lookY += addSmoothExp(cameraBase.lookY, targetLookY, 4.2, deltaSeconds);
    cameraBase.fov += addSmoothExp(cameraBase.fov, targetFov, 4.8, deltaSeconds);
    const shake = shakeRef.current > 0 ? Math.sin(props.state.frame * 1.7) * shakeRef.current : 0;
    const superLean = props.state.lastSuper && props.state.frame - props.state.lastSuper.at < 50 ? (props.state.lastSuper.attacker === "p1" ? -0.08 : 0.08) : 0;
    rollRef.current += addSmoothExp(rollRef.current, shake * 0.04 + superLean, 14, deltaSeconds);
    camera.position.set(cameraBase.x + shake, cameraBase.y + shake * 0.3, cameraBase.z - (props.state.superFreeze ? 0.35 : 0) - lungeRef.current);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = cameraBase.fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(cameraBase.lookX, cameraBase.lookY, 0);
    camera.rotation.z += rollRef.current;
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

function useVictoryTextures(fighters: { p1: LoadedFighter; p2: LoadedFighter }): Record<PlayerSlot, THREE.Texture> {
  const textureList = useTexture([fighters.p1.frameUrls.victory, fighters.p2.frameUrls.victory]) as THREE.Texture[];
  return useMemo(() => {
    textureList.forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    });
    return { p1: textureList[0], p2: textureList[1] };
  }, [textureList]);
}

function useBattleFighterHudTexture(state: BattleState, fighter: LoadedFighter, slot: PlayerSlot, t: Translate) {
  const texture = useCanvasTexture(640, 190);
  const runtime = state.fighters[slot];
  const health = Math.max(0, Math.min(1, runtime.health / 100));
  const superRatio = SUPER_HITS_REQUIRED > 0 ? Math.max(0, Math.min(1, runtime.superMeter / SUPER_HITS_REQUIRED)) : 1;
  const superReady = runtime.superMeter >= SUPER_HITS_REQUIRED;

  useEffect(() => {
    drawFighterHud(texture, {
      health,
      name: fighter.name,
      roundsWon: runtime.roundsWon,
      slot,
      superRatio,
      superReady,
      maxLabel: t("battle.max"),
    });
  }, [fighter.name, health, runtime.roundsWon, slot, superRatio, superReady, t, texture]);

  return texture;
}

function useBattleCenterHudTexture(state: BattleState, controlsHint: string, t: Translate, statusMessage?: string) {
  const texture = useCanvasTexture(280, 220);
  const message = formatBattleMessage(state, t, statusMessage);
  const hint = state.status === "matchOver" ? t("battle.restartHint") : controlsHint;
  const seconds = Math.ceil(state.timer);

  useEffect(() => {
    drawCenterHud(texture, { hint, message, seconds });
  }, [hint, message, seconds, texture]);

  return texture;
}

function useCanvasTexture(width: number, height: number) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const next = new THREE.CanvasTexture(canvas);
    next.colorSpace = THREE.SRGBColorSpace;
    next.minFilter = THREE.LinearFilter;
    next.magFilter = THREE.LinearFilter;
    return next;
  }, [height, width]);

  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function useStageBattleAudio(state: BattleState | undefined, fighters: { p1: LoadedFighter; p2: LoadedFighter } | undefined) {
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

function selectStageFighters(fighters: LoadedFighter[], selected: { p1: string; p2: string }) {
  const p1 = fighters.find((fighter) => fighter.id === selected.p1) ?? fighters[0];
  const p2 = fighters.find((fighter) => fighter.id === selected.p2 && fighter.id !== p1?.id) ?? fighters.find((fighter) => fighter.id !== p1?.id) ?? p1;
  return p1 && p2 ? { p1, p2 } : undefined;
}

function readStageInputs(input: {
  localSlot: PlayerSlot;
  mode: "local" | "online";
  networkController?: NetworkInputController;
  onlineCopy: {
    syncingFrame: (frame: number) => string;
  };
  onOnlineStatus: (message: string | undefined) => void;
  pressedCodes: Set<string>;
  state: BattleState;
}): PlayerInputSnapshot | undefined {
  if (input.mode === "online" && input.networkController) {
    const localInput = readOnlineSlotActions(input.pressedCodes, input.localSlot);
    input.networkController.queueLocalInput(input.state.frame, localInput);
    const inputs = input.networkController.getInputsForFrame(input.state.frame);
    if (!inputs) {
      const missingFrame = input.networkController.getMissingFrame(input.state.frame) ?? input.state.frame;
      input.onOnlineStatus(input.onlineCopy.syncingFrame(missingFrame));
      return undefined;
    }
    input.onOnlineStatus(undefined);
    return inputs;
  }

  const state = input.state;
  const controls = state.config.playerControls;
  return {
    p1: controls?.p1 === "cpu" ? createCpuActions(state, "p1") : readSlotActions(input.pressedCodes, "p1"),
    p2: controls?.p2 === "cpu" ? createCpuActions(state, "p2") : readSlotActions(input.pressedCodes, "p2"),
  };
}

function readSlotActions(pressedCodes: Set<string>, slot: PlayerSlot): ActionSnapshot {
  const actions = createEmptyActions();
  Object.entries(KEYBOARD_BINDINGS[slot]).forEach(([code, action]) => {
    actions[action] ||= pressedCodes.has(code);
  });
  return actions;
}

function readOnlineSlotActions(pressedCodes: Set<string>, slot: PlayerSlot): ActionSnapshot {
  const actions = readSlotActions(pressedCodes, slot);
  if (slot === "p2") {
    Object.entries(KEYBOARD_BINDINGS.p1).forEach(([code, action]) => {
      actions[action] ||= pressedCodes.has(code);
    });
  }
  return actions;
}

function isStageControlCode(code: string) {
  return PLAYER_SLOTS.some((slot) => code in KEYBOARD_BINDINGS[slot]);
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function formatBattleMessage(state: BattleState, t: Translate, override?: string) {
  if (override) {
    return override;
  }
  const message = state.message;
  if (!message) {
    return state.status === "running" ? t("battle.fight") : "";
  }
  return getBattleMessageText(message, state, t);
}

function processStageNetworkEvents(input: {
  checksumHistory: Map<number, string>;
  copy: {
    connectionClosed: string;
    opponentLeft: string;
    syncError: string;
  };
  haltedMessageRef: React.MutableRefObject<string | undefined>;
  networkController?: NetworkInputController;
  onHalt: (message: string | undefined) => void;
  onRemoteRestart: () => void;
  pendingRemoteChecksums: Map<number, string>;
}) {
  if (!input.networkController) {
    return;
  }
  input.networkController.pollEvents().forEach((event) => {
    if (event.type === "checksum") {
      compareRemoteChecksum({
        checksum: event.checksum,
        checksumHistory: input.checksumHistory,
        frame: event.frame,
        haltedMessageRef: input.haltedMessageRef,
        networkController: input.networkController,
        onHalt: input.onHalt,
        pendingRemoteChecksums: input.pendingRemoteChecksums,
        syncError: input.copy.syncError,
      });
    } else if (event.type === "restart") {
      input.onRemoteRestart();
    } else if (event.type === "exit") {
      setStageHalt(input.haltedMessageRef, input.onHalt, event.reason || input.copy.opponentLeft);
    } else if (event.type === "error") {
      setStageHalt(input.haltedMessageRef, input.onHalt, event.message);
    } else if (event.type === "closed") {
      setStageHalt(input.haltedMessageRef, input.onHalt, input.copy.connectionClosed);
    }
  });
}

function afterStageSimulationFrame(input: {
  checksumHistory: Map<number, string>;
  mode: "local" | "online";
  networkController?: NetworkInputController;
  onHalt: (message: string | undefined) => void;
  haltedMessageRef: React.MutableRefObject<string | undefined>;
  pendingRemoteChecksums: Map<number, string>;
  state: BattleState;
  syncError: string;
}) {
  if (input.mode !== "online" || !input.networkController || input.state.frame % NETPLAY_CHECKSUM_INTERVAL !== 0) {
    return;
  }
  const checksum = getBattleChecksum(input.state);
  input.checksumHistory.set(input.state.frame, checksum);
  input.networkController.sendChecksum(input.state.frame, checksum);
  const pending = input.pendingRemoteChecksums.get(input.state.frame);
  if (pending) {
    input.pendingRemoteChecksums.delete(input.state.frame);
    compareRemoteChecksum({
      checksum: pending,
      checksumHistory: input.checksumHistory,
      frame: input.state.frame,
      haltedMessageRef: input.haltedMessageRef,
      networkController: input.networkController,
      onHalt: input.onHalt,
      pendingRemoteChecksums: input.pendingRemoteChecksums,
      syncError: input.syncError,
    });
  }
}

function compareRemoteChecksum(input: {
  checksum: string;
  checksumHistory: Map<number, string>;
  frame: number;
  haltedMessageRef: React.MutableRefObject<string | undefined>;
  networkController?: NetworkInputController;
  onHalt: (message: string | undefined) => void;
  pendingRemoteChecksums: Map<number, string>;
  syncError: string;
}) {
  const localChecksum = input.checksumHistory.get(input.frame);
  if (!localChecksum) {
    input.pendingRemoteChecksums.set(input.frame, input.checksum);
    return;
  }
  if (localChecksum !== input.checksum) {
    const message = input.syncError;
    setStageHalt(input.haltedMessageRef, input.onHalt, message);
    input.networkController?.sendError(message);
  }
}

function setStageHalt(
  haltedMessageRef: React.MutableRefObject<string | undefined>,
  onHalt: (message: string | undefined) => void,
  message: string,
) {
  haltedMessageRef.current = message;
  onHalt(message);
}

function formatStageControls(config: BattleConfig, t: Translate) {
  const controls = config.playerControls;
  if (controls?.p1 === "cpu" && controls.p2 === "cpu") {
    return t("battleStage.controlsCpu");
  }
  if (controls?.p1 === "cpu" && controls.p2 !== "cpu") {
    return t("battleStage.controlsP2");
  }
  if (controls?.p2 === "cpu") {
    return t("battleStage.controlsP1");
  }
  return t("battleStage.controlsP1P2");
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

function getFighterBillboardGeometry(fighter: LoadedFighter, height: number, pose: LoadedFighter["frames"]["idle"]["pose"]) {
  const frame = fighter.frames[pose];
  const width = height * Math.max(0.82, Math.min(1.16, frame.width / frame.height));
  const anchorY = Number.isFinite(frame.anchor.y) ? frame.anchor.y : 0.9;
  return { width, height, centerY: 0.08 + height * (anchorY - 0.5) };
}

function getSlotAccent(slot: PlayerSlot) {
  return slot === "p1" ? "#f45b69" : "#2ec4b6";
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

function createSuperDebris(state: BattleState): DebrisPiece[] {
  const superEvent = state.lastSuper;
  if (!superEvent) {
    return [];
  }
  const attacker = state.fighters[superEvent.attacker];
  const side = superEvent.attacker === "p1" ? -1 : 1;
  const origin: [number, number, number] = [mapBattleX(attacker.x, state.arenaWidth), 0.62, STAGE_Z + 0.22];
  return Array.from({ length: 12 }, (_, index) => {
    const seed = superEvent.at * 47 + index * 23;
    const angle = -0.72 + (index / 11) * 1.44;
    const outward = 0.54 + seededUnit(seed) * 0.64;
    const lift = 0.72 + seededUnit(seed + 1) * 0.9;
    const depth = (seededUnit(seed + 2) - 0.5) * 0.62;
    return {
      id: `super-${superEvent.at}-${index}`,
      color: index % 3 === 0 ? getSlotAccent(superEvent.attacker) : index % 3 === 1 ? "#f8f4df" : "#f7b267",
      impulse: [side * Math.cos(angle) * outward, lift, depth],
      position: [origin[0] + side * seededUnit(seed + 3) * 0.42, origin[1] + seededUnit(seed + 4) * 0.24, origin[2] + depth * 0.2],
      rotation: [seededUnit(seed + 5) * Math.PI, seededUnit(seed + 6) * Math.PI, seededUnit(seed + 7) * Math.PI],
      size: [0.055 + seededUnit(seed + 8) * 0.1, 0.026 + seededUnit(seed + 9) * 0.05, 0.07 + seededUnit(seed + 10) * 0.12],
      torque: [(seededUnit(seed + 11) - 0.5) * 0.44, (seededUnit(seed + 12) - 0.5) * 0.5, side * (0.34 + seededUnit(seed + 13) * 0.58)],
    };
  });
}

function drawFighterHud(
  texture: THREE.CanvasTexture,
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
  const canvas = texture.image as HTMLCanvasElement;
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
  texture.needsUpdate = true;
}

function drawCenterHud(texture: THREE.CanvasTexture, options: { hint: string; message: string; seconds: number }) {
  const canvas = texture.image as HTMLCanvasElement;
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
  texture.needsUpdate = true;
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

function playFighterVoice(fighter: LoadedFighter, clip: VoiceClipType) {
  const url = fighter.voiceUrls[clip];
  if (!url) {
    return;
  }
  const audio = new Audio(url);
  audio.volume = VOICE_VOLUME[clip];
  void audio.play().catch(() => undefined);
}

function unlockStageAudio() {
  void getStageAudioContext()?.resume();
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

let stageAudioContext: AudioContext | undefined;

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

function addSmoothExp(current: number, target: number, speed: number, deltaSeconds: number) {
  return (target - current) * (1 - Math.exp(-speed * deltaSeconds));
}

function easeOutBack(value: number) {
  const overshoot = 1.48;
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
}

function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
