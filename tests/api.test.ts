import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MemoryStore, setStoreForTests } from "@/lib/store";
import { applyMoves, invertMove, solvedCube, type Move } from "@/lib/cube";

vi.mock("bcryptjs", async (orig) => {
  // Keep real bcrypt but at a low cost so tests stay fast.
  const real = (await orig()) as { default: typeof import("bcryptjs") };
  return { default: { ...real.default, hash: (p: string) => real.default.hash(p, 4) } };
});

const { POST: register } = await import("@/app/api/auth/register/route");
const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { POST: newGame } = await import("@/app/api/rubiks/new/route");
const { POST: hint } = await import("@/app/api/rubiks/hint/route");
const { POST: complete } = await import("@/app/api/rubiks/complete/route");
const { SESSION_COOKIE } = await import("@/lib/auth");

const ORIGIN = "http://localhost:3000";
let ipCounter = 0;

function req(path: string, body: unknown, opts: { cookie?: string; origin?: string | null; type?: string; ip?: string } = {}) {
  const headers: Record<string, string> = {
    host: "localhost:3000",
    "content-type": opts.type ?? "application/json",
    "x-forwarded-for": opts.ip ?? `10.0.0.${++ipCounter % 250}`,
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function cookieFrom(res: Response) {
  const c = res.headers.get("set-cookie") ?? "";
  return c.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? "";
}

async function signup(username = "alice", password = "correct horse") {
  const res = await register(req("/api/auth/register", { username, password }));
  expect(res.status).toBe(201);
  return cookieFrom(res);
}

beforeEach(() => setStoreForTests(new MemoryStore()));

describe("auth", () => {
  it("registers, sets a hardened session cookie, and rejects duplicates (case-insensitive)", async () => {
    const res = await register(req("/api/auth/register", { username: "Alice", password: "correct horse" }));
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const dup = await register(req("/api/auth/register", { username: "alice", password: "another pw1" }));
    expect(dup.status).toBe(409);
  });

  it("validates input", async () => {
    for (const body of [
      { username: "ab", password: "longenough" },
      { username: "bad name!", password: "longenough" },
      { username: "<script>", password: "longenough" },
      { username: "bob", password: "short" },
      { username: "bob", password: "x".repeat(73) },
      { username: "bob" },
      { username: ["bob"], password: "longenough" },
      null,
    ]) {
      const res = await register(req("/api/auth/register", body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("logs in with the right password only, with a generic error", async () => {
    await signup();
    const ok = await login(req("/api/auth/login", { username: "ALICE", password: "correct horse" }));
    expect(ok.status).toBe(200);
    expect(cookieFrom(ok)).not.toBe("");
    const bad = await login(req("/api/auth/login", { username: "alice", password: "wrong" }));
    const missing = await login(req("/api/auth/login", { username: "nobody", password: "wrong" }));
    expect(bad.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await bad.json()).toEqual(await missing.json());
  });

  it("rate limits password guessing per account", async () => {
    await signup();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await login(req("/api/auth/login", { username: "alice", password: "nope" + i }))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10).every((s) => s === 429)).toBe(true);
    // even the correct password is blocked while locked out
    expect((await login(req("/api/auth/login", { username: "alice", password: "correct horse" }))).status).toBe(429);
  });

  it("blocks cross-site and non-JSON requests (CSRF)", async () => {
    const evil = await register(req("/api/auth/register", { username: "eve", password: "longenough" }, { origin: "https://evil.example" }));
    expect(evil.status).toBe(403);
    const noOrigin = await register(req("/api/auth/register", { username: "eve", password: "longenough" }, { origin: null }));
    expect(noOrigin.status).toBe(403);
    const form = await register(req("/api/auth/register", "username=eve&password=longenough", { type: "application/x-www-form-urlencoded" }));
    expect(form.status).toBe(415);
    const bad = await register(req("/api/auth/register", "{not json"));
    expect(bad.status).toBe(400);
    const huge = await register(req("/api/auth/register", { username: "eve", password: "x".repeat(70_000) }));
    expect(huge.status).toBe(413);
  });

  it("logout revokes the session server-side", async () => {
    const cookie = await signup();
    expect((await newGame(req("/api/rubiks/new", {}, { cookie }))).status).toBe(201);
    expect((await logout(req("/api/auth/logout", {}, { cookie }))).status).toBe(200);
    expect((await newGame(req("/api/rubiks/new", {}, { cookie }))).status).toBe(401);
  });

  it("requires a valid session for game endpoints", async () => {
    expect((await newGame(req("/api/rubiks/new", {}))).status).toBe(401);
    expect((await newGame(req("/api/rubiks/new", {}, { cookie: "forged" }))).status).toBe(401);
  });
});

describe("rubik's game", () => {
  async function start(cookie: string) {
    const res = await newGame(req("/api/rubiks/new", {}, { cookie }));
    expect(res.status).toBe(201);
    return (await res.json()) as { gameId: string; scramble: Move[]; hintsLeft: number };
  }

  it("gives 5 hints, then forces a restart on the 6th request", async () => {
    const cookie = await signup();
    const g = await start(cookie);
    expect(g.hintsLeft).toBe(5);
    const moves: Move[] = [];
    for (let i = 4; i >= 0; i--) {
      const res = await hint(req("/api/rubiks/hint", { gameId: g.gameId, moves }, { cookie }));
      const body = await res.json();
      expect(body).toMatchObject({ kind: "hint", hintsLeft: i });
      moves.push(body.move);
    }
    const sixth = await (await hint(req("/api/rubiks/hint", { gameId: g.gameId, moves }, { cookie }))).json();
    expect(sixth).toEqual({ kind: "forced-restart" });
    // the lost game cannot be continued or completed
    const after = await hint(req("/api/rubiks/hint", { gameId: g.gameId, moves }, { cookie }));
    expect(after.status).toBe(409);
    const solution = [...g.scramble].reverse().map(invertMove);
    const done = await complete(req("/api/rubiks/complete", { gameId: g.gameId, moves: solution }, { cookie }));
    expect(done.status).toBe(409);
  });

  it("cannot exceed 5 hints with parallel requests", async () => {
    const cookie = await signup();
    const g = await start(cookie);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => hint(req("/api/rubiks/hint", { gameId: g.gameId, moves: [] }, { cookie })).then((r) => r.json())),
    );
    expect(results.filter((r) => r.kind === "hint")).toHaveLength(5);
  });

  it("verifies solves on the server and counts them once", async () => {
    const cookie = await signup();
    const g = await start(cookie);
    const notSolved = await complete(req("/api/rubiks/complete", { gameId: g.gameId, moves: ["R"] }, { cookie }));
    expect(notSolved.status).toBe(400);
    const solution = [...g.scramble].reverse().map(invertMove);
    expect(applyMoves(applyMoves(solvedCube(), g.scramble), solution).length).toBe(26);
    const ok = await complete(req("/api/rubiks/complete", { gameId: g.gameId, moves: solution }, { cookie }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ moves: 20, hintsUsed: 0, newBest: true });
    const again = await complete(req("/api/rubiks/complete", { gameId: g.gameId, moves: solution }, { cookie }));
    expect(again.status).toBe(409);
  });

  it("starting a new game abandons the old one", async () => {
    const cookie = await signup();
    const g1 = await start(cookie);
    await start(cookie);
    const res = await hint(req("/api/rubiks/hint", { gameId: g1.gameId, moves: [] }, { cookie }));
    expect(res.status).toBe(409);
  });

  it("does not let one user touch another user's game", async () => {
    const alice = await signup("alice");
    const bob = await signup("bob");
    const g = await start(alice);
    const res = await hint(req("/api/rubiks/hint", { gameId: g.gameId, moves: [] }, { cookie: bob }));
    expect(res.status).toBe(404);
  });

  it("rejects malformed moves and game ids", async () => {
    const cookie = await signup();
    const g = await start(cookie);
    for (const body of [
      { gameId: g.gameId, moves: ["X"] },
      { gameId: g.gameId, moves: "R" },
      { gameId: "not-a-uuid", moves: [] },
      { gameId: g.gameId, moves: Array(5001).fill("R") },
      { gameId: g.gameId },
    ]) {
      const res = await hint(req("/api/rubiks/hint", body, { cookie }));
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });
});
