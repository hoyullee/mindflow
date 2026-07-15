// Supabase Realtime broadcast payloads travel as JSON, which has no binary
// type — Yjs updates (`Uint8Array`) are base64-encoded for the wire and
// decoded back on receipt. Chunked to avoid blowing `String.fromCharCode`'s
// argument-count limits on large updates (`btoa`/`atob` only, no Node
// `Buffer` — this runs in the browser).

const CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
