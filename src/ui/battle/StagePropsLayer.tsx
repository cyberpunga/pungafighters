import { useFrame } from "@react-three/fiber";
import { CuboidCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getBattleDebugBoxes, type BattleDebugBox, type BattleState } from "../../game/simulation/battle";
import type { PlayerSlot } from "../../types/game";
import { clamp, mapBattleX, mapBattleZ, seededUnit } from "./math";

type StagePropTrigger = {
  direction: 1 | -1;
  force: number;
  kind: "hit" | "walk";
};

interface StagePropDefinition {
  id: string;
  battleX: number;
  battleZ: number;
  triggerRadius: number;
}

const CRATE_PROPS: StagePropDefinition[] = [
  { id: "left-crates", battleX: 112, battleZ: 86, triggerRadius: 92 },
  { id: "right-crates", battleX: 1688, battleZ: 334, triggerRadius: 92 },
];

const TIPPABLE_PROPS: StagePropDefinition[] = [
  { id: "left-sign", battleX: 242, battleZ: 328, triggerRadius: 70 },
  { id: "right-tins", battleX: 1558, battleZ: 92, triggerRadius: 66 },
];

export function StagePropsLayer(props: { state: BattleState }) {
  const [resetKey, setResetKey] = useState(0);
  const previousResetRef = useRef({
    frame: props.state.frame,
    p1Wins: props.state.fighters.p1.roundsWon,
    p2Wins: props.state.fighters.p2.roundsWon,
    round: props.state.round,
  });

  useEffect(() => {
    const previous = previousResetRef.current;
    const next = {
      frame: props.state.frame,
      p1Wins: props.state.fighters.p1.roundsWon,
      p2Wins: props.state.fighters.p2.roundsWon,
      round: props.state.round,
    };
    if (next.frame < previous.frame || next.round !== previous.round || next.p1Wins !== previous.p1Wins || next.p2Wins !== previous.p2Wins) {
      setResetKey((current) => current + 1);
    }
    previousResetRef.current = next;
  }, [props.state.frame, props.state.fighters.p1.roundsWon, props.state.fighters.p2.roundsWon, props.state.round]);

  return (
    <Physics key={resetKey} gravity={[0, -12.5, 0]} timeStep={1 / 60}>
      <ArenaPhysicsBounds />
      {CRATE_PROPS.map((prop) => (
        <BreakableCrateStack key={prop.id} prop={prop} state={props.state} />
      ))}
      {TIPPABLE_PROPS.map((prop, index) => (
        <TippableStageProp key={prop.id} prop={prop} propIndex={index} state={props.state} />
      ))}
    </Physics>
  );
}

function ArenaPhysicsBounds() {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[5.45, 0.08, 2.72]} position={[0, -0.08, 0]} />
      <CuboidCollider args={[5.45, 2.2, 0.08]} position={[0, 2.16, -2.62]} />
      <CuboidCollider args={[0.08, 1.6, 2.72]} position={[-5.44, 1.56, 0]} />
      <CuboidCollider args={[0.08, 1.6, 2.72]} position={[5.44, 1.56, 0]} />
    </RigidBody>
  );
}

function BreakableCrateStack(props: { prop: StagePropDefinition; state: BattleState }) {
  const [broken, setBroken] = useState(false);
  const positionX = mapBattleX(props.prop.battleX, props.state.arenaWidth);
  const positionZ = mapBattleZ(props.prop.battleZ, props.state.arenaDepth);
  const onTrigger = useCallback((trigger: StagePropTrigger) => {
    if (trigger.kind === "hit" || trigger.force > 0.55) {
      setBroken(true);
    }
  }, []);

  useStagePropTrigger({
    battleX: props.prop.battleX,
    battleZ: props.prop.battleZ,
    disabled: broken,
    onTrigger,
    state: props.state,
    triggerRadius: props.prop.triggerRadius,
  });

  if (broken) {
    return <CrateShardBurst origin={[positionX, 0.5, positionZ]} seed={props.prop.battleX} />;
  }

  return (
    <RigidBody type="fixed" colliders={false} position={[positionX, 0, positionZ]}>
      <CuboidCollider args={[0.46, 0.5, 0.36]} position={[0, 0.5, 0]} />
      <CrateMesh position={[-0.18, 0.24, 0]} scale={[0.5, 0.48, 0.5]} color="#a86f3d" />
      <CrateMesh position={[0.28, 0.26, 0.02]} scale={[0.48, 0.52, 0.46]} color="#c49052" />
      <CrateMesh position={[0.06, 0.75, -0.03]} scale={[0.52, 0.46, 0.48]} color="#8c5a37" />
    </RigidBody>
  );
}

function TippableStageProp(props: { prop: StagePropDefinition; propIndex: number; state: BattleState }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const triggeredRef = useRef(false);
  const positionX = mapBattleX(props.prop.battleX, props.state.arenaWidth);
  const positionZ = mapBattleZ(props.prop.battleZ, props.state.arenaDepth);
  const isSign = props.prop.id.includes("sign");
  const bodyY = isSign ? 0.96 : 0.34;

  const onTrigger = useCallback((trigger: StagePropTrigger) => {
    if (triggeredRef.current || !bodyRef.current) {
      return;
    }
    triggeredRef.current = true;
    const body = bodyRef.current;
    const impulseScale = trigger.kind === "hit" ? 0.48 : 0.28;
    body.wakeUp();
    body.applyImpulse(
      {
        x: trigger.direction * trigger.force * impulseScale,
        y: 0.18 + trigger.force * (trigger.kind === "hit" ? 0.08 : 0.04),
        z: isSign ? -0.04 : 0.1,
      },
      true,
    );
    body.applyTorqueImpulse(
      {
        x: isSign ? 0.12 : 0.22,
        y: trigger.direction * 0.04,
        z: -trigger.direction * (isSign ? 0.55 : 0.42) * (trigger.kind === "hit" ? 1 : 0.6),
      },
      true,
    );
  }, [isSign]);

  useStagePropTrigger({
    battleX: props.prop.battleX,
    battleZ: props.prop.battleZ,
    disabled: false,
    onTrigger,
    state: props.state,
    triggerRadius: props.prop.triggerRadius,
  });

  return (
    <RigidBody
      ref={bodyRef}
      angularDamping={0.68}
      canSleep
      colliders={false}
      friction={0.92}
      linearDamping={0.58}
      position={[positionX, bodyY, positionZ]}
      restitution={0.12}
    >
      {isSign ? (
        <>
          <CuboidCollider args={[0.06, 0.48, 0.06]} position={[0, -0.48, 0]} />
          <CuboidCollider args={[0.42, 0.21, 0.06]} position={[0, 0.28, 0]} />
          <StageSignBody />
        </>
      ) : (
        <>
          <CuboidCollider args={[0.18, 0.42, 0.18]} position={[0, 0.08, 0]} />
          <TinStackBody seed={props.propIndex + 3} />
        </>
      )}
    </RigidBody>
  );
}

function useStagePropTrigger(props: {
  battleX: number;
  battleZ: number;
  disabled: boolean;
  onTrigger: (trigger: StagePropTrigger) => void;
  state: BattleState;
  triggerRadius: number;
}) {
  const lastAttackFrameRef = useRef(-1);
  const previousFighterPositionRef = useRef<Record<PlayerSlot, { x: number; z: number }>>({
    p1: { x: props.state.fighters.p1.x, z: props.state.fighters.p1.z },
    p2: { x: props.state.fighters.p2.x, z: props.state.fighters.p2.z },
  });

  useFrame(() => {
    if (props.disabled || props.state.status === "matchOver") {
      return;
    }

    const attackTrigger = getBattleDebugBoxes(props.state).find((box) => {
      if (box.kind !== "attack" || !boxTouchesProp(box, props.battleX, props.triggerRadius)) {
        return false;
      }
      return Math.abs(props.state.fighters[box.slot].z - props.battleZ) < props.triggerRadius;
    });
    if (attackTrigger && props.state.frame !== lastAttackFrameRef.current) {
      lastAttackFrameRef.current = props.state.frame;
      props.onTrigger({
        direction: boxCenterX(attackTrigger) <= props.battleX ? 1 : -1,
        force: 1.35,
        kind: "hit",
      });
      return;
    }

    (["p1", "p2"] as const).forEach((slot) => {
      const fighter = props.state.fighters[slot];
      const previous = previousFighterPositionRef.current[slot];
      previousFighterPositionRef.current[slot] = { x: fighter.x, z: fighter.z };
      const grounded = Math.abs(fighter.y - props.state.groundY) < 5;
      const motion = Math.hypot(fighter.x - previous.x, fighter.z - previous.z);
      const distance = Math.hypot(fighter.x - props.battleX, fighter.z - props.battleZ);
      if (grounded && motion > 2.2 && distance < props.triggerRadius) {
        props.onTrigger({
          direction: fighter.x <= props.battleX ? 1 : -1,
          force: clamp(0.46 + motion / 8, 0.55, 1.1),
          kind: "walk",
        });
      }
    });
  });
}

function boxTouchesProp(box: BattleDebugBox, battleX: number, triggerRadius: number) {
  return box.left <= battleX + triggerRadius && box.right >= battleX - triggerRadius;
}

function boxCenterX(box: BattleDebugBox) {
  return (box.left + box.right) / 2;
}

function CrateMesh(props: { color: string; position: [number, number, number]; scale: [number, number, number] }) {
  return (
    <group position={props.position} scale={props.scale}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={props.color} roughness={0.86} metalness={0.03} />
      </mesh>
      <mesh position={[0, 0.18, 0.505]} castShadow>
        <boxGeometry args={[1.04, 0.09, 0.04]} />
        <meshStandardMaterial color="#f0c36a" roughness={0.74} />
      </mesh>
      <mesh position={[0, -0.18, 0.505]} castShadow>
        <boxGeometry args={[1.04, 0.09, 0.04]} />
        <meshStandardMaterial color="#f0c36a" roughness={0.74} />
      </mesh>
      <mesh position={[0, 0, 0.53]} rotation={[0, 0, Math.PI * 0.25]} castShadow>
        <boxGeometry args={[1.2, 0.07, 0.04]} />
        <meshStandardMaterial color="#55352c" roughness={0.78} />
      </mesh>
    </group>
  );
}

function CrateShardBurst(props: { origin: [number, number, number]; seed: number }) {
  const [originX, originY, originZ] = props.origin;
  const shards = useMemo(
    () =>
      Array.from({ length: 11 }, (_, index) => {
        const angle = seededUnit(props.seed + index * 17) * Math.PI * 2;
        const radius = 0.08 + seededUnit(props.seed + index * 23) * 0.42;
        const size: [number, number, number] = [
          0.12 + seededUnit(props.seed + index * 31) * 0.24,
          0.06 + seededUnit(props.seed + index * 41) * 0.2,
          0.08 + seededUnit(props.seed + index * 47) * 0.22,
        ];
        return {
          color: index % 3 === 0 ? "#f0c36a" : index % 2 === 0 ? "#9b6037" : "#c7894c",
          impulse: [Math.cos(angle) * (0.24 + radius * 0.35), 0.5 + seededUnit(props.seed + index * 59) * 0.36, Math.sin(angle) * 0.22] as [number, number, number],
          position: [originX + Math.cos(angle) * radius, originY + seededUnit(props.seed + index * 29) * 0.4, originZ + Math.sin(angle) * radius * 0.5] as [number, number, number],
          rotation: [seededUnit(props.seed + index * 61) * Math.PI, seededUnit(props.seed + index * 67) * Math.PI, seededUnit(props.seed + index * 71) * Math.PI] as [number, number, number],
          size,
        };
      }),
    [originX, originY, originZ, props.seed],
  );

  return (
    <>
      {shards.map((shard, index) => (
        <CrateShard key={index} shard={shard} />
      ))}
    </>
  );
}

function CrateShard(props: {
  shard: {
    color: string;
    impulse: [number, number, number];
    position: [number, number, number];
    rotation: [number, number, number];
    size: [number, number, number];
  };
}) {
  const bodyRef = useRef<RapierRigidBody>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    body.wakeUp();
    body.applyImpulse({ x: props.shard.impulse[0], y: props.shard.impulse[1], z: props.shard.impulse[2] }, true);
    body.applyTorqueImpulse({ x: props.shard.impulse[2] * 1.3, y: props.shard.impulse[0] * 0.7, z: -props.shard.impulse[0] * 1.1 }, true);
  }, [props.shard.impulse]);

  return (
    <RigidBody
      ref={bodyRef}
      angularDamping={0.44}
      colliders="cuboid"
      friction={0.88}
      linearDamping={0.18}
      position={props.shard.position}
      restitution={0.28}
      rotation={props.shard.rotation}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={props.shard.size} />
        <meshStandardMaterial color={props.shard.color} roughness={0.82} />
      </mesh>
    </RigidBody>
  );
}

function StageSignBody() {
  return (
    <group>
      <mesh position={[0, -0.48, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.12, 0.96, 0.12]} />
        <meshStandardMaterial color="#4f4a58" roughness={0.76} />
      </mesh>
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.84, 0.42, 0.12]} />
        <meshStandardMaterial color="#d94f65" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.28, 0.065]} castShadow>
        <boxGeometry args={[0.62, 0.1, 0.02]} />
        <meshStandardMaterial color="#f7d86a" roughness={0.68} emissive="#4b3514" emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0, 0.12, 0.065]} castShadow>
        <boxGeometry args={[0.44, 0.08, 0.02]} />
        <meshStandardMaterial color="#fff4d3" roughness={0.7} />
      </mesh>
    </group>
  );
}

function TinStackBody(props: { seed: number }) {
  return (
    <group>
      {Array.from({ length: 3 }, (_, index) => {
        const y = -0.2 + index * 0.28;
        const twist = (seededUnit(props.seed * 13 + index) - 0.5) * 0.22;
        return (
          <mesh key={index} position={[0, y, 0]} rotation={[0, twist, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.18, 0.18, 0.24, 18]} />
            <meshStandardMaterial color={index % 2 === 0 ? "#2ec4b6" : "#f7b267"} roughness={0.58} metalness={0.38} />
          </mesh>
        );
      })}
    </group>
  );
}
