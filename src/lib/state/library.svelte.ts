import type { Song } from "$lib/ipc/messages";

// Reactive library state, replaced wholesale from each library.songs snapshot.
export const library = $state<{ songs: Song[] }>({ songs: [] });
