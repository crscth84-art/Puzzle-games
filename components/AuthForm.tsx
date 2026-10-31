"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "./api";

export default function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await post(mode === "login" ? "/api/auth/login" : "/api/auth/register", { username, password });
      router.replace("/play");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(null); }}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(null); }}>
          Create account
        </button>
      </div>
      <label>
        Username
        <input name="username" autoComplete="username" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : 1} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {mode === "register" && (
        <label>
          Confirm password
          <input name="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
      )}
      {mode === "register" && <p className="hint-text muted">3–20 letters, numbers or _. Password at least 8 characters.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}
