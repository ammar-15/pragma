import { useEffect, useRef, useState } from "react";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function WebcamView({
  const data = sessionRef.current;
sessionRef.current = null;

onClipSaved?.(data);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);

  const recordingRef = useRef(false);
  const sessionRef = useRef<any>(null);
  const recordStartRef = useRef<number>(0);

  const waveActiveRef = useRef(false);
  const waveStartMsRef = useRef<number | null>(null);
  const lastWristXRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordMsLeft, setRecordMsLeft] = useState(0);

  const [isAligned, setIsAligned] = useState(false);
  const [holdMs, setHoldMs] = useState(0);
  const [ready, setReady] = useState(false);

  const [status, setStatus] = useState<"starting" | "running" | "error">(
    "starting",
  );
  const [error, setError] = useState<string | null>(null);

  const startRecording = () => {
    if (!ready || isRecording) return;

    const durationMs = 5000;

    setIsRecording(true);
    setRecordMsLeft(durationMs);

    recordingRef.current = true;
    recordStartRef.current = performance.now();

    sessionRef.current = {
      id: `session_${new Date().toISOString()}`,
      task: "right_arm_wave",
      createdAt: new Date().toISOString(),
      durationMs,
      frames: [],
    };
    waveActiveRef.current = false;
    waveStartMsRef.current = null;
    lastWristXRef.current = null;

    if (sessionRef.current) sessionRef.current.__quietCount = 0;

    // stop after 5s
    window.setTimeout(async () => {
      recordingRef.current = false;
      setIsRecording(false);
      setRecordMsLeft(0);

      const data = sessionRef.current;
      sessionRef.current = null;

      // 1) save to Firestore
      try {
        await addDoc(collection(db, "sessions"), {
          createdAt: data.createdAt,
          task: data.task,
          durationMs: data.durationMs,
          waveStartMs: data.waveStartMs ?? null,
          waveEndMs: data.waveEndMs ?? null,
          frames: data.frames,
        });
      } catch (e) {
        console.error("Firestore save failed:", e);
      }

      // 2) still download JSON (optional)
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.id}.json`;
      onSaved?.(`${data.id}.json`);
      a.click();
      URL.revokeObjectURL(url);
    }, durationMs);
  };

  useEffect(() => {
    const start = async () => {
      try {
        setStatus("starting");
        setError(null);

        // --- 1) Start webcam stream once ---
        if (!streamRef.current) {
          streamRef.current = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: "user",
            },
            audio: false,
          });
        }

        const videoEl = videoRef.current;
        if (!videoEl) return;

        // attach stream only if needed
        if (videoEl.srcObject !== streamRef.current) {
          videoEl.srcObject = streamRef.current;
        }

        // wait until video has data
        if (videoEl.readyState < 2) {
          await new Promise<void>((resolve) => {
            const onReady = () => {
              videoEl.removeEventListener("loadeddata", onReady);
              resolve();
            };
            videoEl.addEventListener("loadeddata", onReady);
          });
        }

        // play once (avoid Chrome overlay message)
        if (videoEl.paused) {
          await videoEl.play().catch(() => {});
        }

        // --- 2) Load MediaPipe + model ---
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm",
        );

        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });

        // --- 3) Draw loop ---
        const canvasEl = canvasRef.current;
        if (!canvasEl) return;

        const ctx = canvasEl.getContext("2d");
        if (!ctx) return;

        const drawingUtils = new DrawingUtils(ctx);

        const loop = () => {
          const lm = landmarkerRef.current;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!lm || !v || !c) return;

          const w = v.videoWidth;
          const h = v.videoHeight;

          if (w && h) {
            if (c.width !== w) c.width = w;
            if (c.height !== h) c.height = h;
          }

          ctx.clearRect(0, 0, c.width, c.height);

          const nowMs = performance.now();
          const result = lm.detectForVideo(v, nowMs);

          // -----------------------------
          // 1) RECORDING (trim to wave)
          // -----------------------------
          if (recordingRef.current) {
            const elapsed = nowMs - recordStartRef.current;
            const left = Math.max(0, 5000 - elapsed);
            setRecordMsLeft(left);

            const lm0 = result?.landmarks?.[0];
            if (lm0) {
              const rs = lm0[12];
              const re = lm0[14];
              const rw = lm0[16];

              const wristX = 1 - rw.x; // mirrored
              const wristY = rw.y;

              const prevX = lastWristXRef.current;
              lastWristXRef.current = wristX;
              const moved = prevX !== null ? Math.abs(wristX - prevX) : 0;

              const WAVE_START_THRESHOLD = 0.008;

              if (!waveActiveRef.current && moved > WAVE_START_THRESHOLD) {
                waveActiveRef.current = true;
                waveStartMsRef.current = elapsed;
                sessionRef.current.waveStartMs = Math.round(elapsed);
                sessionRef.current.__quietCount = 0;
              }

              if (waveActiveRef.current) {
                const angleDeg = (() => {
                  const ax = rs.x - re.x,
                    ay = rs.y - re.y;
                  const bx = rw.x - re.x,
                    by = rw.y - re.y;
                  const dot = ax * bx + ay * by;
                  const amag = Math.sqrt(ax * ax + ay * ay);
                  const bmag = Math.sqrt(bx * bx + by * by);
                  const cos = dot / Math.max(1e-6, amag * bmag);
                  const clamped = Math.max(-1, Math.min(1, cos));
                  return (Math.acos(clamped) * 180) / Math.PI;
                })();

                sessionRef.current.frames.push({
                  tMs: Math.round(elapsed),
                  rightShoulder: { x: rs.x, y: rs.y, v: rs.visibility ?? 0 },
                  rightElbow: { x: re.x, y: re.y, v: re.visibility ?? 0 },
                  rightWrist: { x: wristX, y: wristY, v: rw.visibility ?? 0 },
                  elbowAngleDeg: Number(angleDeg.toFixed(2)),
                });

                const WAVE_END_THRESHOLD = 0.003;
                const QUIET_FRAMES = 18;

                const quietCount = (sessionRef.current.__quietCount ??
                  0) as number;
                const nextQuiet =
                  moved < WAVE_END_THRESHOLD ? quietCount + 1 : 0;
                sessionRef.current.__quietCount = nextQuiet;

                if (nextQuiet >= QUIET_FRAMES) {
                  waveActiveRef.current = false;
                  sessionRef.current.waveEndMs = Math.round(elapsed);
                }
              }
            }
          }

          // -----------------------------
          // 2) READY GATE (box + hold)
          // -----------------------------
          const target = { x1: 0.62, y1: 0.3, x2: 0.9, y2: 0.75 };

          // draw target box (readable, not mirrored)
          ctx.save();
          ctx.strokeStyle = ready
            ? "rgba(34,197,94,0.9)"
            : "rgba(255,255,255,0.8)";
          ctx.lineWidth = 3;
          ctx.strokeRect(
            target.x1 * c.width,
            target.y1 * c.height,
            (target.x2 - target.x1) * c.width,
            (target.y2 - target.y1) * c.height,
          );
          ctx.restore();

          if (!result?.landmarks?.length) {
            setIsAligned(false);
            setHoldMs(0);
            setReady(false);
          } else {
            const lm0 = result.landmarks[0];
            const rightWrist = lm0[16];
            const rightElbow = lm0[14];
            const rightShoulder = lm0[12];

            const wristX = 1 - rightWrist.x; // mirrored for selfie view
            const wristY = rightWrist.y;

            const confOk =
              (rightWrist?.visibility ?? 0) > 0.5 &&
              (rightElbow?.visibility ?? 0) > 0.5 &&
              (rightShoulder?.visibility ?? 0) > 0.5;

            const inside =
              confOk &&
              wristX >= target.x1 &&
              wristX <= target.x2 &&
              wristY >= target.y1 &&
              wristY <= target.y2;

            const last = (c as any).__lastWrist as
              | { x: number; y: number; t: number }
              | undefined;
            const now = { x: wristX, y: wristY, t: nowMs };

            let stable = false;
            if (last) {
              const dx = now.x - last.x;
              const dy = now.y - last.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              stable = dist < 0.015; // slightly less strict
            }

            (c as any).__lastWrist = now;

            const alignedNow = inside && stable;
            setIsAligned(alignedNow);

            setHoldMs((prev) => {
              const next = alignedNow ? Math.min(2000, prev + 16) : 0;
              const isReadyNow = next >= 2000;
              setReady(isReadyNow);
              return next;
            });

            ctx.save();
            ctx.font = "bold 22px system-ui";
            ctx.fillStyle = ready
              ? "rgba(34,197,94,0.95)"
              : "rgba(255,255,255,0.9)";
            const msg = ready
              ? "READY"
              : alignedNow
                ? `HOLD… ${Math.ceil((2000 - holdMs) / 100) / 10}s`
                : "MOVE RIGHT HAND INTO BOX";
            ctx.fillText(msg, 18, 34);
            ctx.restore();
          }

          // -----------------------------
          // 3) DRAW POSE (mirrored to match video)
          // -----------------------------
          ctx.save();
          ctx.translate(canvasEl.width, 0);
          ctx.scale(-1, 1);

          if (result?.landmarks?.length) {
            const landmarks = result.landmarks[0];
            drawingUtils.drawLandmarks(landmarks, { radius: 3 });
            drawingUtils.drawConnectors(
              landmarks,
              PoseLandmarker.POSE_CONNECTIONS,
            );
          }

          ctx.restore();

          rafRef.current = requestAnimationFrame(loop);
        };

        setStatus("running");
        loop();
      } catch (e: any) {
        setStatus("error");
        setError(e?.message || "Pose failed to start.");
      }
    };

    start();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;

      landmarkerRef.current?.close();
      landmarkerRef.current = null;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Webcam + Pose</CardTitle>
        {status === "running" ? (
          <Badge>Tracking</Badge>
        ) : status === "error" ? (
          <Badge variant="destructive">Error</Badge>
        ) : (
          <Badge variant="secondary">Loading…</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Button onClick={startRecording} disabled={!ready || isRecording}>
            {isRecording ? "Recording…" : "Record 5s"}
          </Button>

          {isRecording && (
            <Badge variant="secondary">
              {Math.ceil(recordMsLeft / 100) / 10}s left
            </Badge>
          )}

          {!ready && (
            <span className="text-sm text-muted-foreground">
              Get READY first.
            </span>
          )}
        </div>

        <div className="relative w-full overflow-hidden rounded-xl bg-black aspect-video">
          <video
            ref={videoRef}
            muted
            playsInline
            controls={false}
            className="absolute inset-0 h-full w-full object-cover -scale-x-100"
          />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

          {status !== "running" && !error && (
            <div className="absolute inset-0 grid place-items-center text-white/90">
              Loading pose tracker…
            </div>
          )}

          {error && (
            <div className="absolute inset-0 grid place-items-center text-white/90 text-center p-4">
              {error}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
