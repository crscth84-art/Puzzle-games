import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { currentSession } from "@/lib/page-session";

export default async function Home() {
  if (await currentSession()) redirect("/play");
  return (
    <main className="center">
      <div className="card auth">
        <h1>🧩 Puzzle Games</h1>
        <p className="muted">Sign in to play 3D puzzles.</p>
        <AuthForm />
      </div>
    </main>
  );
}
