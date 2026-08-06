import type { Song } from "$lib/ipc/messages";

// Reactive library state, replaced wholesale from each library.songs snapshot.
// lastImportError surfaces the most recent failed import (file or URL) in the
// library UI; cleared when a new import starts.
export const library = $state<{
  songs: Song[];
  // False until the sidecar's first songs snapshot lands (renders as loading,
  // so an empty song list isn't mistaken for "no songs imported").
  loaded: boolean;
  lastImportError: { path: string; error: string } | null;
  // URLs with a download in flight (sidecar import_started → import_finished).
  pendingImports: string[];
}>({ songs: [], loaded: false, lastImportError: null, pendingImports: [] });

// Snapshot lookup by id; null for null/unknown ids. Lives here so components
// never join stores themselves.
export function songById(id: string | null): Song | null {
  return library.songs.find((s) => s.id === id) ?? null;
}
