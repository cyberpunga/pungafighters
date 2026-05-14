# Agent Guide: Punga Fighters

## Product Boundaries

- Build an original homage named **Punga Fighters**.
- Do not use protected Photo Dojo, Nintendo, DSi, or other third-party branding or assets.
- Keep the prototype local-first: no backend, accounts, public matchmaking, sharing, or export/import unless explicitly requested.
- Preserve the core fantasy: camera-created cutout fighters in a simple local 1v1 arena.

## Architecture

- React owns menus, creator/editor UI, settings, and DOM overlays.
- React views are route-backed through `src/ui/routes.ts`; keep browser history/back-forward behavior intact when adding screens.
- Phaser owns the 2D battle canvas, scene lifecycle, camera, sprites, and effects.
- Simulation owns combat rules, health, timer, rounds, positions, and hit detection. Do not put gameplay rules directly in Phaser scene callbacks.
- WebRTC invite matches use manual copy/paste signaling and DataChannels. Keep GunDB, relays, TURN, matchmaking, and persistent remote imports out unless explicitly requested.
- Online setup asset transfer uses manifest metadata plus chunked DataChannel binary payloads: fighters have a 12 MB selected-fighter cap, and host-selected custom backgrounds use the 10 MB imported-background cap. Do not reintroduce single-message data URL setup payloads.
- TURN config is loaded through `VITE_RTC_ICE_SERVERS_URL` or temporary `VITE_RTC_ICE_SERVERS_JSON`; never put Cloudflare TURN keys or API tokens in browser code.
- IndexedDB stores saveable data: fighter profiles, generated image blobs, imported battle background image blobs, audio blobs, and settings.
- Prefer stable ids and manifest-like constants over hard-coded asset paths scattered through the codebase.

## File Organization

- `src/types/`: shared public interfaces.
- `src/storage/`: IndexedDB access and local persistence.
- `src/creator/`: capture, segmentation, image normalization, and audio recording helpers.
- `src/creator/segmentation/`: pluggable cutout providers. Keep new engines behind the `SegmentationProvider` interface.
- `src/game/simulation/`: deterministic gameplay state and systems.
- `src/game/input/`: action names and keyboard mappings.
- `src/game/content/`: default fighters and authored content.
- `src/game/network/`: WebRTC signaling, protocol messages, input buffering, and temporary peer asset transfer.
- `src/phaser/`: Phaser bridge, scenes, and render-only helpers.
- `src/ui/`: React views and reusable UI components.
- `server/`: Cloudflare Worker that exchanges server-side TURN secrets for short-lived browser ICE server credentials.

## Engineering Rules

- Keep gameplay state serializable and independent from Phaser objects.
- Keep online combat lockstep-friendly: fixed ticks, frame-indexed inputs, deterministic event ids, and no renderer-owned gameplay rules.
- Keep Phaser render objects disposable; never treat sprites or tweens as source-of-truth state.
- Use DOM for text-heavy UI and controls.
- Keep center playfield readable during battle.
- When adding assets or generated media, prefer local placeholders or user-generated content.
- Keep saved character import in the creator/editor flow so imported fighters load as editable drafts before saving.
- Keep segmentation browser-side unless the user explicitly chooses a cloud/provider architecture.
- Add future cutout engines through the provider registry instead of wiring model-specific code into React views.
- Keep provider-specific controls near the provider implementation and pass them through the shared `SegmentationProvider` options shape.
- Use TypeScript types for new interfaces and keep `pnpm lint` clean.

## Verification

Run these before handing off meaningful changes:

```bash
pnpm lint
pnpm test
pnpm build
```

Use `pnpm build:pages` when changing deployment, routing, public asset paths, or Vite config. GitHub Pages serves this project from `/pungafighters/`; keep normal local dev rooted at `/`.

For creator changes, test webcam permission accepted, denied, and segmentation failure paths when possible. For battle changes, test default-vs-default, custom-vs-default, and online two-tab invite matches when possible.
