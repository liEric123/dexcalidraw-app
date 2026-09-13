import { useState } from "react";
import { migrateOldStorageKey } from "./lib/storage";
import EditorApp from "./EditorApp";
import PresentationsHome from "./components/PresentationsHome";

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    migrateOldStorageKey();
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
