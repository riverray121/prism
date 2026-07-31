// Workspace shell state: which tab is showing and whether the library sidebar
// is expanded. Tab content state (open song, playback) lives in its own stores.
export type Tab = "analysis" | "mapping" | "sim" | "hardware";

// Single source of tab identity and chrome copy; the top bar and the tab host
// both render from this list. blurb doubles as the tab's empty/stub state text.
export const TABS: { id: Tab; label: string; blurb: string }[] = [
  { id: "analysis", label: "Analysis", blurb: "Open a song from the library." },
  {
    id: "mapping",
    label: "Mapping",
    blurb: "Open a song, star features in Analysis, then map them to light.",
  },
  {
    id: "sim",
    label: "Sim",
    blurb: "Patch programs onto a simulated rig — future milestone.",
  },
  {
    id: "hardware",
    label: "Hardware",
    blurb: "Open a song, then patch its programs onto real lights.",
  },
];

// Drag-resize bounds shared by the left-docked panels (px).
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 800;

// `tab` is the primary pane; `splitTab` non-null puts a second tab beside it.
// Panel widths live here so they survive tab switches and collapses.
export const workspace = $state<{
  tab: Tab;
  splitTab: Tab | null;
  sidebarExpanded: boolean;
  sidebarWidth: number;
  mappingPanelWidth: number;
  hardwarePanelWidth: number;
}>({
  tab: "analysis",
  splitTab: null,
  sidebarExpanded: false,
  sidebarWidth: 384,
  mappingPanelWidth: 288,
  hardwarePanelWidth: 288,
});

export function setTab(tab: Tab): void {
  workspace.tab = tab;
}

export function setSplitTab(tab: Tab): void {
  workspace.splitTab = tab;
}

// Open/close the second pane. On open it picks the canonical companion:
// Mapping beside anything else, Sim beside Mapping.
export function toggleSplit(): void {
  if (workspace.splitTab !== null) {
    workspace.splitTab = null;
    return;
  }
  workspace.splitTab = workspace.tab === "mapping" ? "sim" : "mapping";
}

// Collapse the split, keeping one pane's tab fullscreen.
export function fullscreenPane(pane: "primary" | "split"): void {
  if (pane === "split" && workspace.splitTab !== null) {
    workspace.tab = workspace.splitTab;
  }
  workspace.splitTab = null;
}

export function toggleSidebar(): void {
  workspace.sidebarExpanded = !workspace.sidebarExpanded;
}
