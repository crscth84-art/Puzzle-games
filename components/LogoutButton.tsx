"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "./api";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await post("/api/auth/logout");
        } finally {
          router.replace("/");
        }
      }}
    >
      Sign out
    </button>
  );
}
