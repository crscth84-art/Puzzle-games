import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import { requirePageSession } from "@/lib/page-session";
import { getStats, MAX_HINTS } from "@/lib/rubiks";

function formatTime(ms: number | null) {
  if (ms === null) return "—";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default async function PlayHub() {
  const session = await requirePageSession();
  const stats = await getStats(session.userId);
  return (
    <main className="page">
      <header className="topbar">
        <h1>🧩 Puzzle Games</h1>
        <div className="row">
          <span className="muted">Signed in as <strong>{session.username}</strong></span>
          <LogoutButton />
        </div>
      </header>
      <section className="grid">
        <Link href="/play/rubiks" className="card game-card">
          <div className="game-icon" aria-hidden>🟥🟦<br />🟨🟩</div>
          <h2>Rubik&apos;s Cube</h2>
          <p className="muted">Solve a scrambled 3×3 cube in 3D. You get {MAX_HINTS} hints. Ask for more and you have to start over.</p>
          <dl className="stats">
            <div><dt>Solved</dt><dd>{stats.solved}</dd></div>
            <div><dt>Best time</dt><dd>{formatTime(stats.bestTimeMs)}</dd></div>
            <div><dt>Fewest moves</dt><dd>{stats.bestMoves ?? "—"}</dd></div>
          </dl>
        </Link>
        <div className="card game-card disabled" aria-disabled>
          <div className="game-icon" aria-hidden>❔</div>
          <h2>More puzzles</h2>
          <p className="muted">Coming soon.</p>
        </div>
      </section>
    </main>
  );
}
