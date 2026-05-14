# Punga Fighters

Punga Fighters is an original browser fighting-game prototype inspired by camera-first character creators. Players capture webcam poses, segment themselves from the background in-browser, save a fighter locally, and battle in same-device or invite-code WebRTC 1v1 matches.

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
- `pnpm build:pages` type-checks and builds for GitHub Pages at `/pungafighters/`.
- `pnpm preview` serves the production build locally.
- `pnpm lint` runs the TypeScript type check.
- `pnpm test` runs focused Vitest coverage.

## MVP Features

- Route-backed React shell for menus, fighter creator, fighter select, settings, online invites, and battle mount.
- Phaser 3 battle runtime embedded inside React.
- Local same-device 1v1 battle with deterministic health, timer, rounds, hitboxes, and keyboard controls.
- WebRTC invite matches with manual offer/answer codes, DataChannel input sync, and temporary peer fighter transfer.
- Webcam capture through `getUserMedia`.
- On-device cutout providers: MediaPipe Selfie Segmenter by default, plus optional Transformers.js ORMBG and MODNet background-removal models.
- Creator-side segmentation controls for capture delay, MediaPipe mask tuning, and Transformers.js model selection.
- Character export/import for local `.pungafighter.json` files and simple spritesheet image imports.
- Custom battle background image import for the local arena.
- Local-only persistence in IndexedDB.
- Default placeholder fighters so battle works before creating a custom fighter.

## Character Files

Use Fighter Select to export any fighter as a `.pungafighter.json` file. The file contains the fighter manifest, pose images, and recorded voice clips as data URLs so it can be imported into another local browser profile without a backend.

Imports accept either `.pungafighter.json` or a PNG, JPEG, or WebP spritesheet. Spritesheets are five equal cells in pose order: `idle`, `punch`, `kick`, `hit`, `victory`. Wider sheets are read left-to-right; taller sheets are read top-to-bottom. PNG or WebP keeps transparent cutouts intact.

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

Online guests can also use Player 1 controls while playing from the Player 2 corner.

## Online Matches

Use Fighter Select to host or join an online match. The host shares an offer code, the guest returns an answer code, and the match starts after both browsers exchange fighters. V1 online play has no accounts, matchmaking, or GunDB relay. TURN can be configured through the Worker credentials endpoint below.

Each computer sends its local Player 1 selection for online play; the guest's fighter is placed in the Player 2 corner after the exchange. The online preview shows the fighter that will be sent.

Selected fighter images and voice clips are sent peer-to-peer in chunks for that match only, with a 12 MB cap per selected fighter. Custom battle backgrounds remain local and are not synchronized in online matches.

Online matches intentionally buffer inputs by a small fixed delay so both browsers can simulate the same frames. If the network is jittery, the match may briefly slow while waiting for the missing input frame instead of guessing and diverging.

### TURN Configuration

Online matches use STUN by default. To improve connection reliability, provide short-lived TURN `iceServers` at runtime:

```bash
VITE_RTC_ICE_SERVERS_URL=https://your-credentials-endpoint.example/ice-servers
```

The endpoint should return either Cloudflare's generated `{ "iceServers": [...] }` response or an `iceServers` array. Keep Cloudflare TURN keys and API tokens server-side; the browser should only receive expiring credentials. For quick local testing only, you can paste a generated response into `VITE_RTC_ICE_SERVERS_JSON`. Set `VITE_RTC_FORCE_TURN=true` to force relay candidates while testing whether TURN is actually being used.

This repo includes a Cloudflare Worker in `server/` for that endpoint. Configure its secrets with `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`, then deploy it:

```bash
cd server
pnpm install
pnpm wrangler secret put TURN_KEY_ID
pnpm wrangler secret put TURN_KEY_API_TOKEN
pnpm deploy
```

Set `ALLOWED_ORIGINS` in `server/wrangler.toml` to the deployed game origin and any local dev origins you need.

## Browser Requirements

- Modern Chromium, Firefox, or Safari.
- WebRTC DataChannel support for online invite matches.
- Webcam capture requires HTTPS or `localhost`.
- Audio recording requires `MediaRecorder` support.
- Segmentation model assets are loaded by the browser at runtime from MediaPipe, Hugging Face, and ONNX runtime asset URLs.
- The Transformers.js provider has a heavier first load than MediaPipe and may use WebGPU when the browser supports it.

## Deployment

GitHub Actions deploys `main` to GitHub Pages with the app served from `/pungafighters/` under the `cyberpun.ga` organization domain. Local development still runs from `/`; the Pages build uses `pnpm build:pages` to set the Vite base path and emit a `404.html` fallback for direct route visits.

## Privacy

Punga Fighters is local-first. Captured images, generated cutouts, custom battle backgrounds, and voice clips are stored in the browser's IndexedDB database named `punga-fighters`. Online invite matches send the selected fighter assets directly to the opponent for that match and do not save remote fighters or custom backgrounds locally. No backend or account system exists in this prototype.
