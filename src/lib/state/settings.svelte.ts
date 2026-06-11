// Analysis settings, replaced wholesale from each `settings` snapshot the sidecar
// emits. `engines` is the selected set; `availableEngines` is everything the
// sidecar can run, used to render the toggle list. `loaded` gates the UI until
// the first snapshot arrives.
export const settings = $state<{
  engines: string[];
  availableEngines: string[];
  drumSubsep: boolean;
  loaded: boolean;
}>({ engines: [], availableEngines: [], drumSubsep: false, loaded: false });
