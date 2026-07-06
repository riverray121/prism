import type { Song } from "$lib/ipc/messages";

// Reactive library state, replaced wholesale from each library.songs snapshot.
export const library = $state<{ songs: Song[] }>({ songs: [] });

// Snapshot lookup by id; null for null/unknown ids. Lives here so components
// never join stores themselves.
export function songById(id: string | null): Song | null {
  return library.songs.find((s) => s.id === id) ?? null;
}
