import { useThree } from "@react-three/fiber";
import { Container, Fullscreen, Text } from "@react-three/uikit";
import { SUPER_HITS_REQUIRED, type BattleState } from "../../game/simulation/battle";
import type { LoadedFighter, PlayerSlot } from "../../types/game";
import { useI18n } from "../../i18n/react";
import { formatBattleMessage } from "./stageInput";

const HUD_TEXT = "#f8f4df";
const HUD_MUTED = "#b8b3a0";
const HUD_GOLD = "#f7b267";
const P1_ACCENT = "#2ec4b6";
const P2_ACCENT = "#f45b69";

export function BattleHudLayer(props: { fighters: { p1: LoadedFighter; p2: LoadedFighter }; state: BattleState; controlsHint: string; statusMessage?: string }) {
  const { t } = useI18n();
  const { size } = useThree();
  const compact = size.width < 640;
  const p1Runtime = props.state.fighters.p1;
  const p2Runtime = props.state.fighters.p2;
  const p1Health = clampRatio(p1Runtime.health / 100);
  const p2Health = clampRatio(p2Runtime.health / 100);
  const p1SuperRatio = SUPER_HITS_REQUIRED > 0 ? clampRatio(p1Runtime.superMeter / SUPER_HITS_REQUIRED) : 1;
  const p2SuperRatio = SUPER_HITS_REQUIRED > 0 ? clampRatio(p2Runtime.superMeter / SUPER_HITS_REQUIRED) : 1;
  const message = formatBattleMessage(props.state, t, props.statusMessage);
  const hint = props.state.status === "matchOver" ? t("battle.restartHint") : props.controlsHint;
  const seconds = Math.ceil(props.state.timer);

  return (
    <Fullscreen
      attachCamera
      pointerEvents="none"
      renderOrder={80}
      depthTest={false}
      depthWrite={false}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="flex-start"
      paddingTop={compact ? 22 : 42}
      paddingLeft={compact ? 8 : 26}
      paddingRight={compact ? 8 : 26}
      gapColumn={compact ? 6 : 16}
    >
      <FighterHudPanel
        accent={P1_ACCENT}
        compact={compact}
        health={p1Health}
        name={props.fighters.p1.name}
        roundsWon={p1Runtime.roundsWon}
        slot="p1"
        superReady={p1Runtime.superMeter >= SUPER_HITS_REQUIRED}
        superRatio={p1SuperRatio}
        maxLabel={t("battle.max")}
      />
      <CenterHudPanel compact={compact} hint={hint} message={message} seconds={seconds} />
      <FighterHudPanel
        accent={P2_ACCENT}
        compact={compact}
        health={p2Health}
        name={props.fighters.p2.name}
        roundsWon={p2Runtime.roundsWon}
        slot="p2"
        superReady={p2Runtime.superMeter >= SUPER_HITS_REQUIRED}
        superRatio={p2SuperRatio}
        maxLabel={t("battle.max")}
      />
    </Fullscreen>
  );
}

function FighterHudPanel(props: {
  accent: string;
  compact: boolean;
  health: number;
  maxLabel: string;
  name: string;
  roundsWon: number;
  slot: PlayerSlot;
  superRatio: number;
  superReady: boolean;
}) {
  const alignRight = props.slot === "p2";
  return (
    <Container
      width={props.compact ? 104 : 430}
      maxWidth={props.compact ? "32%" : "42%"}
      height={props.compact ? 74 : 118}
      flexShrink={1}
      flexDirection="row"
      alignItems="center"
      gapColumn={props.compact ? 6 : 14}
      paddingTop={props.compact ? 6 : 14}
      paddingBottom={props.compact ? 6 : 14}
      paddingLeft={props.compact ? 6 : 16}
      paddingRight={props.compact ? 6 : 16}
      borderColor="#403b34"
      borderTopWidth={2}
      borderRightWidth={2}
      borderBottomWidth={2}
      borderLeftWidth={2}
      borderTopLeftRadius={8}
      borderTopRightRadius={8}
      borderBottomLeftRadius={8}
      borderBottomRightRadius={8}
      renderOrder={80}
      depthTest={false}
      depthWrite={false}
      zIndex={1}
      zIndexOffset={1}
    >
      {!alignRight && <SlotBadge compact={props.compact} slot={props.slot} roundsWon={props.roundsWon} />}
      {!props.compact && (
        <Text
          positionType="absolute"
          positionTop={15}
          positionLeft={alignRight ? "auto" : 88}
          positionRight={alignRight ? 88 : "auto"}
          width={260}
          height={30}
          color={HUD_TEXT}
          fontSize={24}
          fontWeight="black"
          lineHeight={28}
          maxWidth="100%"
          textAlign={alignRight ? "right" : "left"}
          verticalAlign="middle"
          zIndex={4}
          transformTranslateZ={4}
        >
          {props.name}
        </Text>
      )}
      <Container
        flexGrow={1}
        flexShrink={1}
        flexDirection="column"
        gapRow={8}
        alignItems={alignRight ? "flex-end" : "flex-start"}
        marginTop={props.compact ? 0 : 30}
        zIndex={2}
        zIndexOffset={2}
        transformTranslateZ={2}
      >
        <ProgressBar ratio={props.health} fill={props.accent} mobile={props.compact} />
        <Container width="100%" flexDirection="row" alignItems="center" justifyContent={alignRight ? "flex-end" : "flex-start"} gapColumn={10} zIndex={3} transformTranslateZ={3}>
          <ProgressBar ratio={props.superRatio} fill={HUD_GOLD} compact mobile={props.compact} />
          {!props.compact && props.superReady && (
            <Text color={HUD_GOLD} fontSize={15} fontWeight="black" lineHeight={18} height={20} verticalAlign="middle" zIndex={4} transformTranslateZ={4}>
              {props.maxLabel}
            </Text>
          )}
        </Container>
      </Container>
      {alignRight && <SlotBadge compact={props.compact} slot={props.slot} roundsWon={props.roundsWon} />}
    </Container>
  );
}

function SlotBadge(props: { compact: boolean; slot: PlayerSlot; roundsWon: number }) {
  return (
    <Container
      width={props.compact ? 34 : 58}
      height={props.compact ? 34 : 58}
      flexShrink={0}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gapRow={2}
      borderColor="#7f6744"
      borderTopWidth={1}
      borderRightWidth={1}
      borderBottomWidth={1}
      borderLeftWidth={1}
      borderTopLeftRadius={8}
      borderTopRightRadius={8}
      borderBottomLeftRadius={8}
      borderBottomRightRadius={8}
      zIndex={2}
      zIndexOffset={2}
      transformTranslateZ={2}
    >
      {!props.compact && (
        <>
          <Text width="100%" height={17} color={HUD_GOLD} fontSize={14} fontWeight="black" lineHeight={16} textAlign="center" verticalAlign="middle" zIndex={4} transformTranslateZ={4}>
            {props.slot.toUpperCase()}
          </Text>
          <Text width="100%" height={25} color={HUD_TEXT} fontSize={22} fontWeight="black" lineHeight={24} textAlign="center" verticalAlign="middle" zIndex={4} transformTranslateZ={4}>
            {props.roundsWon}
          </Text>
        </>
      )}
    </Container>
  );
}

function CenterHudPanel(props: { compact: boolean; hint: string; message: string; seconds: number }) {
  return (
    <Container
      width={props.compact ? 74 : 160}
      height={props.compact ? 64 : 132}
      flexShrink={0}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gapRow={props.compact ? 2 : 6}
      paddingTop={props.compact ? 5 : 10}
      paddingBottom={props.compact ? 5 : 10}
      paddingLeft={props.compact ? 5 : 12}
      paddingRight={props.compact ? 5 : 12}
      borderColor="#403b34"
      borderTopWidth={2}
      borderRightWidth={2}
      borderBottomWidth={2}
      borderLeftWidth={2}
      borderTopLeftRadius={8}
      borderTopRightRadius={8}
      borderBottomLeftRadius={8}
      borderBottomRightRadius={8}
      renderOrder={80}
      depthTest={false}
      depthWrite={false}
      zIndex={1}
      zIndexOffset={1}
    >
      <Text
        width="100%"
        height={props.compact ? 28 : 62}
        color={HUD_TEXT}
        fontSize={props.compact ? 24 : 58}
        fontWeight="black"
        lineHeight={props.compact ? 26 : 60}
        textAlign="center"
        verticalAlign="middle"
        zIndex={4}
        transformTranslateZ={4}
      >
        {props.seconds}
      </Text>
      {!props.compact && (
        <>
          <Text width="100%" height={21} color={HUD_GOLD} fontSize={17} fontWeight="black" lineHeight={19} textAlign="center" verticalAlign="middle" maxWidth="100%" zIndex={4} transformTranslateZ={4}>
            {props.message}
          </Text>
          <Text width="100%" height={28} color={HUD_MUTED} fontSize={10} fontWeight="bold" lineHeight={12} textAlign="center" verticalAlign="middle" maxWidth="100%" zIndex={4} transformTranslateZ={4}>
            {props.hint}
          </Text>
        </>
      )}
    </Container>
  );
}

function ProgressBar(props: { compact?: boolean; fill: string; mobile: boolean; ratio: number }) {
  return (
    <Container
      width={props.compact ? "72%" : "100%"}
      height={props.mobile ? (props.compact ? 5 : 9) : props.compact ? 12 : 22}
      flexShrink={1}
      backgroundColor="#24222a"
      borderTopLeftRadius={4}
      borderTopRightRadius={4}
      borderBottomLeftRadius={4}
      borderBottomRightRadius={4}
      overflow="hidden"
      zIndex={3}
      zIndexOffset={3}
      transformTranslateZ={3}
    >
      <Container width={`${Math.round(props.ratio * 100)}%`} height="100%" backgroundColor={props.fill} zIndex={4} transformTranslateZ={4} />
    </Container>
  );
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}
