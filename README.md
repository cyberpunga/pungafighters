# Punga Fighters

Punga Fighters is an original browser fighting-game prototype inspired by camera-first character creators. Players capture or import action poses, optionally segment themselves from the background in-browser, save a fighter locally, and battle in same-device or invite-code WebRTC 1v1 matches.

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

- Route-backed React shell for menus, fighter creator, staged fight setup, settings, online invites, and battle mounts.
- React Three Fiber 2.5D battle runtime for local and invite-code online photo standee fights in a physical arena.
- React Three Rapier visual physics for impact debris and arena juice; deterministic combat hit detection remains in the simulation.
- Local standee battle with deterministic health, timer, rounds, hitboxes, CPU input synthesis, and keyboard controls.
- WebRTC invite matches with manual offer/answer codes, DataChannel input sync, and temporary peer fighter transfer.
- Webcam capture through `getUserMedia`.
- On-device cutout providers: MediaPipe Selfie Segmenter by default, plus optional Transformers.js ORMBG and MODNet background-removal models.
- Creator-side segmentation controls for per-action capture delays, MediaPipe mask tuning, and Transformers.js model selection.
- Creator-side sound controls for recording, previewing, and removing attack, hit, and win voice clips that play during battle.
- Character editing and export for local fighters, with creator-side imports for `.pungafighter.json` files, simple spritesheet images, and single action images.
- Custom battle background image import for local fights and host-selected online arenas.
- Reorderable Pixel, CRT, Bad TV, Static, and Lens battle display effect stacks stored in local settings.
- English and neutral Latin American Spanish localization with browser-language detection and a persisted language override in Settings.
- Local-only persistence in IndexedDB.
- Default placeholder fighters so battle works before creating a custom fighter.

## Character Files

Use the fight setup roster to edit or export fighters. Editing opens the fighter in the creator; saved custom fighters update in place, while default fighters load as editable copies. Export creates a `.pungafighter.json` file containing the fighter manifest, pose images, and recorded voice clips as data URLs so it can be imported into another local browser profile without a backend.

Imports live in the creator view and load as an editable draft; nothing is added to the roster until you press `Save fighter`. Use the top-level fighter import for `.pungafighter.json` files, the strip import for a PNG, JPEG, or WebP spritesheet, or each action card's import button for one pose at a time. Spritesheets are five equal cells in pose order: `idle`, `punch`, `kick`, `hit`, `victory`. Wider sheets are read left-to-right; taller sheets are read top-to-bottom.

Captured, single-image, and spritesheet sources are saveable immediately as normalized frames. Use `Process` on an action, or `Process all`, to run the selected browser-side cutout engine and replace those frames with transparent cutouts.

## Controls

Player 1:

- `A` / `D`: move
- `W`: jump
- `S`: block
- `J`: punch
- `K`: kick
- `J` + `K`: super when charged

Player 2:

- Arrow keys: move, jump, block
- `1`: punch
- `2`: kick
- `1` + `2`: super when charged

Online guests can also use Player 1 controls while playing from the Player 2 corner.
CPU-controlled slots synthesize deterministic actions and ignore keyboard input.

## Online Matches

Use the homepage Local Fight, Host Remote, or Join Remote options before choosing fighters. For online matches, the host shares an offer code, the guest returns an answer code, and the match starts after both browsers exchange setup assets. V1 online play has no accounts, matchmaking, or GunDB relay. TURN can be configured through the Worker credentials endpoint below.

Each computer selects and sends one local fighter for online play; the host is placed in the Player 1 corner and the guest is placed in the Player 2 corner after the exchange. The online preview shows the fighter that will be sent.

Selected fighter images and voice clips are sent peer-to-peer in chunks for that match only, with a 12 MB cap per selected fighter. The host's selected battle background is also synchronized for the match with the same 10 MB imported-background limit; the default arena sends metadata only.

Online matches intentionally buffer inputs by a small fixed delay so both browsers can simulate the same frames. If the network is jittery, the match may briefly slow while waiting for the missing input frame instead of guessing and diverging.

### TURN Configuration

Online matches use STUN by default. To improve connection reliability, provide short-lived TURN `iceServers` at runtime. For production Pages deploys, set this as a GitHub Actions variable named `VITE_RTC_ICE_SERVERS_URL` in either repository variables or the `github-pages` environment variables:

```bash
VITE_RTC_ICE_SERVERS_URL=https://your-credentials-endpoint.example/ice-servers
```

The endpoint should return either Cloudflare's generated `{ "iceServers": [...] }` response or an `iceServers` array. Keep Cloudflare TURN keys and API tokens server-side; the browser should only receive expiring credentials. For quick local testing only, you can paste a generated response into `VITE_RTC_ICE_SERVERS_JSON`. Set `VITE_RTC_FORCE_TURN=true` to force relay candidates while testing whether TURN is actually being used.

This repo includes a dedicated Cloudflare Worker in `workers/turn/` for that endpoint. Configure its secrets with `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`, then deploy it:

```bash
cd workers/turn
pnpm install
pnpm wrangler secret put TURN_KEY_ID
pnpm wrangler secret put TURN_KEY_API_TOKEN
pnpm deploy
```

Set `ALLOWED_ORIGINS` in `workers/turn/wrangler.toml` to the deployed game origin and any local dev origins you need.

### Character Generation Worker

This repo includes a separate Cloudflare Worker in `workers/generation/` for server-side Gemini spritesheet and single-pose generation. Configure `GEMINI_API_KEY` as a Worker secret; optionally set `GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_ASPECT_RATIO`, or `GEMINI_IMAGE_SIZE` to change defaults without editing code. Request bodies accept `mode`, `prompt`, `model`, and optional reference `image` or `images` entries. Omit `mode` or use `"strip"` for a five-pose spritesheet; use `"pose"` with a `pose` value of `idle`, `punch`, `kick`, `hit`, or `victory` for one square action frame:

```json
{
  "mode": "strip",
  "prompt": "a homemade cardboard robot boxer with red gloves",
  "model": "nano-banana-pro",
  "images": [{ "mimeType": "image/png", "data": "<base64-or-data-url>" }]
}
```

Supported model aliases are `nano-banana`, `nano-banana-2`, and `nano-banana-pro`; direct `gemini-*` image model ids are also accepted for testing. The response includes the generated image as base64 and a `dataUrl`, ready to feed into the creator spritesheet import or per-action replacement flow.

```bash
cd workers/generation
pnpm install
pnpm wrangler secret put GEMINI_API_KEY
pnpm deploy
```

Set `ALLOWED_ORIGINS` in `workers/generation/wrangler.toml` to the deployed game origin and any local dev origins you need. For local browser development against a local Wrangler worker, set the Vite development env file:

```bash
# .env.development.local
VITE_CHARACTER_GENERATION_URL=http://localhost:8787/generate
```

Vite loads `.env.development.local` for `pnpm dev`. The GitHub Pages build uses `--mode github-pages`, so configure the deployed endpoint as a GitHub Actions variable named `VITE_CHARACTER_GENERATION_URL` in either repository variables or the `github-pages` environment variables:

```bash
VITE_CHARACTER_GENERATION_URL=https://your-generation-worker.example/generate
```

For local production-like Pages builds, put that same deployed endpoint in `.env.github-pages.local`. Avoid using `.env.local` for this value when you need different development and deployed endpoints, because `.env.local` is loaded for every Vite mode.

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

Punga Fighters is local-first. Captured images, generated cutouts, custom battle backgrounds, and voice clips are stored in the browser's IndexedDB database named `punga-fighters`. Online invite matches send the selected fighter assets and the host's selected background directly to the opponent for that match and do not save remote fighters or remote backgrounds locally. No backend or account system exists in this prototype.
