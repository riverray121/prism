import type { EngineInfo } from "$lib/ipc/messages";

// Analysis settings, replaced wholesale from each `settings` snapshot the sidecar
// emits. `engines` is the selected set; `availableEngines` is everything the
// sidecar can run; `engineInfo` carries each engine's label + drums capability.
// `companionUrl` empty means no companion is configured. `loaded` gates the
// UI until the first snapshot arrives.
export const settings = $state<{
  engines: string[];
  availableEngines: string[];
  engineInfo: Record<string, EngineInfo>;
  drumSubsep: boolean;
  companionUrl: string;
  companionToken: string;
  companionAuto: boolean;
  loaded: boolean;
}>({
  engines: [],
  availableEngines: [],
  engineInfo: {},
  drumSubsep: false,
  companionUrl: "",
  companionToken: "",
  companionAuto: false,
  loaded: false,
});
