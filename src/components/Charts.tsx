import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

type Frame = {
  tMs: number;
  rightWrist: { x: number; y: number; v: number };
  elbowAngleDeg?: number;
};

type Session = {
  id: string;
  waveStartMs?: number;
  waveEndMs?: number;
  frames: Frame[];
  durationMs: number;
};

function sliceToWave(session: Session) {
  const lastT = session.frames.length
    ? session.frames[session.frames.length - 1].tMs
    : session.durationMs;

  const start = session.waveStartMs ?? session.frames[0]?.tMs ?? 0;
  let end = session.waveEndMs ?? lastT;

  if (end < start) end = lastT;

  const frames = session.frames
    .filter((f) => f.tMs >= start && f.tMs <= end)
    .filter((f) => (f.rightWrist?.v ?? 0) > 0.5)
    .sort((a, b) => a.tMs - b.tMs);

  return { frames, start, end };
}

export default function Charts({ a, b }: { a: Session; b: Session }) {
  const [metric, setMetric] = useState<"wristX" | "wristY" | "elbowAngle">(
    "wristX",
  );

  function pad(values: number[], len: number) {
    return values.concat(Array(Math.max(0, len - values.length)).fill(null));
  }

  const { labels, aVals, bVals, maxLen } = useMemo(() => {
    const sa = sliceToWave(a);
    const sb = sliceToWave(b);

    const getVal = (f: Frame) => {
      if (metric === "wristX") return f.rightWrist.x;
      if (metric === "wristY") return f.rightWrist.y;
      return f.elbowAngleDeg ?? 0;
    };

    // build full arrays (NO slicing to min)
    const aVals = sa.frames.map(getVal);
    const bVals = sb.frames.map(getVal);

    const maxLen = Math.max(aVals.length, bVals.length);
    const labels = Array.from({ length: maxLen }, (_, i) => i);

    return { labels, aVals, bVals, maxLen };
  }, [a, b, metric]);

  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Session A",
          data: pad(aVals, maxLen),
          borderColor: "rgb(59,130,246)",
          backgroundColor: "rgba(59,130,246,0.15)",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.25,
          spanGaps: false,
        },
        {
          label: "Session B",
          data: pad(bVals, maxLen),
          borderColor: "rgb(34,197,94)",
          backgroundColor: "rgba(34,197,94,0.15)",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.25,
          spanGaps: false,
        },
      ],
    }),
    [labels, aVals, bVals, maxLen],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
        tooltip: { enabled: true },
      },
      scales: {
        x: {
          grid: { color: "rgba(0,0,0,0.05)" },
          title: { display: true, text: "Frame index (normalized)" },
        },
        y: {
          grid: { color: "rgba(0,0,0,0.05)" },
          title: {
            display: true,
            text:
              metric === "elbowAngle"
                ? "Elbow angle (deg)"
                : metric === "wristX"
                  ? "Wrist X (0..1)"
                  : "Wrist Y (0..1)",
          },
        },
      },
    }),
    [metric],
  );

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Session Graph</CardTitle>

        <div className="flex gap-2">
          <Button
            variant={metric === "wristX" ? "default" : "outline"}
            onClick={() => setMetric("wristX")}
          >
            Wrist X
          </Button>
          <Button
            variant={metric === "wristY" ? "default" : "outline"}
            onClick={() => setMetric("wristY")}
          >
            Wrist Y
          </Button>
          <Button
            variant={metric === "elbowAngle" ? "default" : "outline"}
            onClick={() => setMetric("elbowAngle")}
          >
            Elbow Angle
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="h-[320px] w-full">
          <Line data={data} options={options} />
        </div>
      </CardContent>
    </Card>
  );
}
