# Agent Guide: Punga Fighters

## Product Boundaries

- Build an original homage named **Punga Fighters**.
- Do not use protected Photo Dojo, Nintendo, DSi, or other third-party branding or assets.
- Keep the prototype local-first: no backend, accounts, public matchmaking, sharing, or export/import unless explicitly requested.
- Preserve the core fantasy: camera-created cutout fighters in a simple local 1v1 arena.

## Architecture

- React owns menus, creator/editor UI, settings, and DOM overlays.
- React views are route-backed through `src/ui/routes.ts`; keep browser history/back-forward behavior intact when adding screens.
- React Three Fiber owns the 2.5D local and online standee battle direction and should stay a thin renderer over simulation state.
- React Three Rapier may add visual-only physics juice such as debris, props, and wobble; never use it as the source of combat hit detection.
- Simulation owns combat rules, health, timer, rounds, x/y/z fighter positions, and hit detection. Do not put gameplay rules directly in renderer callbacks.
- WebRTC invite matches use manual copy/paste signaling and DataChannels. Keep GunDB, relays, TURN, matchmaking, and persistent remote imports out unless explicitly requested.
- Online setup asset transfer uses manifest metadata plus chunked DataChannel binary payloads: fighters have a 12 MB selected-fighter cap, and host-selected custom backgrounds use the 10 MB imported-background cap. Do not reintroduce single-message data URL setup payloads.
- TURN config is loaded through `VITE_RTC_ICE_SERVERS_URL` or temporary `VITE_RTC_ICE_SERVERS_JSON`; never put Cloudflare TURN keys or API tokens in browser code.
- IndexedDB stores saveable data: fighter profiles, generated image blobs, imported battle background image blobs, audio blobs, and settings.
- Fighter profiles keep five gameplay pose frames for simulation/collision and may also keep generated animation sprite frames (`idle1`, `walk1`, `punchWindup`, etc.) for renderer-only texture cycling.
- Imported battle backgrounds may include deterministic browser-generated depth layer PNGs. Compute them at save/import time, store them with the background record, transfer them only through optional manifest assets under the existing background cap, and keep them visual-only in the R3F renderer.
- Prefer stable ids and manifest-like constants over hard-coded asset paths scattered through the codebase.

## File Organization

- `src/types/`: shared public interfaces.
- `src/storage/`: IndexedDB access and local persistence.
- `src/creator/`: capture, segmentation, image normalization, and audio recording helpers.
- `src/creator/segmentation/`: pluggable cutout providers. Keep new engines behind the `SegmentationProvider` interface.
- `src/game/simulation/`: deterministic gameplay state and systems.
- `src/game/input/`: action names, keyboard mappings, and CPU input helpers.
- `src/game/content/`: default fighters and authored content.
- `src/game/render/`: renderer-agnostic battle animation helpers.
- `src/game/network/`: WebRTC signaling, protocol messages, input buffering, and temporary peer asset transfer.
- `src/i18n/`: typed locale dictionaries, browser-language detection, translation helpers, and React i18n provider.
- `src/ui/`: React views and reusable UI components.
- `src/ui/battle/`: React Three Fiber battle stage implementation, HUD, frame-loop helpers, audio, and visual-only debris helpers.
- `src/ui/creator/`: creator view implementation, creator-specific UI components, and draft/object URL lifecycle helpers.
- `src/styles/`: stylesheet sections imported by `src/styles.css`; preserve existing class names when moving styles.
- `workers/turn/`: Cloudflare Worker that exchanges server-side TURN secrets for short-lived browser ICE server credentials.
- `workers/generation/`: Cloudflare Worker that proxies server-side Gemini character spritesheet and single-pose generation.

## Engineering Rules

- Keep gameplay state serializable and independent from Three.js, DOM, and other renderer objects.
- Keep online combat lockstep-friendly: fixed ticks, frame-indexed inputs, deterministic event ids, and no renderer-owned gameplay rules.
- Keep local CPU behavior as deterministic input synthesis; do not bake CPU combat behavior into React Three Fiber render callbacks or simulation hit resolution.
- Keep React Three Fiber and Rapier objects disposable; never treat meshes, bodies, or animation refs as source-of-truth state.
- Use DOM for text-heavy UI and controls.
- Keep center playfield readable during battle.
- When adding assets or generated media, prefer local placeholders or user-generated content.
- Keep image-generation API keys server-side in the Worker; never put Gemini or other model-provider secrets in browser code.
- Keep creator generation photo/reference-centered. Do not add prompt-only or free-text prompt creator flows unless explicitly requested.
- Keep saved character import in the creator/editor flow so imported fighters load as editable drafts before saving.
- Keep creator image acquisition separate from cutout processing: captured, per-action imported, and spritesheet-split source images should be saveable as normalized frames, with processing as an optional per-action or all-action step.
- Keep spritesheet imports deterministic: generated/imported animation sheets must be a single horizontal 13-cell strip in `FIGHTER_SPRITES` order. Do not infer arbitrary grids or component-detected layouts for gameplay/animation mapping.
- Keep generated animation sprites visual-only. Do not use walk/idle/punch windup texture frames as source-of-truth combat state or hit detection.
- Keep segmentation browser-side unless the user explicitly chooses a cloud/provider architecture.
- Add future cutout engines through the provider registry instead of wiring model-specific code into React views.
- Keep provider-specific controls near the provider implementation and pass them through the shared `SegmentationProvider` options shape.
- Keep user-facing app copy behind the `src/i18n/` dictionaries; stable ids, routes, saved fighter names, imported background names, and export data must remain locale-independent.
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
