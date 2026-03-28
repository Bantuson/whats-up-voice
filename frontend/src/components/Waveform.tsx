// frontend/src/components/Waveform.tsx
// FE-03: 24-bar audio waveform SVG. Animated when session = 'listening' or 'playing'.
// Spec: svg 120x32, bar width 3px, gap 2px, 24 bars.
// Active fill: #00FF88 (--color-accent); Inactive fill: #2A2A2A (--color-border)
// Animation: waveform-pulse keyframe, 600ms, staggered delays 0-23 x 40ms

const BAR_COUNT = 24
const ACTIVE_PHASES = ['listening', 'playing']
const BAR_WIDTH = 3
const BAR_GAP = 2
const BAR_STEP = BAR_WIDTH + BAR_GAP  // = 5px

export function Waveform({ phase }: { phase: string }) {
  const isActive = ACTIVE_PHASES.includes(phase)
  return (
    <svg
      width="120"
      height="32"
      aria-label={isActive ? 'Audio active' : 'Audio idle'}
      role="img"
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <rect
          key={i}
          x={i * BAR_STEP}
          y={isActive ? 0 : 14}
          width={BAR_WIDTH}
          height={isActive ? 32 : 4}
          fill={isActive ? 'var(--color-accent)' : 'var(--color-border)'}
          style={isActive ? {
            transformOrigin: 'center bottom',
            animation: `waveform-pulse 600ms ease-in-out infinite alternate`,
            animationDelay: `${i * 40}ms`,
          } : undefined}
        />
      ))}
    </svg>
  )
}
