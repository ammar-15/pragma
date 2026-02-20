import Recorder from "@/components/Recorder";
import Compare from "@/components/Compare";

export default function App() {
  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-2xl font-semibold">PRAGMA Demo</h1>
        <Recorder />
        <Compare />
      </div>
    </div>
  );
}
