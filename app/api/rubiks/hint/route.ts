import { assertSameOrigin, handler, HttpError, json, readJson, requireSession } from "@/lib/http";
import { playSchema, requestHint } from "@/lib/rubiks";
import type { Move } from "@/lib/cube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  assertSameOrigin(req);
  const session = await requireSession(req);
  const parsed = playSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const result = await requestHint(session.userId, parsed.data.gameId, parsed.data.moves as Move[]);
  return json(result);
});
