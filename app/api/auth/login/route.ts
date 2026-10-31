import { z } from "zod";
import { createSession, SESSION_COOKIE, sessionCookieOptions, verifyCredentials } from "@/lib/auth";
import { assertSameOrigin, clientIp, handler, HttpError, json, rateLimit, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(20),
  password: z.string().min(1).max(200),
});

export const POST = handler(async (req) => {
  assertSameOrigin(req);
  const parsed = loginSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Enter your username and password");
  const { username, password } = parsed.data;

  // Limit by IP and by account to slow down password guessing.
  await rateLimit(`login-ip:${clientIp(req)}`, 30, 15 * 60);
  await rateLimit(`login-user:${username.toLowerCase()}`, 10, 15 * 60);

  const user = await verifyCredentials(username, password);
  if (!user) throw new HttpError(401, "Wrong username or password");

  const token = await createSession(user);
  const res = json({ username: user.username });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
