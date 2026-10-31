import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  applyMoves,
  generateScramble,
  isMove,
  isSolved,
  MAX_MOVES,
  nextHint,
  solvedCube,
  type Move,
} from "./cube";
import { HttpError } from "./http";
import { getStore } from "./store";

export const MAX_HINTS = 5;
export const SCRAMBLE_LENGTH = 20;
const GAME_TTL_SECONDS = 60 * 60 * 24;

export interface Game {
  id: string;
  userId: string;
  scramble: Move[];
  startedAt: number;
}

export interface Stats {
  started: number;
  solved: number;
  forcedRestarts: number;
  bestTimeMs: number | null;
  bestMoves: number | null;
}

const gameKey = (id: string) => `rubiks:game:${id}`;
const hintKey = (id: string) => `rubiks:hints:${id}`;
const doneKey = (id: string) => `rubiks:done:${id}`;
const activeKey = (userId: string) => `rubiks:active:${userId}`;
const statsKey = (userId: string) => `rubiks:stats:${userId}`;

export const playSchema = z.object({
  gameId: z.string().uuid(),
  moves: z.array(z.string().refine(isMove, "Invalid move")).max(MAX_MOVES),
});

const emptyStats = (): Stats => ({
  started: 0,
  solved: 0,
  forcedRestarts: 0,
  bestTimeMs: null,
  bestMoves: null,
});

export async function getStats(userId: string): Promise<Stats> {
  return { ...emptyStats(), ...(await getStore().get<Stats>(statsKey(userId))) };
}

async function updateStats(userId: string, fn: (s: Stats) => void) {
  // Small last-write-wins window is acceptable for personal stats.
  const s = await getStats(userId);
  fn(s);
  await getStore().set(statsKey(userId), s);
}

export async function newGame(userId: string): Promise<Game> {
  const game: Game = {
    id: randomUUID(),
    userId,
    scramble: generateScramble(SCRAMBLE_LENGTH, (n) => randomInt(n)),
    startedAt: Date.now(),
  };
  const store = getStore();
  await store.set(gameKey(game.id), game, { ex: GAME_TTL_SECONDS });
  // Only one active game per user: starting a new one abandons the old one.
  await store.set(activeKey(userId), game.id, { ex: GAME_TTL_SECONDS });
  await updateStats(userId, (s) => {
    s.started++;
  });
  return game;
}

/** Loads the user's game and makes sure it is still their active, unfinished game. */
export async function loadActiveGame(userId: string, gameId: string): Promise<Game> {
  const store = getStore();
  const [game, active, done] = await Promise.all([
    store.get<Game>(gameKey(gameId)),
    store.get<string>(activeKey(userId)),
    store.get<string>(doneKey(gameId)),
  ]);
  if (!game || game.userId !== userId) throw new HttpError(404, "Game not found");
  if (active !== gameId || done) throw new HttpError(409, "This game is over. Start a new one.");
  return game;
}

export type HintResult =
  | { kind: "hint"; move: Move; hintsLeft: number }
  | { kind: "solved" }
  | { kind: "forced-restart" };

export async function requestHint(userId: string, gameId: string, moves: Move[]): Promise<HintResult> {
  const game = await loadActiveGame(userId, gameId);
  const move = nextHint(game.scramble, moves);
  if (!move) return { kind: "solved" };

  const store = getStore();
  // Atomic counter so parallel requests can never exceed the limit.
  const used = await store.incr(hintKey(gameId), GAME_TTL_SECONDS);
  if (used > MAX_HINTS) {
    // Out of hints: the game is lost and the player has to start over.
    await store.set(doneKey(gameId), "failed", { ex: GAME_TTL_SECONDS });
    await store.del(activeKey(userId));
    await updateStats(userId, (s) => {
      s.forcedRestarts++;
    });
    return { kind: "forced-restart" };
  }
  return { kind: "hint", move, hintsLeft: MAX_HINTS - used };
}

export async function completeGame(userId: string, gameId: string, moves: Move[]) {
  const game = await loadActiveGame(userId, gameId);
  if (!isSolved(applyMoves(applyMoves(solvedCube(), game.scramble), moves))) {
    throw new HttpError(400, "The cube is not solved yet");
  }
  const store = getStore();
  // NX guarantees a game is only counted once, even with duplicate requests.
  const first = await store.set(doneKey(gameId), "solved", { ex: GAME_TTL_SECONDS, nx: true });
  if (!first) throw new HttpError(409, "This game is over. Start a new one.");
  await store.del(activeKey(userId));

  const timeMs = Date.now() - game.startedAt;
  const hintsUsed = Math.min((await store.get<number>(hintKey(gameId))) ?? 0, MAX_HINTS);
  let newBest = false;
  await updateStats(userId, (s) => {
    s.solved++;
    if (s.bestTimeMs === null || timeMs < s.bestTimeMs) {
      s.bestTimeMs = timeMs;
      newBest = true;
    }
    if (s.bestMoves === null || moves.length < s.bestMoves) s.bestMoves = moves.length;
  });
  return { timeMs, moves: moves.length, hintsUsed, newBest };
}
