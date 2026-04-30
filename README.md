# The Stakeout / Lock-in Lobby MVP

A static web prototype for the multiplayer focus competition PRD.

## Run

```sh
npm run dev
```

Then open `http://localhost:5173`.

## Build

```sh
npm run build
```

The build script writes the deployable static app to `public/`.

## Deploy to Vercel

This repo includes `vercel.json` and a serverless `/api/rooms` endpoint for the prototype room state.

1. Import `niyathig/the-stakeout` in Vercel.
2. Use the default install command.
3. Use `npm run build` as the build command.
4. Use `public` as the output directory.

The routes `/create`, `/room/:roomId`, `/join/:code`, and `/phone/:token` rewrite to the SPA. The short QR route `/q/:token` redirects to `/phone/:token`.

Note: the Vercel API stores room state in serverless memory for prototype demos. It is not durable and should be replaced with Firebase, Supabase, or Vercel KV before a real launch.

## What is implemented

- Landing, create room, join, lobby, phone pairing, active session, and end screens.
- Private room codes and invite links.
- Up to 4 players.
- Display-name-only MVP flow.
- Ready states, camera permission, phone pairing links, phone heartbeat, and disconnect penalties.
- Motion detection hooks through the phone companion page, with a test penalty button for desktop simulation.
- Server-like scoring state in `localStorage`, synchronized across tabs with `BroadcastChannel`.
- Focus/break phase support for no breaks, 25/5 Pomodoro, and 50/10 Pomodoro.
- Timer, live scoreboard, event feed, clean finish bonus, final rankings, loser, and stakes summary.

## Prototype limits

This is intentionally frontend-only. Cross-device multiplayer requires replacing the storage layer with Firebase/Supabase and replacing the placeholder video grid with Daily, LiveKit, or a WebRTC implementation.
