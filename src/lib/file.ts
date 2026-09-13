export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Decodes a data URL into a Blob. Used to migrate legacy persisted video data
// URLs (localStorage decks and old IndexedDB string records) to Blob storage.
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma === -1 || !dataUrl.startsWith("data:")) {
    throw new Error("Malformed data URL");
  }
  const meta = dataUrl.slice(5, comma).split(";");
  const mimeType = meta[0];
  const payload = dataUrl.slice(comma + 1);
  if (!meta.includes("base64")) {
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
