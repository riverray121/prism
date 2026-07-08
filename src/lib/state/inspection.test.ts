import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "$lib/ipc/messages";

const ipc = vi.hoisted(() => ({
  getMapping: vi.fn(),
  getProfile: vi.fn(),
  updateFavorites: vi.fn(),
  updateMapping: vi.fn(),
}));
vi.mock("$lib/ipc", () => ipc);

// The transport is its own unit (transport.test.ts); here only the calls
// inspection makes into it are asserted.
const transport = vi.hoisted(() => ({
  resetForSong: vi.fn(),
  switchSource: vi.fn(),
  toggleSource: vi.fn(),
}));
vi.mock("$lib/state/transport.svelte", () => transport);

import {
  backToMix,
  close,
  favoriteResolves,
  inspection,
  isFavorite,
  open,
  pathForKey,
  playToggle,
  sidecarPath,
  toggleFavorite,
} from "./inspection.svelte";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    schema_version: "0.3.0",
    song: {
      id: "s1",
      title: "Title",
      artist: "Artist",
      duration_sec: 12.5,
      sample_rate: 44100,
      source_file: "t.wav",
      imported_at: "2026-01-01",
      analyzed_at: "2026-01-02",
    },
    timeline: { frame_rate_hz: 50, frame_count: 625 },
    mix: {
      tempo: {
        render: "scalar",
        category: "rhythm",
        source: "librosa",
        unit: "bpm",
        value: 120,
      },
    },
    stems: {
      htdemucs_ft: {
        drums: {
          audio_file: "stems/htdemucs_ft/drums.wav",
          features: {},
          substems: {
            kick: { audio_file: "stems/htdemucs_ft/kick.wav", features: {} },
          },
        },
        bass: { audio_file: "stems/htdemucs_ft/bass.wav", features: {} },
      },
    },
    favorites: [],
    ...overrides,
  };
}

// Put a loaded song into the store, as the profile event handler would.
function loadSong(profile = makeProfile()): Profile {
  inspection.songId = "s1";
  inspection.profile = profile;
  inspection.audioPath = "/music/t.wav";
  inspection.songDir = "/library/s1";
  return profile;
}

beforeEach(() => {
  vi.clearAllMocks();
  inspection.songId = null;
  inspection.profile = null;
  inspection.audioPath = null;
  inspection.songDir = null;
});

describe("open / close", () => {
  it("open clears the previous song, silences playback, and requests the profile", () => {
    loadSong();
    open("s2");
    expect(inspection.songId).toBe("s2");
    expect(inspection.profile).toBeNull();
    expect(inspection.audioPath).toBeNull();
    expect(inspection.songDir).toBeNull();
    expect(transport.resetForSong).toHaveBeenCalledWith(null, 0);
    expect(ipc.getProfile).toHaveBeenCalledWith("s2");
    expect(ipc.getMapping).toHaveBeenCalledWith("s2");
  });

  it("close empties the store and silences playback", () => {
    loadSong();
    close();
    expect(inspection.songId).toBeNull();
    expect(inspection.profile).toBeNull();
    expect(transport.resetForSong).toHaveBeenCalledWith(null, 0);
    expect(ipc.getProfile).not.toHaveBeenCalled();
  });
});

describe("pathForKey", () => {
  it("resolves mix, stem, and drum sub-stem keys to absolute paths", () => {
    loadSong();
    expect(pathForKey("mix")).toBe("/music/t.wav");
    expect(pathForKey("htdemucs_ft::bass")).toBe(
      "/library/s1/stems/htdemucs_ft/bass.wav",
    );
    expect(pathForKey("htdemucs_ft::drums::kick")).toBe(
      "/library/s1/stems/htdemucs_ft/kick.wav",
    );
  });

  it("returns null for unknown engines, stems, and sub-stems", () => {
    loadSong();
    expect(pathForKey("nope::bass")).toBeNull();
    expect(pathForKey("htdemucs_ft::vocals")).toBeNull();
    expect(pathForKey("htdemucs_ft::bass::kick")).toBeNull();
  });

  it("returns null while the profile is still loading", () => {
    inspection.songId = "s1";
    expect(pathForKey("mix")).toBeNull();
    expect(pathForKey("htdemucs_ft::bass")).toBeNull();
  });
});

describe("transport wiring", () => {
  it("playToggle hands the transport the key and its resolved path", () => {
    loadSong();
    playToggle("htdemucs_ft::bass");
    expect(transport.toggleSource).toHaveBeenCalledWith(
      "htdemucs_ft::bass",
      "/library/s1/stems/htdemucs_ft/bass.wav",
    );
  });

  it("backToMix switches to the mix without touching the playhead state", () => {
    loadSong();
    backToMix();
    expect(transport.switchSource).toHaveBeenCalledWith("mix", "/music/t.wav");
  });

  it("sidecarPath resolves a relative sidecar file against the song dir", () => {
    loadSong();
    expect(sidecarPath("heatmaps/mel.npy")).toBe(
      "/library/s1/heatmaps/mel.npy",
    );
  });
});

describe("favorites", () => {
  it("toggleFavorite adds, then removes, and persists each time", () => {
    const profile = loadSong();
    toggleFavorite("mix.tempo");
    expect(profile.favorites).toEqual(["mix.tempo"]);
    expect(isFavorite("mix.tempo")).toBe(true);
    expect(ipc.updateFavorites).toHaveBeenCalledWith("s1", ["mix.tempo"]);

    toggleFavorite("mix.tempo");
    expect(profile.favorites).toEqual([]);
    expect(isFavorite("mix.tempo")).toBe(false);
    expect(ipc.updateFavorites).toHaveBeenLastCalledWith("s1", []);
  });

  it("toggleFavorite is a no-op without a loaded profile", () => {
    inspection.songId = "s1";
    toggleFavorite("mix.tempo");
    expect(ipc.updateFavorites).not.toHaveBeenCalled();
  });

  it("isFavorite is false with no profile", () => {
    expect(isFavorite("mix.tempo")).toBe(false);
  });

  it("favoriteResolves follows dot-paths and rejects broken ones", () => {
    const profile = makeProfile();
    expect(favoriteResolves(profile, "mix.tempo")).toBe(true);
    expect(favoriteResolves(profile, "stems.htdemucs_ft.bass.features")).toBe(
      true,
    );
    expect(favoriteResolves(profile, "mix.gone")).toBe(false);
    // A path descending through a leaf value cannot resolve.
    expect(favoriteResolves(profile, "song.id.x")).toBe(false);
  });
});
