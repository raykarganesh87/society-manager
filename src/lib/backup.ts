// Backup format "SSB1": text = "SSB1." + sha256(hex) + "." + base64(gzip(database bytes)).
// The same text works as a file (.ssbackup) and as copy/paste text.
import { fromBase64, toBase64 } from "./storage";

const PREFIX = "SSB1";
const SQLITE_MAGIC = "SQLite format 3\u0000";

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(t as unknown as ReadableWritablePair);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function encodeBackup(dbBytes: Uint8Array): Promise<string> {
  const gz = await pipe(dbBytes, new CompressionStream("gzip"));
  return `${PREFIX}.${await sha256Hex(gz)}.${toBase64(gz)}`;
}

export class BackupError extends Error {}

export async function decodeBackup(textRaw: string): Promise<Uint8Array> {
  const text = textRaw.replace(/\s+/g, "");
  const [prefix, hash, b64] = text.split(".");
  if (prefix !== PREFIX || !hash || !b64) throw new BackupError("This is not a Society Manager backup.");
  let gz: Uint8Array;
  try {
    gz = fromBase64(b64);
  } catch {
    throw new BackupError("The backup text is damaged or cut off. Copy it again in full.");
  }
  if ((await sha256Hex(gz)) !== hash) throw new BackupError("The backup is incomplete or damaged. Copy or send it again in full.");
  const bytes = await pipe(gz, new DecompressionStream("gzip"));
  if (new TextDecoder().decode(bytes.subarray(0, 16)) !== SQLITE_MAGIC) throw new BackupError("The backup does not contain a valid database.");
  return bytes;
}
