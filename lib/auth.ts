import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getStore } from "./store";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const BCRYPT_COST = 12;

export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-pz_session" : "pz_session";

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(/^[A-Za-z0-9_]+$/, "Username may only contain letters, numbers and _"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    // bcrypt only uses the first 72 bytes; reject longer input instead of silently truncating
    .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Password must be at most 72 bytes"),
});

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
}

export interface Session {
  userId: string;
  username: string;
}

const userKey = (username: string) => `user:${username.toLowerCase()}`;
const sessionKey = (token: string) =>
  `session:${createHash("sha256").update(token).digest("hex")}`;

// Used so login takes the same time whether or not the user exists.
// (bcrypt hash of a throwaway string at cost 12; precomputed to keep cold starts fast)
const DUMMY_HASH = "$2b$12$1VjS1hXUWawU3Of6Wtj2yO3/uCC0.civrigxhaM8Rhbuuopb69rpG";

export async function createUser(username: string, password: string): Promise<User | null> {
  const user: User = {
    id: randomUUID(),
    username,
    passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    createdAt: Date.now(),
  };
  const created = await getStore().set(userKey(username), user, { nx: true });
  return created ? user : null;
}

export async function verifyCredentials(username: string, password: string): Promise<User | null> {
  const user = await getStore().get<User>(userKey(username));
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  return user && ok ? user : null;
}

export async function createSession(user: User): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const session: Session = { userId: user.id, username: user.username };
  await getStore().set(sessionKey(token), session, { ex: SESSION_TTL_SECONDS });
  return token;
}

export async function getSession(token: string | undefined): Promise<Session | null> {
  if (!token || token.length > 128) return null;
  return getStore().get<Session>(sessionKey(token));
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token || token.length > 128) return;
  await getStore().del(sessionKey(token));
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
