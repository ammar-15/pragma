import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import WebcamView from "@/components/WebcamView";
import Compare from "@/components/Compare";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ClipDoc = any;

export default function SessionRunner() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clipCount, setClipCount] = useState<0 | 1 | 2>(0);
  const [clips, setClips] = useState<ClipDoc[]>([]);
  const [status, setStatus] = useState<"idle" | "recording" | "saving" | "ready_to_compare">("idle");

  const startNewSession = async () => {
    setStatus("saving");
    setClips([]);
    setClipCount(0);

    const sessionRef = await addDoc(collection(db, "sessions"), {
      createdAt: serverTimestamp(),
      status: "in_progress",
    });

    setSessionId(sessionRef.id);
    setStatus("recording");
  };

  const saveClipToFirestore = async (clipData: any) => {
    if (!sessionId) return;

    setStatus("saving");

    await addDoc(collection(db, "sessions", sessionId, "clips"), {
      createdAt: serverTimestamp(),
      clipIndex: clipCount + 1,
      ...clipData,
    });

    const nextCount = (clipCount + 1) as 1 | 2;
    setClipCount(nextCount);

    if (nextCount === 2) {
      // load the 2 clips back from Firestore and compare
      const q = query(
        collection(db, "sessions", sessionId, "clips"),
        orderBy("clipIndex", "asc"),
        limit(2)
      );

      const snap = await getDocs(q);
      const loaded = snap.docs.map((d) => d.data());
      setClips(loaded);
      setStatus("ready_to_compare");
    } else {
      setStatus("recording");
    }
  };

  const clearComparison = () => {
    setClips([]);
    setClipCount(0);
    setSessionId(null);
    setStatus("idle");
  };

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Session Runner</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {sessionId ? `Session: ${sessionId.slice(0, 6)}…` : "No session"}
          </Badge>
          <Badge>{clipCount}/2 clips</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {status === "idle" && (
          <Button onClick={startNewSession}>
            Start New Session (2 clips)
          </Button>
        )}

        {status !== "idle" && status !== "ready_to_compare" && (
          <div className="text-sm text-muted-foreground">
            {clipCount === 0
              ? "Clip 1: Get ready and hold your hand in the box. Recording will run automatically."
              : "Clip 2: Same movement again. Recording will run automatically."}
          </div>
        )}

        {status !== "idle" && status !== "ready_to_compare" && (
          <WebcamView
            onClipSaved={(clipData) => saveClipToFirestore(clipData)}
          />
        )}

        {status === "ready_to_compare" && clips.length === 2 && (
          <>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={clearComparison}>Clear</Button>
              <Button onClick={startNewSession}>New Session</Button>
            </div>

            {/* Reuse your Compare component but feed it 2 sessions directly */}
            <Compare fromFirebaseA={clips[0]} fromFirebaseB={clips[1]} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
