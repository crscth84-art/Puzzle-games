import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSession, SESSION_COOKIE, type Session } from "./auth";
import { getStore } from "./store";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY_BYTES = 64 * 1024;

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * CSRF protection for state-changing requests: the Origin header must match
 * the host serving the request, and the body must be JSON (which a
 * cross-site HTML form cannot send).
 */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new HttpError(403, "Forbidden");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Forbidden");
  }
  if (originHost !== host) throw new HttpError(403, "Forbidden");
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Expected application/json");
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "Request too large");
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request too large");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

/** Fixed-window rate limit. Throws 429 when `limit` is exceeded within `windowSeconds`. */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const n = await getStore().incr(`rl:${key}`, windowSeconds);
  if (n > limit) throw new HttpError(429, "Too many attempts. Please wait and try again.");
}

export async function requireSession(req: NextRequest): Promise<Session> {
  const session = await getSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw new HttpError(401, "Please sign in");
  return session;
}

/** Wraps a route handler with uniform error handling that never leaks internals. */
export function handler(fn: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong" }, 500);
    }
  };
}
