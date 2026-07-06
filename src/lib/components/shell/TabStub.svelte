<script lang="ts">
  let { title, blurb }: { title: string; blurb: string } = $props();
</script>

<div class="flex h-full flex-col items-center justify-center gap-1">
  <p class="text-sm font-medium text-ink-muted">{title}</p>
  <p class="text-sm text-ink-faint">{blurb}</p>
</div>
