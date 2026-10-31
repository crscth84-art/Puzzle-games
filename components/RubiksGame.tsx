"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  animationQuarters,
  applyMove,
  applyMoves,
  describeMove,
  FACE_DEF,
  FACES,
  isMove,
  isSolved,
  solvedCube,
  type CubeState,
  type Face,
  type Move,
} from "@/lib/cube";
import { post } from "./api";

type Status = "loading" | "playing" | "solved" | "lost" | "error";

interface NewGameResponse {
  gameId: string;
  scramble: Move[];
  hintsLeft: number;
}
type HintResponse =
  | { kind: "hint"; move: Move; hintsLeft: number }
  | { kind: "solved" }
  | { kind: "forced-restart" };
interface CompleteResponse {
  timeMs: number;
  moves: number;
  hintsUsed: number;
  newBest: boolean;
}

// Colors per outward direction, in BoxGeometry face order: +x, -x, +y, -y, +z, -z
const STICKER_COLORS = [0xd32f2f, 0xff8f00, 0xf5f5f5, 0xfdd835, 0x2e7d32, 0x1565c0];
const STICKER_NORMALS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Three.js scene holding the 26 cubies and animating layer turns. */
class CubeView {
  readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private pivot = new THREE.Group();
  private groups: THREE.Group[] = [];
  private stickerMats: THREE.MeshStandardMaterial[][] = [];
  private frame = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  constructor(private container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(5.2, 4.4, 6.4);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 16;

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const light = new THREE.DirectionalLight(0xffffff, 1.8);
    light.position.set(5, 8, 6);
    this.scene.add(light);
    const back = new THREE.DirectionalLight(0xffffff, 0.8);
    back.position.set(-6, -4, -5);
    this.scene.add(back);
    this.scene.add(this.pivot);

    const body = new THREE.BoxGeometry(0.96, 0.96, 0.96);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    const stickerGeo = new THREE.PlaneGeometry(0.82, 0.82);
    for (const home of solvedCube().map((c) => c.home)) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(body, bodyMat));
      const mats: THREE.MeshStandardMaterial[] = [];
      STICKER_NORMALS.forEach((n, i) => {
        if (home[0] * n[0] + home[1] * n[1] + home[2] * n[2] !== 1) return;
        const mat = new THREE.MeshStandardMaterial({ color: STICKER_COLORS[i], roughness: 0.35 });
        const s = new THREE.Mesh(stickerGeo, mat);
        s.position.set(n[0] * 0.481, n[1] * 0.481, n[2] * 0.481);
        s.lookAt(n[0], n[1], n[2]);
        g.add(s);
        mats.push(mat);
      });
      this.groups.push(g);
      this.stickerMats.push(mats);
      this.scene.add(g);
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(loop);
    };
    loop();
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Snap every cubie to the exact transform held by the model. */
  sync(state: CubeState) {
    const m = new THREE.Matrix4();
    state.forEach((c, i) => {
      const g = this.groups[i];
      if (g.parent !== this.scene) this.scene.add(g);
      const r = c.rot;
      m.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
      g.quaternion.setFromRotationMatrix(m);
      g.position.set(c.pos[0], c.pos[1], c.pos[2]);
    });
    this.pivot.rotation.set(0, 0, 0);
  }

  private layerIndices(state: CubeState, face: Face) {
    const { axis, layer } = FACE_DEF[face];
    return state.flatMap((c, i) => (c.pos[axis] === layer ? [i] : []));
  }

  /** Animate a move starting from `state`; resolves when the turn finishes. */
  animate(state: CubeState, move: Move, durationMs: number): Promise<void> {
    const face = move[0] as Face;
    const axis = AXES[FACE_DEF[face].axis];
    const target = (animationQuarters(move) * Math.PI) / 2;
    this.pivot.rotation.set(0, 0, 0);
    for (const i of this.layerIndices(state, face)) this.pivot.attach(this.groups[i]);
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        if (this.disposed) return resolve();
        const t = Math.min(1, (now - start) / durationMs);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.pivot.setRotationFromAxisAngle(axis, target * eased);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  highlight(state: CubeState, face: Face | null) {
    const on = face ? new Set(this.layerIndices(state, face)) : new Set<number>();
    this.stickerMats.forEach((mats, i) =>
      mats.forEach((m) => {
        m.emissive.setHex(on.has(i) ? 0x666666 : 0x000000);
      }),
    );
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export default function RubiksGame({ maxHints }: { maxHints: number }) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<CubeView | null>(null);
  const stateRef = useRef<CubeState>(solvedCube());
  const movesRef = useRef<Move[]>([]);
  const queueRef = useRef<Move[]>([]);
  const animatingRef = useRef(false);
  const gameIdRef = useRef<string | null>(null);
  const statusRef = useRef<Status>("loading");
  const startRef = useRef(0);
  const lockRef = useRef(false); // true while a hint/complete request is in flight
  const requestSeq = useRef(0); // bumps on every new game; stale async work checks it

  const [status, setStatusState] = useState<Status>("loading");
  const [moveCount, setMoveCount] = useState(0);
  const [hintsLeft, setHintsLeft] = useState(maxHints);
  const [hint, setHint] = useState<Move | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<CompleteResponse | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const setStatus = (s: Status) => {
    statusRef.current = s;
    setStatusState(s);
  };

  const handleAuthError = useCallback(
    (err: unknown) => {
      if ((err as { status?: number }).status === 401) {
        router.replace("/");
        return true;
      }
      return false;
    },
    [router],
  );

  const startGame = useCallback(async () => {
    const seq = ++requestSeq.current;
    setStatus("loading");
    setBusy(true);
    setMessage(null);
    setHint(null);
    setResult(null);
    setConfirmOpen(false);
    queueRef.current = [];
    lockRef.current = false;
    try {
      const game = await post<NewGameResponse>("/api/rubiks/new");
      if (seq !== requestSeq.current) return; // a newer request superseded this one
      if (!game.scramble.every(isMove)) throw new Error("Bad scramble from server");
      gameIdRef.current = game.gameId;
      movesRef.current = [];
      stateRef.current = applyMoves(solvedCube(), game.scramble);
      viewRef.current?.highlight(stateRef.current, null);
      viewRef.current?.sync(stateRef.current);
      setMoveCount(0);
      setHintsLeft(game.hintsLeft);
      startRef.current = Date.now();
      setElapsed(0);
      setStatus("playing");
    } catch (err) {
      if (seq !== requestSeq.current || handleAuthError(err)) return;
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not start a game");
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  }, [handleAuthError]);

  const finish = useCallback(async () => {
    lockRef.current = true;
    setBusy(true);
    const seq = requestSeq.current;
    try {
      const res = await post<CompleteResponse>("/api/rubiks/complete", {
        gameId: gameIdRef.current,
        moves: movesRef.current,
      });
      if (seq !== requestSeq.current) return;
      setResult(res);
      setStatus("solved");
    } catch (err) {
      if (handleAuthError(err)) return;
      setMessage(err instanceof Error ? err.message : "Could not record your solve");
    } finally {
      if (seq === requestSeq.current) {
        lockRef.current = false;
        setBusy(false);
      }
    }
  }, [handleAuthError]);

  const pump = useCallback(async () => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    try {
      while (queueRef.current.length && statusRef.current === "playing") {
        const move = queueRef.current.shift()!;
        const seq = requestSeq.current;
        setHint(null);
        viewRef.current?.highlight(stateRef.current, null);
        await viewRef.current?.animate(stateRef.current, move, move.endsWith("2") ? 320 : 220);
        if (seq !== requestSeq.current) {
          // A new game started mid-turn: drop this move and show the new cube.
          viewRef.current?.sync(stateRef.current);
          break;
        }
        stateRef.current = applyMove(stateRef.current, move);
        movesRef.current.push(move);
        viewRef.current?.sync(stateRef.current);
        setMoveCount(movesRef.current.length);
        if (isSolved(stateRef.current)) {
          queueRef.current = [];
          await finish();
          break;
        }
      }
    } finally {
      animatingRef.current = false;
    }
  }, [finish]);

  const turn = useCallback(
    (move: Move) => {
      if (statusRef.current !== "playing" || lockRef.current || queueRef.current.length > 8) return;
      queueRef.current.push(move);
      void pump();
    },
    [pump],
  );

  const askHint = useCallback(async () => {
    if (statusRef.current !== "playing" || lockRef.current || animatingRef.current || queueRef.current.length) return;
    setConfirmOpen(false);
    lockRef.current = true;
    setBusy(true);
    setMessage(null);
    const seq = requestSeq.current;
    try {
      const res = await post<HintResponse>("/api/rubiks/hint", {
        gameId: gameIdRef.current,
        moves: [...movesRef.current],
      });
      if (seq !== requestSeq.current) return;
      if (res.kind === "hint") {
        setHint(res.move);
        setHintsLeft(res.hintsLeft);
        viewRef.current?.highlight(stateRef.current, res.move[0] as Face);
      } else if (res.kind === "forced-restart") {
        setHintsLeft(0);
        setHint(null);
        viewRef.current?.highlight(stateRef.current, null);
        setStatus("lost");
      } else {
        await finish();
      }
    } catch (err) {
      if (handleAuthError(err)) return;
      setMessage(err instanceof Error ? err.message : "Could not get a hint");
    } finally {
      if (seq === requestSeq.current) {
        lockRef.current = false;
        setBusy(false);
      }
    }
  }, [finish, handleAuthError]);

  // Three.js setup + first game
  useEffect(() => {
    if (!mountRef.current) return;
    const view = new CubeView(mountRef.current);
    viewRef.current = view;
    view.sync(stateRef.current);
    void startGame();
    return () => {
      // Invalidate in-flight requests (requestSeq is a counter, not a DOM ref).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSeq.current++;
      view.dispose();
      viewRef.current = null;
    };
  }, [startGame]);

  // Keyboard controls: U D L R F B, hold Shift for counter-clockwise
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const face = e.key.toUpperCase();
      if ((FACES as readonly string[]).includes(face)) {
        e.preventDefault();
        turn((e.shiftKey ? `${face}'` : face) as Move);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn]);

  // Timer
  useEffect(() => {
    if (status !== "playing") return;
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 500);
    return () => clearInterval(id);
  }, [status]);

  const playing = status === "playing";
  const outOfHints = hintsLeft <= 0;

  return (
    <main className="game">
      <header className="topbar">
        <Link href="/play" className="btn secondary">← Games</Link>
        <h1>Rubik&apos;s Cube</h1>
        <button className="btn secondary" onClick={() => void startGame()} disabled={busy && status === "loading"}>
          New game
        </button>
      </header>

      <div className="hud">
        <span>⏱ {formatTime(elapsed)}</span>
        <span>Moves: {moveCount}</span>
        <span className="hint-dots" aria-label={`${hintsLeft} of ${maxHints} hints left`}>
          Hints:{" "}
          {Array.from({ length: maxHints }, (_, i) => (
            <span key={i} className={i < hintsLeft ? "dot on" : "dot"} />
          ))}
        </span>
      </div>

      <div className="stage">
        <div ref={mountRef} className="canvas" aria-label="3D Rubik's cube. Drag to rotate the view." />

        {status === "loading" && <div className="overlay"><p>Scrambling…</p></div>}

        {status === "solved" && result && (
          <div className="overlay">
            <div className="card">
              <h2>🎉 Solved!</h2>
              <p>
                Time {formatTime(result.timeMs)} · {result.moves} moves · {result.hintsUsed} hint
                {result.hintsUsed === 1 ? "" : "s"}
              </p>
              {result.newBest && <p className="success">New personal best!</p>}
              <button className="btn" onClick={() => void startGame()}>Play again</button>
            </div>
          </div>
        )}

        {status === "lost" && (
          <div className="overlay">
            <div className="card">
              <h2>Out of hints</h2>
              <p>You used all {maxHints} hints and asked for another. This game is over, so you&apos;ll have to start again with a new scramble.</p>
              <button className="btn" onClick={() => void startGame()} disabled={busy}>Start over</button>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="overlay">
            <div className="card">
              <h2>Something went wrong</h2>
              <p className="error">{message}</p>
              <button className="btn" onClick={() => void startGame()}>Try again</button>
            </div>
          </div>
        )}

        {confirmOpen && playing && (
          <div className="overlay">
            <div className="card" role="alertdialog" aria-labelledby="confirm-title">
              <h2 id="confirm-title">No hints left</h2>
              <p>You&apos;ve used all {maxHints} hints. If you ask for another one, this game ends and you&apos;ll have to start over.</p>
              <div className="row">
                <button className="btn secondary" onClick={() => setConfirmOpen(false)}>Keep playing</button>
                <button className="btn danger" onClick={() => void askHint()} disabled={busy}>Ask anyway (restart)</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="hint-bar" aria-live="polite">
        {hint ? (
          <>
            <span>
              💡 <strong>{hint}</strong>: {describeMove(hint)} (the face is lit up).
            </span>
            <button className="btn small" onClick={() => turn(hint)}>Do it</button>
          </>
        ) : message && playing ? (
          <span className="error">{message}</span>
        ) : (
          <span className="muted">Drag to look around. Keys: U D L R F B, hold Shift for counter-clockwise.</span>
        )}
      </div>

      <div className="controls">
        {FACES.map((f) => (
          <div key={f} className="move-pair">
            <button className="btn move" onClick={() => turn(f)} disabled={!playing} aria-label={`${f} clockwise`}>{f}</button>
            <button className="btn move" onClick={() => turn(`${f}'` as Move)} disabled={!playing} aria-label={`${f} counter-clockwise`}>{f}&apos;</button>
          </div>
        ))}
        <button
          className={outOfHints ? "btn danger hint-btn" : "btn hint-btn"}
          onClick={() => (outOfHints ? setConfirmOpen(true) : void askHint())}
          disabled={!playing || busy}
        >
          {outOfHints ? "No hints left" : `💡 Hint (${hintsLeft} left)`}
        </button>
      </div>
    </main>
  );
}
