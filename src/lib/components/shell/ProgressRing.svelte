<script lang="ts">
  // Small circular progress indicator for the collapsed rail: a fraction fills
  // the ring; null renders a static partial arc (queued / no step data yet).
  let {
    fraction = null,
    size = 18,
  }: {
    fraction?: number | null;
    size?: number;
  } = $props();

  const r = $derived(size / 2 - 2);
  const circumference = $derived(2 * Math.PI * r);
  const filled = $derived(
    circumference * (fraction === null ? 0.25 : Math.min(1, fraction)),
  );
</script>

<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
  <circle
    cx={size / 2}
    cy={size / 2}
    {r}
    fill="none"
    stroke="var(--color-edge)"
    stroke-width="2"
  />
  <circle
    cx={size / 2}
    cy={size / 2}
    {r}
    fill="none"
    stroke="var(--color-accent)"
    stroke-width="2"
    stroke-linecap="round"
    stroke-dasharray={`${filled} ${circumference}`}
    transform={`rotate(-90 ${size / 2} ${size / 2})`}
  />
</svg>
