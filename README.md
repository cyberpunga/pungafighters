# Punga Fighters

Punga Fighters is an original browser fighting-game prototype inspired by camera-first character creators. Players capture webcam poses, segment themselves from the background in-browser, save a fighter locally, and battle in same-device 1v1 matches.

This is not a Photo Dojo clone and does not use Nintendo branding, names, or assets.

## Setup

```bash
pnpm install
pnpm dev
```

Open the local Vite URL shown in the terminal.

## Scripts

- `pnpm dev` starts the local dev server.
- `pnpm build` type-checks and creates a production build.
- `pnpm preview` serves the production build locally.
- `pnpm lint` runs the TypeScript type check.

## MVP Features

- React shell for menus, fighter creator, fighter select, settings, and battle mount.
- Phaser 3 battle runtime embedded inside React.
- Local same-device 1v1 battle with deterministic health, timer, rounds, hitboxes, and keyboard controls.
- Webcam capture through `getUserMedia`.
- On-device cutout providers: MediaPipe Selfie Segmenter by default, plus optional Transformers.js ORMBG and MODNet background-removal models.
- Creator-side segmentation controls for capture delay, MediaPipe mask tuning, and Transformers.js model selection.
- Local-only persistence in IndexedDB.
- Default placeholder fighters so battle works before creating a custom fighter.

## Controls

Player 1:

- `A` / `D`: move
- `W`: jump
- `S`: block
- `J`: punch
- `K`: kick
- `L`: special

Player 2:

- Arrow keys: move, jump, block
- `1`: punch
- `2`: kick
- `3`: special

## Browser Requirements

- Modern Chromium, Firefox, or Safari.
- Webcam capture requires HTTPS or `localhost`.
- Audio recording requires `MediaRecorder` support.
- Segmentation model assets are loaded by the browser at runtime from MediaPipe, Hugging Face, and ONNX runtime asset URLs.
- The Transformers.js provider has a heavier first load than MediaPipe and may use WebGPU when the browser supports it.

## Privacy

Punga Fighters is local-first. Captured images, generated cutouts, and voice clips are stored in the browser's IndexedDB database named `punga-fighters`. No backend or account system exists in this prototype.
