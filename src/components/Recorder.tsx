import { useState } from "react";
import WebcamView from "@/components/WebcamView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Recorder() {
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <CardTitle>Record Session</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <WebcamView onSaved={(filename) => setLastSaved(filename)} />
        {lastSaved && (
          <div className="text-sm text-muted-foreground">
            Saved: <span className="font-medium">{lastSaved}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
