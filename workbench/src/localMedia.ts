import { useEffect, useState } from "react";

export const LOCAL_VIDEO_PREFIX = "local-video:";
export const LOCAL_AUDIO_PREFIX = "local-audio:";
const DB_NAME = "shotcraft-workbench-local-media";
const DB_VERSION = 1;
const META_STORE = "videos";
const BLOB_STORE = "video-blobs";

export interface LocalVideoAsset {
  id: string;
  name: string;
  type: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  addedAt: number;
}
export interface LocalAudioAsset {
  id: string;
  name: string;
  type: string;
  size: number;
  duration: number;
  addedAt: number;
}

const urlCache = new Map<string, Promise<string | null>>();

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === "undefined") {
    reject(new Error("Browser storage is unavailable."));
    return;
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
    if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("Could not open browser storage."));
});

export const localVideoRef = (id: string) => `${LOCAL_VIDEO_PREFIX}${id}`;
export const isLocalVideoRef = (file: string) => file.startsWith(LOCAL_VIDEO_PREFIX);
export const localVideoId = (file: string) => file.slice(LOCAL_VIDEO_PREFIX.length);
export const localAudioRef = (id: string) => `${LOCAL_AUDIO_PREFIX}${id}`;
export const isLocalAudioRef = (file: string) => file.startsWith(LOCAL_AUDIO_PREFIX);
export const localAudioId = (file: string) => file.slice(LOCAL_AUDIO_PREFIX.length);
export const isLocalMediaRef = (file: string) => isLocalVideoRef(file) || isLocalAudioRef(file);
export const localMediaId = (file: string) => isLocalAudioRef(file) ? localAudioId(file) : localVideoId(file);

export const readVideoMetadata = (file: File): Promise<Pick<LocalVideoAsset, "duration" | "width" | "height">> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const metadata = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
        reject(new Error("Could not read the video duration."));
      } else {
        resolve(metadata);
      }
    };
    video.onerror = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      reject(new Error("This video format could not be opened in the browser."));
    };
    video.src = url;
  });
export const readAudioMetadata = (file: File): Promise<Pick<LocalAudioAsset, "duration">> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      if (!Number.isFinite(duration) || duration <= 0) reject(new Error("Could not read the audio duration."));
      else resolve({ duration });
    };
    audio.onerror = () => {
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      reject(new Error("This audio format could not be opened in the browser."));
    };
    audio.src = url;
  });

export const saveLocalVideo = async (file: File, metadata: Pick<LocalVideoAsset, "duration" | "width" | "height">) => {
  const id = crypto.randomUUID();
  const asset: LocalVideoAsset = {
    id,
    name: file.name,
    type: file.type || "video/*",
    size: file.size,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    addedAt: Date.now(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(META_STORE).put(asset);
    tx.objectStore(BLOB_STORE).put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save the video in this browser."));
    tx.onabort = () => reject(tx.error ?? new Error("Could not save the video in this browser."));
  }).finally(() => db.close());
  return asset;
};

export const saveLocalAudio = async (file: File, metadata: Pick<LocalAudioAsset, "duration">) => {
  const id = crypto.randomUUID();
  const asset: LocalAudioAsset = {
    id,
    name: file.name,
    type: file.type || "audio/*",
    size: file.size,
    duration: metadata.duration,
    addedAt: Date.now(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(META_STORE).put({ ...asset, kind: "audio", width: 0, height: 0 });
    tx.objectStore(BLOB_STORE).put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save the audio in this browser."));
    tx.onabort = () => reject(tx.error ?? new Error("Could not save the audio in this browser."));
  }).finally(() => db.close());
  return asset;
};

export const listLocalVideos = async (): Promise<LocalVideoAsset[]> => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(META_STORE, "readonly").objectStore(META_STORE).getAll();
      request.onsuccess = () => resolve((request.result as Array<LocalVideoAsset & { kind?: string }>)
        .filter((asset) => asset.kind !== "audio")
        .sort((a, b) => a.addedAt - b.addedAt));
      request.onerror = () => reject(request.error ?? new Error("Could not read local videos."));
    });
  } finally {
    db.close();
  }
};

export const listLocalAudios = async (): Promise<LocalAudioAsset[]> => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(META_STORE, "readonly").objectStore(META_STORE).getAll();
      request.onsuccess = () => resolve((request.result as Array<LocalAudioAsset & { kind?: string }>)
        .filter((asset) => asset.kind === "audio")
        .sort((a, b) => a.addedAt - b.addedAt));
      request.onerror = () => reject(request.error ?? new Error("Could not read local audio."));
    });
  } finally {
    db.close();
  }
};

export const getLocalVideoBlob = async (id: string): Promise<Blob | null> => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(BLOB_STORE, "readonly").objectStore(BLOB_STORE).get(id);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read the local video."));
    });
  } finally {
    db.close();
  }
};

export const getLocalAudioBlob = getLocalVideoBlob;
export const getLocalMediaBlob = getLocalVideoBlob;

export const getLocalVideoUrl = (id: string): Promise<string | null> => {
  const cached = urlCache.get(id);
  if (cached) return cached;
  const pending = getLocalVideoBlob(id).then((blob) => blob ? URL.createObjectURL(blob) : null).catch(() => null);
  urlCache.set(id, pending);
  return pending;
};

export const removeLocalVideo = async (id: string) => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
      tx.objectStore(META_STORE).delete(id);
      tx.objectStore(BLOB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not remove the local video."));
      tx.onabort = () => reject(tx.error ?? new Error("Could not remove the local video."));
    });
    const url = await urlCache.get(id);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(id);
  } finally {
    db.close();
  }
};

export const useLocalVideoUrl = (file: string) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isLocalVideoRef(file)) {
      setUrl(null);
      return;
    }
    let active = true;
    setUrl(null);
    getLocalVideoUrl(localVideoId(file)).then((next) => {
      if (active) setUrl(next);
    });
    return () => { active = false; };
  }, [file]);
  return url;
};

export const useLocalMediaUrl = (file: string) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isLocalMediaRef(file)) {
      setUrl(null);
      return;
    }
    let active = true;
    setUrl(null);
    getLocalVideoUrl(localMediaId(file)).then((next) => {
      if (active) setUrl(next);
    });
    return () => { active = false; };
  }, [file]);
  return url;
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const pending of urlCache.values()) pending.then((url) => { if (url) URL.revokeObjectURL(url); });
    urlCache.clear();
  });
}
