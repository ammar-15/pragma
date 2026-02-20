import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Charts from "@/components/Charts";
import { Badge } from "@/components/ui/badge";

type Frame = {
  tMs: number;
  rightWrist: { x: number; y: number; v: number };
  elbowAngleDeg?: number;
};

type Session = {
  id: string;
  task: string;
  createdAt: string;
  durationMs: number;
  waveStartMs?: number;
  waveEndMs?: number;
  frames: Frame[];
};

function parseSession(fileText: string): Session {
  const data = JSON.parse(fileText);
  if (!data?.frames?.length) throw new Error("Invalid session JSON");
  return data as Session;
}

function sliceToWave(session: Session) {
  const lastT = session.frames.length
    ? session.frames[session.frames.length - 1].tMs
    : session.durationMs;

  const start = session.waveStartMs ?? session.frames[0]?.tMs ?? 0;
  let end = session.waveEndMs ?? lastT;

  // if waveEndMs is missing or broken (end before start), just use last frame
  if (end < start) end = lastT;

  const frames = session.frames
    .filter((f) => f.tMs >= start && f.tMs <= end)
    .filter((f) => (f.rightWrist?.v ?? 0) > 0.5)
    .sort((a, b) => a.tMs - b.tMs);

  return { frames, start, end };
}

function summarize(session: Session) {
  const sliced = sliceToWave(session);

  const frames = sliced.frames.filter((f) => (f.rightWrist?.v ?? 0) > 0.5);

  if (frames.length < 5) {
    return {
      ok: false as const,
      reason: "Not enough tracked frames in wave segment.",
    };
  }

  // normalize: use wrist positions only
  const xs = frames.map((f) => f.rightWrist.x);
  const ys = frames.map((f) => f.rightWrist.y);
  const ts = frames.map((f) => f.tMs);

  // range of motion (bbox size)
  const xRange = Math.max(...xs) - Math.min(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);
  const range = Math.sqrt(xRange * xRange + yRange * yRange);

  // speed: average distance per second
  let distSum = 0;
  let dtSum = 0;

  // smoothness: average "jerk" proxy (changes in velocity)
  let jerkSum = 0;
  let jerkCount = 0;

  let prev = frames[0];
  let prevVx = 0;
  let prevVy = 0;

  for (let i = 1; i < frames.length; i++) {
    const cur = frames[i];
    const dt = Math.max(1, cur.tMs - prev.tMs); // ms
    const dx = cur.rightWrist.x - prev.rightWrist.x;
    const dy = cur.rightWrist.y - prev.rightWrist.y;

    const d = Math.sqrt(dx * dx + dy * dy);
    distSum += d;
    dtSum += dt;

    // velocity
    const vx = dx / dt;
    const vy = dy / dt;

    // change in velocity (jerk proxy)
    const jx = vx - prevVx;
    const jy = vy - prevVy;
    jerkSum += Math.sqrt(jx * jx + jy * jy);
    jerkCount += 1;

    prevVx = vx;
    prevVy = vy;
    prev = cur;
  }

  const durationSec = (ts[ts.length - 1] - ts[0]) / 1000;
  const avgSpeed = durationSec > 0 ? distSum / durationSec : 0;
  const smoothness = jerkCount > 0 ? jerkSum / jerkCount : 0;

  return {
    ok: true as const,
    range,
    avgSpeed,
    smoothness,
    trackedFrames: frames.length,
    waveWindowMs: Math.max(0, sliced.end - sliced.start),
  };
}

function pctDiff(a: number, b: number) {
  // (b - a) / a
  if (Math.abs(a) < 1e-9) return 0;
  return ((b - a) / a) * 100;
}

function ratio(a: number, b: number) {
  if (a <= 1e-9) return 1;
  return b / a;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Turn raw values into a 0–100 score.
function qualityScore(summary: {
  avgSpeed: number;
  range: number;
  smoothness: number;
}) {
  const speedScore = clamp((summary.avgSpeed / 0.35) * 100, 0, 100); // cap at ~0.35
  const rangeScore = clamp((summary.range / 0.55) * 100, 0, 100); // cap at ~0.55

  // smoothness: lower is better. Map 0 -> 100, 0.002 -> 0
  const jitterScore = clamp(100 - (summary.smoothness / 0.002) * 100, 0, 100);

  // weighted blend (tweakable)
  return Math.round(speedScore * 0.4 + rangeScore * 0.35 + jitterScore * 0.25);
}

export default function Compare({
  fromFirebaseA,
  fromFirebaseB,
}: {
  fromFirebaseA?: any;
  fromFirebaseB?: any;
}) {
  const [a, setA] = useState<Session | null>(fromFirebaseA ?? null);
  const [b, setB] = useState<Session | null>(fromFirebaseB ?? null);

  useEffect(() => {
    if (fromFirebaseA) setA(fromFirebaseA);
    if (fromFirebaseB) setB(fromFirebaseB);
  }, [fromFirebaseA, fromFirebaseB]);

  const [err, setErr] = useState<string | null>(null);

  const summaryA = useMemo(() => (a ? summarize(a) : null), [a]);
  const summaryB = useMemo(() => (b ? summarize(b) : null), [b]);

  const loadFile = async (file: File, which: "a" | "b") => {
    try {
      setErr(null);
      const text = await file.text();
      const session = parseSession(text);
      if (which === "a") setA(session);
      else setB(session);
    } catch (e: any) {
      setErr(e?.message || "Failed to load file.");
    }
  };

  const canCompare = summaryA?.ok && summaryB?.ok;

  let speedDelta = 0;
  let rangeDelta = 0;
  let smoothDelta = 0;

  let speedRatio = 1;

  if (canCompare) {
    speedRatio = clamp(ratio(summaryA.avgSpeed, summaryB.avgSpeed), 0, 3); // cap at 3x just for sanity
    rangeDelta = clamp(pctDiff(summaryA.range, summaryB.range), -100, 100);
    smoothDelta = clamp(
      pctDiff(summaryA.smoothness, summaryB.smoothness),
      -100,
      100,
    );
  }

  let scoreA = 0;
  let scoreB = 0;

  if (canCompare) {
    scoreA = qualityScore(summaryA);
    scoreB = qualityScore(summaryB);
  }

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Compare Sessions</CardTitle>
        {canCompare ? (
          <Badge>Ready</Badge>
        ) : (
          <Badge variant="secondary">Load 2 files</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="space-y-1">
            <div className="text-sm font-medium">Session A</div>
            <input
              type="file"
              accept="application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f, "a");
              }}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Session B</div>
            <input
              type="file"
              accept="application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f, "b");
              }}
            />
          </div>

          {a && <Badge variant="outline">A loaded</Badge>}
          {b && <Badge variant="outline">B loaded</Badge>}
        </div>

        {err && <div className="text-sm text-red-500">{err}</div>}

        {summaryA && summaryA.ok && (
          <div className="text-sm text-muted-foreground">
            A: {summaryA.trackedFrames} frames (wave{" "}
            {Math.round(summaryA.waveWindowMs)}ms)
          </div>
        )}
        {summaryB && summaryB.ok && (
          <div className="text-sm text-muted-foreground">
            B: {summaryB.trackedFrames} frames (wave{" "}
            {Math.round(summaryB.waveWindowMs)}ms)
          </div>
        )}

        {!canCompare && (
          <div className="text-sm text-muted-foreground">
            Upload two session JSON files to compare.
          </div>
        )}

        {canCompare && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Speed A: {summaryA.avgSpeed.toFixed(4)} units/sec • Speed B:{" "}
              {summaryB.avgSpeed.toFixed(4)} units/sec
            </div>
            <div className="flex items-center gap-3">
              <Badge className="text-base py-1 px-3">A Score: {scoreA}</Badge>
              <Badge className="text-base py-1 px-3">B Score: {scoreB}</Badge>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant="secondary">Speed: {speedRatio.toFixed(2)}×</Badge>
              <Badge variant="secondary">Range: {rangeDelta.toFixed(1)}%</Badge>
              <Badge variant="secondary">
                Jitter: {smoothDelta.toFixed(1)}%
              </Badge>
            </div>

            <div className="text-sm">
              {speedRatio > 1.08
                ? "B looks faster."
                : speedRatio < 0.92
                  ? "B looks slower."
                  : "Speed looks similar."}{" "}
              {rangeDelta < -8
                ? "B has smaller movement range."
                : rangeDelta > 8
                  ? "B has larger movement range."
                  : "Range looks similar."}{" "}
              {smoothDelta > 10
                ? "B looks more shaky."
                : smoothDelta < -10
                  ? "B looks smoother."
                  : "Smoothness looks similar."}
            </div>

            <Button
              variant="outline"
              onClick={() => {
                setA(null);
                setB(null);
                setErr(null);
              }}
            >
              Reset
            </Button>
          </div>
        )}
        {a && b && <Charts a={a} b={b} />}
      </CardContent>
    </Card>
  );
}
