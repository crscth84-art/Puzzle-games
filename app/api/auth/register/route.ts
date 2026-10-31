import { createSession, createUser, credentialsSchema, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { assertSameOrigin, clientIp, handler, HttpError, json, rateLimit, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  assertSameOrigin(req);
  await rateLimit(`register:${clientIp(req)}`, 5, 60 * 60);
  const parsed = credentialsSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");

  const user = await createUser(parsed.data.username, parsed.data.password);
  if (!user) throw new HttpError(409, "That username is taken");

  const token = await createSession(user);
  const res = json({ username: user.username }, 201);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
