# Puzzle Games

3D puzzle games with user accounts, built with **Next.js** and **Three.js** and ready for **Vercel**.

The first game is a **Rubik's Cube**:

- A 3D cube you can rotate (drag), with animated face turns (buttons, or the keys `U D L R F B`, holding Shift for counter-clockwise).
- **5 hints per game.** Each hint shows the next move and lights up that face. Once all 5 are used, asking for another hint **ends the game and you have to start over** with a new scramble. You get a warning first.
- The timer, move counter and your personal stats (solves, best time, fewest moves) are kept.
- Accounts use a username and password.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without a database configured, local dev uses an in-memory store, so data resets when you restart.

## Deploy to Vercel

1. Push this repo to GitHub, then in Vercel choose **Add New → Project** and import the repo. The framework is detected automatically.
2. In the Vercel project, open **Storage** and add **Upstash for Redis** (it has a free tier). Connect it to the project. This sets `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) automatically.
3. Redeploy. Without a database the production app refuses to start sessions on purpose, instead of losing accounts.

Never set `UNSAFE_MEMORY_STORE` on Vercel. It exists only for local end-to-end tests.

## How it works

| Path | Purpose |
| --- | --- |
| `lib/cube.ts` | Pure cube model (shared by browser and server): moves, solved check, scrambles, hints |
| `lib/rubiks.ts` | Server game rules: games, the atomic 5-hint limit, forced restart, solve verification, stats |
| `lib/auth.ts` | Accounts (bcrypt) and server-side sessions |
| `lib/http.ts` | CSRF origin check, JSON body limits, rate limiting, error handling |
| `lib/store.ts` | Upstash Redis store (in-memory fallback for dev/tests only) |
| `components/RubiksGame.tsx` | Three.js scene, animations, controls and game UI |
| `proxy.ts` | Per-request nonce Content Security Policy |

The **server** is the source of truth. It creates the scramble, counts hints atomically (parallel requests can't get a 6th hint), and replays your moves to verify a solve before recording it.

## Security

- Passwords are hashed with bcrypt (cost 12). Inputs over 72 bytes are rejected rather than silently truncated.
- Sessions are random 256-bit tokens stored hashed in Redis, held in an `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookie, and revoked on sign-out. They expire after 7 days.
- CSRF protection: state-changing requests need a same-origin `Origin` header and a JSON body.
- Rate limits: sign-in is limited to 10 tries per account and 30 per IP every 15 minutes. Sign-up is limited to 5 per IP per hour.
- Sign-in errors are generic and take constant time, so they don't reveal which usernames exist.
- Every request is validated with zod, and bodies are capped at 64 KB.
- Headers: nonce-based CSP with `strict-dynamic`, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy. `X-Powered-By` is removed.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

For the browser end-to-end test, Playwright must be installed:

```bash
npm run build && UNSAFE_MEMORY_STORE=1 npm start &
BASE_URL=http://localhost:3000 npm run test:e2e
```
