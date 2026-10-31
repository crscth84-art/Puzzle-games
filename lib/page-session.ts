import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE, type Session } from "./auth";

export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  return getSession(jar.get(SESSION_COOKIE)?.value);
}

export async function requirePageSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect("/");
  return session;
}
