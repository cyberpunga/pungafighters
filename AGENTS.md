# Agent Guide: Punga Fighters

## Product Boundaries

- Build an original homage named **Punga Fighters**.
- Do not use protected Photo Dojo, Nintendo, DSi, or other third-party branding or assets.
- Keep the prototype local-first: no backend, accounts, online play, sharing, or export/import unless explicitly requested.
- Preserve the core fantasy: camera-created cutout fighters in a simple local 1v1 arena.

## Architecture

- React owns menus, creator/editor UI, settings, and DOM overlays.
- Phaser owns the 2D battle canvas, scene lifecycle, camera, sprites, and effects.
- Simulation owns combat rules, health, timer, rounds, positions, and hit detection. Do not put gameplay rules directly in Phaser scene callbacks.
- IndexedDB stores saveable data: fighter profiles, generated image blobs, audio blobs, and settings.
- Prefer stable ids and manifest-like constants over hard-coded asset paths scattered through the codebase.

## File Organization

- `src/types/`: shared public interfaces.
- `src/storage/`: IndexedDB access and local persistence.
- `src/creator/`: capture, segmentation, image normalization, and audio recording helpers.
- `src/creator/segmentation/`: pluggable cutout providers. Keep new engines behind the `SegmentationProvider` interface.
- `src/game/simulation/`: deterministic gameplay state and systems.
- `src/game/input/`: action names and keyboard mappings.
- `src/game/content/`: default fighters and authored content.
- `src/phaser/`: Phaser bridge, scenes, and render-only helpers.
- `src/ui/`: React views and reusable UI components.

## Engineering Rules

- Keep gameplay state serializable and independent from Phaser objects.
- Keep Phaser render objects disposable; never treat sprites or tweens as source-of-truth state.
- Use DOM for text-heavy UI and controls.
- Keep center playfield readable during battle.
- When adding assets or generated media, prefer local placeholders or user-generated content.
- Keep segmentation browser-side unless the user explicitly chooses a cloud/provider architecture.
- Add future cutout engines through the provider registry instead of wiring model-specific code into React views.
- Use TypeScript types for new interfaces and keep `pnpm lint` clean.

## Verification

Run these before handing off meaningful changes:

```bash
pnpm lint
pnpm build
```

For creator changes, test webcam permission accepted, denied, and segmentation failure paths when possible. For battle changes, test default-vs-default and custom-vs-default matches.
