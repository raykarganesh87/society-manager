// Where the database file lives. Android: app-private storage. Windows: the user's AppData folder.
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Clipboard } from "@capacitor/clipboard";

declare global {
  interface Window {
    electronAPI?: {
      read(name: string): Promise<Uint8Array | null>;
      write(name: string, bytes: Uint8Array): Promise<void>;
      saveAs(suggestedName: string, text: string): Promise<boolean>;
    };
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const isNative = () => Capacitor.isNativePlatform();

export async function readFile(name: string): Promise<Uint8Array | null> {
  if (window.electronAPI) return window.electronAPI.read(name);
  if (isNative()) {
    try {
      const r = await Filesystem.readFile({ path: name, directory: Directory.Data });
      return fromBase64(r.data as string);
    } catch {
      return null;
    }
  }
  // Plain browser (development only): keep the file in localStorage.
  const v = localStorage.getItem("dev:" + name);
  return v ? fromBase64(v) : null;
}

export async function writeFile(name: string, bytes: Uint8Array): Promise<void> {
  if (window.electronAPI) return window.electronAPI.write(name, bytes);
  if (isNative()) {
    await Filesystem.writeFile({ path: name, directory: Directory.Data, data: toBase64(bytes) });
    return;
  }
  localStorage.setItem("dev:" + name, toBase64(bytes));
}

export async function copyText(text: string): Promise<void> {
  if (isNative()) await Clipboard.write({ string: text });
  else await navigator.clipboard.writeText(text);
}

/** Save a backup file: share sheet on Android, "Save as" dialog on Windows, download in a browser. */
export async function exportTextFile(name: string, text: string): Promise<void> {
  if (window.electronAPI) {
    await window.electronAPI.saveAs(name, text);
  } else if (isNative()) {
    const r = await Filesystem.writeFile({ path: name, directory: Directory.Cache, data: text, encoding: "utf8" as never });
    await Share.share({ title: name, url: r.uri, dialogTitle: name });
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = name;
    a.click();
  }
}
