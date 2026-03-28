// frontend/src/components/Waveform.tsx — 32 bars, sine-shaped heights, wavebar animation
export function Waveform({ phase }: { phase: string }) {
  const isActive = ['listening', 'playing'].includes(phase)
  const color = phase === 'playing' ? 'var(--blue)' : 'var(--green)'
  return (
    <div className="waveform">
      {Array.from({ length: 32 }, (_, i) => {
        const h = 10 + Math.abs(Math.sin(i * 0.7) * 20)
        return (
          <div
            key={i}
            className="wf-bar"
            style={{
              height: h,
              background: color,
              opacity: isActive ? 0.7 : 0.12,
              transform: isActive ? undefined : 'scaleY(0.2)',
              animation: isActive
                ? `wavebar ${0.5 + (i % 5) * 0.12}s ${(i % 8) * 0.06}s ease-in-out infinite alternate`
                : undefined,
            }}
          />
        )
      })}
    </div>
  )
}
