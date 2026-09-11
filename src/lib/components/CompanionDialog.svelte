<script lang="ts">
  import DialogShell from "$lib/components/DialogShell.svelte";
  import { updateSettings } from "$lib/ipc";
  import { checkConnection, companion } from "$lib/state/companion.svelte";
  import { settings } from "$lib/state/settings.svelte";

  // Companion connection settings: one server URL and bearer token, persisted
  // by the sidecar; the connection check runs on every saved change.
  let { onclose }: { onclose: () => void } = $props();

  let url = $state(settings.companionUrl);
  let token = $state(settings.companionToken);

  const dirty = $derived(
    url.trim().replace(/\/+$/, "") !== settings.companionUrl ||
      token.trim() !== settings.companionToken,
  );

  const STATUS_LABEL: Record<typeof companion.status, string> = {
    off: "No companion configured",
    connecting: "Connecting…",
    connected: "Connected",
    unauthorized: "Unauthorized: check the token",
    incompatible: "Incompatible companion",
    unreachable: "Unreachable",
  };

  function save() {
    void updateSettings({
      companion_url: url.trim(),
      companion_token: token.trim(),
    });
  }

  function disconnect() {
    url = "";
    token = "";
    save();
  }
</script>

<DialogShell title="Companion" {onclose}>
  <div class="mt-3 flex flex-col gap-3">
    <label class="flex flex-col gap-1 text-xs text-ink-muted">
      Server URL
      <input
        bind:value={url}
        placeholder="http://192.168.8.2:8760"
        spellcheck="false"
        class="rounded border border-edge bg-app px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
    </label>
    <label class="flex flex-col gap-1 text-xs text-ink-muted">
      Token
      <input
        bind:value={token}
        type="password"
        spellcheck="false"
        class="rounded border border-edge bg-app px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
      />
    </label>
    <div class="flex items-center gap-2 text-xs">
      <span
        class="h-2 w-2 shrink-0 rounded-full {companion.status === 'connected'
          ? 'bg-accent'
          : companion.status === 'off' || companion.status === 'connecting'
            ? 'bg-ink-faint'
            : 'bg-danger'}"
      ></span>
      <span class="min-w-0 flex-1 truncate text-ink-muted">
        {STATUS_LABEL[companion.status]}
        {#if companion.status === "connected" && companion.info}
          to {companion.info.name} {companion.info.version}
        {:else if companion.error}
          ({companion.error})
        {/if}
      </span>
    </div>
    <div class="flex justify-end gap-2 pt-1">
      {#if settings.companionUrl !== ""}
        <button
          onclick={disconnect}
          class="rounded px-2.5 py-1 text-sm text-ink-muted hover:bg-raised hover:text-danger"
        >
          Disconnect
        </button>
        <button
          onclick={() => void checkConnection()}
          class="rounded bg-raised px-2.5 py-1 text-sm font-medium hover:text-ink"
        >
          Retry
        </button>
      {/if}
      <button
        onclick={save}
        disabled={!dirty}
        class="rounded bg-accent px-2.5 py-1 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-40"
      >
        Save
      </button>
    </div>
  </div>
</DialogShell>
