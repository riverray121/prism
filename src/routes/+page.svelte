<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";

  let messages = $state<string[]>([]);

  // Forward every sidecar stdout line into the on-screen log.
  onMount(() => {
    const unlisten = listen<string>("sidecar-message", (event) => {
      messages = [...messages, event.payload];
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  });

  // Send a ping command to the sidecar via the Rust shell.
  async function sendPing() {
    await invoke("send_to_sidecar", { message: JSON.stringify({ type: "ping" }) });
  }
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-950 text-neutral-100">
  <div class="text-center">
    <h1 class="text-3xl font-semibold tracking-tight">Prism</h1>
    <p class="text-sm text-neutral-400">Audio analysis dashboard — scaffolding</p>
  </div>

  <button
    onclick={sendPing}
    class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
  >
    Send ping
  </button>

  <div class="min-h-24 w-72 rounded-md border border-neutral-800 bg-neutral-900 p-3 font-mono text-xs">
    {#if messages.length === 0}
      <p class="text-neutral-500">No messages yet</p>
    {:else}
      {#each messages as message}
        <p class="text-emerald-400">{message}</p>
      {/each}
    {/if}
  </div>
</main>
