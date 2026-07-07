import type { Song } from "$lib/ipc/messages";

// Reactive library state, replaced wholesale from each library.songs snapshot.
// lastImportError surfaces the most recent failed import (file or URL) in the
// library UI; cleared when a new import starts.
export const library = $state<{
  songs: Song[];
  lastImportError: { path: string; error: string } | null;
}>({ songs: [], lastImportError: null });

// Snapshot lookup by id; null for null/unknown ids. Lives here so components
// never join stores themselves.
export function songById(id: string | null): Song | null {
  return library.songs.find((s) => s.id === id) ?? null;
}
