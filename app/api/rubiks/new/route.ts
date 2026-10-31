import { assertSameOrigin, handler, json, rateLimit, requireSession } from "@/lib/http";
import { MAX_HINTS, newGame } from "@/lib/rubiks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  assertSameOrigin(req);
  const session = await requireSession(req);
  await rateLimit(`new-game:${session.userId}`, 60, 60 * 60);
  const game = await newGame(session.userId);
  return json({ gameId: game.id, scramble: game.scramble, hintsLeft: MAX_HINTS }, 201);
});
