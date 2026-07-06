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
    blurb: "Map favorited features to light programs — milestone 3.",
  },
  {
    id: "sim",
    label: "Sim",
    blurb: "Patch programs onto a simulated rig — milestone 3.",
  },
  {
    id: "hardware",
    label: "Hardware",
    blurb: "Drive real fixtures — future milestone.",
  },
];

export const workspace = $state<{ tab: Tab; sidebarExpanded: boolean }>({
  tab: "analysis",
  sidebarExpanded: false,
});

export function setTab(tab: Tab): void {
  workspace.tab = tab;
}

export function toggleSidebar(): void {
  workspace.sidebarExpanded = !workspace.sidebarExpanded;
}
