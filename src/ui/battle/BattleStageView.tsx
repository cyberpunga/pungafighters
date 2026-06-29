import { ContactShadows, Text, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { NetworkInputController } from "../../game/network/networkInputController";
import {
  BATTLE_TICK_SECONDS,
  createBattleState,
  getBattleDebugBoxes,
  restartMatch,
  stepBattleFrame,
  type BattleState,
  type BattleDebugBox,
  type FighterRuntime,
} from "../../game/simulation/battle";
import { createFighterRenderState, updateFighterRenderState } from "../../game/render/fighterAnimation";
import {
  FIGHTER_POSES,
  type BattleConfig,
  type BattlePostEffectConfigMap,
  type BattlePostEffectSettings,
  type LoadedFighter,
  type PlayerSlot,
  type RuntimeBattleBackground,
} from "../../types/game";
import { useI18n } from "../../i18n/react";
import { BattlePostProcessing } from "../BattlePostProcessing";
import { BattleHudLayer } from "./BattleHudLayer";
import {
  CAMERA_CLOSE_DISTANCE,
  CAMERA_FAR_DISTANCE,
  CAMERA_FAR_FOV,
  CAMERA_FAR_Z,
  CAMERA_NEAR_FOV,
  CAMERA_NEAR_Z,
  STAGE_JUMP_SCALE,
  STAGE_X_RANGE,
  STAGE_Z,
  SUPER_MOMENT_SECONDS,
} from "./constants";
import { createHitSplash, type HitSplashBurst } from "./hitSplash";
import { addSmoothExp, clamp, easeOutBack, getFighterBillboardGeometry, getSlotAccent, mapBattleX, mapBattleZ } from "./math";
import { unlockStageAudio, useStageBattleAudio } from "./stageAudio";
import { formatBattleMessage, formatStageControls, isEditableTarget, isStageControlCode, readStageInputs, selectStageFighters } from "./stageInput";
import { afterStageSimulationFrame, processStageNetworkEvents } from "./stageNetwork";
import { StagePropsLayer } from "./StagePropsLayer";

export function BattleStageView(props: {
  fighters: LoadedFighter[];
  selectedFighterIds: { p1: string; p2: string };
  config: BattleConfig;
  background?: RuntimeBattleBackground;
  collisionDebug?: boolean;
  displayEffectSettings: BattlePostEffectSettings;
  loading: boolean;
  onBack: () => void;
  mode?: "local" | "online";
  localSlot?: PlayerSlot;
  networkController?: NetworkInputController;
}) {
  const { t } = useI18n();
  const pressedCodesRef = useRef(new Set<string>());
  const checksumHistoryRef = useRef(new Map<number, string>());
  const pendingRemoteChecksumsRef = useRef(new Map<number, string>());
  const selectedP1Id = props.selectedFighterIds.p1;
  const selectedP2Id = props.selectedFighterIds.p2;
  const fighters = useMemo(
    () => selectStageFighters(props.fighters, props.selectedFighterIds),
    [props.fighters, selectedP1Id, selectedP2Id],
  );
  const createInitialState = useCallback(
    () => (fighters ? createBattleState(props.config, { p1: fighters.p1, p2: fighters.p2 }) : undefined),
    [fighters, props.config],
  );
  const [battleState, setBattleState] = useState<BattleState | undefined>(() => createInitialState());
  const [onlineStatus, setOnlineStatus] = useState<string | undefined>();
  const [haltedMessage, setHaltedMessage] = useState<string | undefined>();
  const battleStateRef = useRef<BattleState | undefined>(battleState);
  const controlsHint = useMemo(() => formatStageControls(props.config, t), [props.config, t]);
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
    <section className="battle-stage-view" onPointerDown={unlockStageAudio}>
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
                collisionDebug={Boolean(props.collisionDebug)}
                displayEffectSettings={props.displayEffectSettings}
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
                onRemoteRestart={() => restartBattle(false)}
              />
            </Suspense>
          </Canvas>
        ) : (
          <div className="battle-stage-loading">{props.loading ? t("common.loading") : t("battleStage.noFighters")}</div>
        )}
      </div>
      {fighters && battleState && <BattleHudLayer fighters={fighters} state={battleState} controlsHint={controlsHint} statusMessage={haltedMessage ?? onlineStatus} />}

      <div className="sr-only">
        <p className="eyebrow">{t("battleStage.eyebrow")}</p>
        <h1>{t("battleStage.title")}</h1>
        {battleState && <div className="sr-only" aria-live="polite">{formatBattleMessage(battleState, t, haltedMessage ?? onlineStatus)}</div>}
      </div>
    </section>
  );
}

function PlayableStage(props: {
  battleState: BattleState;
  background?: RuntimeBattleBackground;
  checksumHistoryRef: React.MutableRefObject<Map<number, string>>;
  collisionDebug: boolean;
  displayEffectSettings: BattlePostEffectSettings;
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
  onRemoteRestart: () => void;
}) {
  const accumulatorRef = useRef(0);
  const battleStateRef = useRef(props.battleState);
  const onlineStatusRef = useRef<string | undefined>(props.onlineStatus);
  const haltedMessageRef = useRef<string | undefined>(props.haltedMessage);
  const lastSplashHitAtRef = useRef(-1);
  const splashCleanupTimeoutsRef = useRef<number[]>([]);
  const [hitSplashes, setHitSplashes] = useState<HitSplashBurst[]>([]);

  useEffect(() => {
    battleStateRef.current = props.battleState;
    if (props.battleState.frame === 0) {
      accumulatorRef.current = 0;
      lastSplashHitAtRef.current = -1;
      setHitSplashes([]);
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
      splashCleanupTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      splashCleanupTimeoutsRef.current = [];
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
    if (hit && hit.at !== lastSplashHitAtRef.current) {
      lastSplashHitAtRef.current = hit.at;
      const splash = createHitSplash(next);
      if (!splash) {
        return;
      }
      setHitSplashes((current) => [...current, splash].slice(-5));
      const timeout = window.setTimeout(() => {
        setHitSplashes((current) => current.filter((currentSplash) => currentSplash.id !== splash.id));
      }, 1250);
      splashCleanupTimeoutsRef.current.push(timeout);
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
      <StagePropsLayer state={props.battleState} />
      <FightingStandee fighter={props.fighters.p1} runtime={props.battleState.fighters.p1} battleState={props.battleState} />
      <FightingStandee fighter={props.fighters.p2} runtime={props.battleState.fighters.p2} battleState={props.battleState} />
      {props.collisionDebug && <CollisionDebugOverlay state={props.battleState} />}
      <HitSplashLayer splashes={hitSplashes} />
      <SuperStageMoment fighters={props.fighters} state={props.battleState} superLabel={props.superLabel} />
      <CameraRig lensSettings={props.displayEffectSettings.effects.lens} state={props.battleState} />
      <BattlePostProcessing state={props.battleState} displayEffectSettings={props.displayEffectSettings} localSlot={props.localSlot} />
      <ContactShadows position={[0, 0.025, STAGE_Z]} opacity={0.38} blur={2.4} scale={7} far={4} resolution={1024} />
    </>
  );
}

function CollisionDebugOverlay(props: { state: BattleState }) {
  const boxes = getBattleDebugBoxes(props.state);
  return (
    <group renderOrder={40}>
      {boxes.map((box, index) => (
        <CollisionDebugPlane key={`${box.slot}-${box.kind}-${index}`} box={box} arenaWidth={props.state.arenaWidth} groundY={props.state.groundY} />
      ))}
    </group>
  );
}

function CollisionDebugPlane(props: { box: BattleDebugBox; arenaWidth: number; groundY: number }) {
  const width = ((props.box.right - props.box.left) / props.arenaWidth) * STAGE_X_RANGE;
  const height = (props.box.bottom - props.box.top) / STAGE_JUMP_SCALE;
  const centerX = mapBattleX((props.box.left + props.box.right) / 2, props.arenaWidth);
  const centerY = Math.max(0, (props.groundY - (props.box.top + props.box.bottom) / 2) / STAGE_JUMP_SCALE);
  const color = props.box.kind === "attack" ? (props.box.slot === "p1" ? "#ffcf56" : "#9effff") : props.box.slot === "p1" ? "#f45b69" : "#2ec4b6";
  const opacity = props.box.kind === "attack" ? 0.34 : 0.18;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return (
    <mesh position={[centerX, centerY, STAGE_Z + (props.box.kind === "attack" ? 0.09 : 0.075)]} renderOrder={40}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function TheaterSet(props: { background?: RuntimeBattleBackground }) {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[10.8, 5.4]} />
        <meshStandardMaterial color="#272132" roughness={0.88} metalness={0.03} />
      </mesh>
      <gridHelper args={[10.4, 24, "#f7b267", "#464153"]} position={[0, 0.018, 0]} />
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
    </group>
  );
}

const BACKDROP_WIDTH = 6.85;
const BACKDROP_HEIGHT = 3.2;
const BACKDROP_Y = 2.38;
const BACKDROP_BASE_Z = -2.72;
const BACKDROP_DEPTH_RANGE = 0.86;

function CustomStageBackdrop(props: { background: RuntimeBattleBackground }) {
  const layers = props.background.layers ?? [];
  if (!layers.length) {
    return <StageBackdropPlane imageUrl={props.background.imageUrl} opacity={1} z={-2.33} />;
  }

  return (
    <group>
      {layers.map((layer) => (
        <StageBackdropPlane
          key={layer.id}
          imageUrl={layer.imageUrl}
          opacity={layer.opacity}
          scale={layer.scale}
          x={layer.offsetX}
          y={BACKDROP_Y + layer.offsetY}
          z={BACKDROP_BASE_Z + clamp(layer.depth, 0, 1) * BACKDROP_DEPTH_RANGE}
          transparent
        />
      ))}
    </group>
  );
}

function StageBackdropPlane(props: {
  imageUrl: string;
  opacity: number;
  scale?: number;
  x?: number;
  y?: number;
  z: number;
  transparent?: boolean;
}) {
  const texture = useTexture(props.imageUrl);
  useEffect(() => {
    const image = texture.image as HTMLImageElement | undefined;
    const imageAspect = image?.width && image.height ? image.width / image.height : 1;
    const planeAspect = BACKDROP_WIDTH / BACKDROP_HEIGHT;
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
    <mesh position={[props.x ?? 0, props.y ?? BACKDROP_Y, props.z]}>
      <planeGeometry args={[BACKDROP_WIDTH * (props.scale ?? 1), BACKDROP_HEIGHT * (props.scale ?? 1)]} />
      <meshBasicMaterial
        map={texture}
        toneMapped={false}
        transparent={props.transparent || props.opacity < 1}
        opacity={props.opacity}
        alphaTest={props.transparent ? 0.015 : 0}
        depthWrite={false}
      />
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
    const positionZ = mapBattleZ(props.runtime.z, props.battleState.arenaDepth);
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
    groupRef.current.position.set(positionX + pushbackX, positionY, positionZ);
    groupRef.current.rotation.set(0, props.runtime.facing === 1 ? 0.13 : -0.13, frame.current.rotation + pushbackRotation);
    groupRef.current.scale.set(Math.abs(frame.current.scaleX), frame.current.scaleY, 1);
  });

  const texture = textures[props.runtime.pose];
  const tint = props.runtime.hitStun > 0 ? "#f8f4df" : props.runtime.blocking ? "#d9d2b6" : props.runtime.attack?.kind === "special" ? "#f7b267" : "#ffffff";
  const alpha = props.runtime.blocking ? 0.78 : 1;
  const facingScale = props.runtime.facing === 1 ? 1 : -1;

  return (
    <group ref={groupRef}>
      <mesh castShadow position={[0, geometry.centerY, -0.025]} scale={[facingScale, 1, 1]}>
        <planeGeometry args={[geometry.width, geometry.height]} />
        <meshStandardMaterial map={texture} color={tint} transparent opacity={alpha} alphaTest={0.08} roughness={0.72} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function HitSplashLayer(props: { splashes: HitSplashBurst[] }) {
  return (
    <>
      {props.splashes.map((splash) => (
        <HitSplash key={splash.id} splash={splash} />
      ))}
    </>
  );
}

function HitSplash(props: { splash: HitSplashBurst }) {
  const groupRef = useRef<THREE.Group>(null);
  const dropletRefs = useRef<THREE.Mesh[]>([]);
  const elapsedRef = useRef(0);
  const textures = useInkSplashTextures();

  useEffect(() => {
    elapsedRef.current = 0;
  }, [props.splash.id]);

  useFrame((_, deltaSeconds) => {
    elapsedRef.current += deltaSeconds;
    const elapsed = elapsedRef.current;
    const baseFade = clamp(1 - elapsed / 1.05, 0, 1);
    if (groupRef.current) {
      groupRef.current.visible = baseFade > 0;
    }

    props.splash.droplets.forEach((droplet, index) => {
      const mesh = dropletRefs.current[index];
      if (!mesh) {
        return;
      }
      const localTime = Math.max(0, elapsed - droplet.delay);
      const progress = clamp(localTime / 0.78, 0, 1);
      const gravity = 2.6 * localTime * localTime;
      const drag = 1 - progress * 0.28;
      mesh.visible = elapsed >= droplet.delay && progress < 1;
      mesh.position.set(
        props.splash.origin[0] + droplet.velocity[0] * localTime * drag,
        props.splash.origin[1] + droplet.velocity[1] * localTime - gravity,
        props.splash.origin[2] + droplet.velocity[2] * localTime,
      );
      mesh.rotation.set(0, 0, droplet.angle);
      const tail = 1 + droplet.stretch * (1 - progress);
      const width = droplet.radius * (0.72 + progress * 0.5);
      mesh.scale.set(width * tail, droplet.radius * (1 - progress * 0.35), 1);
      const material = mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = 0.8 * (1 - progress);
      }
    });
  });

  return (
    <group ref={groupRef}>
      {props.splash.droplets.map((droplet, index) => (
        <mesh
          key={`drop-${index}`}
          ref={(mesh) => {
            if (mesh) {
              dropletRefs.current[index] = mesh;
            }
          }}
          renderOrder={30 + index}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            alphaTest={0.04}
            color={droplet.color}
            depthWrite={false}
            map={index % 4 === 0 ? textures.fleck : textures.streak}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

function useInkSplashTextures() {
  const textures = useMemo(
    () => ({
      fleck: createInkTexture("fleck"),
      streak: createInkTexture("streak"),
    }),
    [],
  );

  useEffect(
    () => () => {
      textures.fleck.dispose();
      textures.streak.dispose();
    },
    [textures],
  );

  return textures;
}

function createInkTexture(kind: "fleck" | "streak") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.Texture();
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.translate(64, 64);
  if (kind === "streak") {
    drawInkStreak(context);
  } else {
    drawInkBlot(context, 11, 20);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function drawInkBlot(context: CanvasRenderingContext2D, seedBase: number, baseRadius: number) {
  context.fillStyle = "rgba(255,255,255,0.96)";
  context.beginPath();
  const points = 34;
  for (let index = 0; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const wobble =
      0.72 +
      inkUnit(seedBase + index * 3) * 0.45 +
      Math.sin(angle * 3 + seedBase) * 0.12 +
      Math.sin(angle * 7 + seedBase * 0.7) * 0.08;
    const radius = baseRadius * wobble;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * (0.78 + inkUnit(seedBase + 1) * 0.3);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.closePath();
  context.fill();

  context.globalCompositeOperation = "destination-out";
  for (let index = 0; index < 7; index += 1) {
    const angle = inkUnit(seedBase + index * 11) * Math.PI * 2;
    const radius = baseRadius * (0.15 + inkUnit(seedBase + index * 13) * 0.45);
    const x = Math.cos(angle) * baseRadius * inkUnit(seedBase + index * 17) * 0.7;
    const y = Math.sin(angle) * baseRadius * inkUnit(seedBase + index * 19) * 0.7;
    context.beginPath();
    context.arc(x, y, radius * 0.28, 0, Math.PI * 2);
    context.fill();
  }

  context.globalCompositeOperation = "source-over";
  context.fillStyle = "rgba(255,255,255,0.62)";
  for (let index = 0; index < 8; index += 1) {
    const angle = inkUnit(seedBase + index * 23) * Math.PI * 2;
    const spread = baseRadius * (0.55 + inkUnit(seedBase + index * 29) * 0.72);
    context.beginPath();
    context.arc(
      Math.cos(angle) * spread,
      Math.sin(angle) * spread,
      baseRadius * (0.07 + inkUnit(seedBase + index * 31) * 0.11),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function drawInkStreak(context: CanvasRenderingContext2D) {
  const gradient = context.createLinearGradient(-52, 0, 52, 0);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.78)");
  gradient.addColorStop(0.62, "rgba(255,255,255,0.95)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;

  context.beginPath();
  context.moveTo(-54, -5);
  context.bezierCurveTo(-26, -18, 22, -16, 53, -3);
  context.bezierCurveTo(26, 9, -26, 16, -54, 5);
  context.closePath();
  context.fill();

  context.globalCompositeOperation = "destination-out";
  for (let index = 0; index < 5; index += 1) {
    context.beginPath();
    context.ellipse(
      -28 + index * 15,
      -2 + Math.sin(index * 2.1) * 6,
      3 + index,
      1.8 + index * 0.4,
      index * 0.7,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function inkUnit(seed: number) {
  const value = Math.sin(seed * 17.371) * 43758.5453;
  return value - Math.floor(value);
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

function CameraRig(props: { lensSettings: BattlePostEffectConfigMap["lens"]; state: BattleState }) {
  const { camera } = useThree();
  const cameraBaseRef = useRef({ x: 0, y: 2.35, z: 6.4, fov: 39, lookX: 0, lookY: 1.05, lookZ: 0 });
  const shakeRef = useRef(0);
  const lungeRef = useRef(0);
  const orbitPhaseRef = useRef(0);
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
    const p1Z = mapBattleZ(props.state.fighters.p1.z, props.state.arenaDepth);
    const p2Z = mapBattleZ(props.state.fighters.p2.z, props.state.arenaDepth);
    const midpointX = (p1X + p2X) / 2;
    const midpointZ = (p1Z + p2Z) / 2;
    const distance = Math.abs(p2X - p1X);
    const spread = clamp((distance - CAMERA_CLOSE_DISTANCE) / (CAMERA_FAR_DISTANCE - CAMERA_CLOSE_DISTANCE), 0, 1);
    const targetX = clamp(midpointX * 0.42, -0.72, 0.72);
    const targetLookX = clamp(midpointX * 0.32, -0.58, 0.58);
    const targetLookZ = clamp(midpointZ * 0.22, -0.28, 0.28);
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
    cameraBase.lookZ += addSmoothExp(cameraBase.lookZ, targetLookZ, 4.2, deltaSeconds);
    cameraBase.fov += addSmoothExp(cameraBase.fov, targetFov, 4.8, deltaSeconds);
    const shake = shakeRef.current > 0 ? Math.sin(props.state.frame * 1.7) * shakeRef.current : 0;
    const superLean = props.state.lastSuper && props.state.frame - props.state.lastSuper.at < 50 ? (props.state.lastSuper.attacker === "p1" ? -0.08 : 0.08) : 0;
    rollRef.current += addSmoothExp(rollRef.current, shake * 0.04 + superLean, 14, deltaSeconds);
    const cameraY = cameraBase.y + shake * 0.3;
    const cameraZ = cameraBase.z - (props.state.superFreeze ? 0.35 : 0) - lungeRef.current;
    const cameraX = cameraBase.x + shake;
    const lensOrbitAmount = props.lensSettings.enabled ? props.lensSettings.cameraOrbitAmount : 0;
    const lensOrbitSpeed = props.lensSettings.enabled ? props.lensSettings.cameraOrbitSpeed : 0;
    orbitPhaseRef.current += deltaSeconds * lensOrbitSpeed * Math.PI * 2;
    const orbitAngle = Math.sin(orbitPhaseRef.current) * lensOrbitAmount;
    if (Math.abs(orbitAngle) > 0.0001) {
      const offsetX = cameraX - cameraBase.lookX;
      const offsetZ = cameraZ - cameraBase.lookZ;
      const cos = Math.cos(orbitAngle);
      const sin = Math.sin(orbitAngle);
      camera.position.set(cameraBase.lookX + offsetX * cos + offsetZ * sin, cameraY, cameraBase.lookZ + offsetZ * cos - offsetX * sin);
    } else {
      camera.position.set(cameraX, cameraY, cameraZ);
    }
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = cameraBase.fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(cameraBase.lookX, cameraBase.lookY, cameraBase.lookZ);
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
