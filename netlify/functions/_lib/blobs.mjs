import { getStore } from "@netlify/blobs";

export const CONTENT_STORE = "prolyrics-content";
export const MEDIA_STORE = "prolyrics-media";
export const CHUNK_STORE = "prolyrics-chunks";

export const contentStore = () => getStore(CONTENT_STORE);
export const mediaStore = () => getStore(MEDIA_STORE);
export const chunkStore = () => getStore(CHUNK_STORE);

export async function readJSON(store, key, fallback) {
  const value = await store.get(key, { type: "json", consistency: "strong" });
  return value === null || value === undefined ? fallback : value;
}

export async function writeJSON(store, key, value) {
  return store.setJSON(key, value);
}
