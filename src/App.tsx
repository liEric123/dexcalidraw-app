import { useState } from "react";
import { migrateOldStorageKey, seedDemoPresentationIfFirstRun } from "./lib/storage";
import EditorApp from "./EditorApp";
import PresentationsHome from "./components/PresentationsHome";

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    migrateOldStorageKey();
    seedDemoPresentationIfFirstRun();
    return null;
  });

  if (selectedId) {
    return (
      <EditorApp
        key={selectedId}
        presentationId={selectedId}
        onHome={() => setSelectedId(null)}
      />
    );
  }

  return <PresentationsHome onOpen={setSelectedId} />;
}
