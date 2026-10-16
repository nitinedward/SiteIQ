'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * Full-screen viewer for a set of photos — a site note's, say — that steps
 * through them without closing: arrows, the ← → keys, a swipe on a touch
 * screen, or a thumbnail. Esc, the × or a click on the backdrop closes it.
 */
export default function PhotoViewer({ photos, startIndex = 0, title, subtitle, onClose }: {
  photos: string[]
  startIndex?: number
  title?: string
  subtitle?: string
  onClose: () => void
}) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), photos.length - 1))
  const closeRef = useRef<HTMLButtonElement>(null)
  const swipeFrom = useRef<number | null>(null)
  const count = photos.length
  const go = (step: number) => setIndex(i => (i + step + count) % count)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    }
    window.addEventListener('keydown', onKey)
    // The page behind shouldn't scroll while the viewer is up.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])

  // Keep the current thumbnail in view in a long strip.
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    stripRef.current?.children[index]?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [index])

  if (count === 0) return null
  const url = photos[index]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Photos: ${title}` : 'Photos'}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(17,22,31,.94)', display: 'flex', flexDirection: 'column', color: '#fff' }}
    >
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.12)', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {title && <div style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>}
          <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: '#C4CAD4' }}>
            Photo {index + 1} of {count}{subtitle ? ` · ${subtitle}` : ''}
          </div>
        </div>
        <a href={url} target="_blank" rel="noreferrer" style={{
          fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none',
          border: '1px solid rgba(255,255,255,.4)', borderRadius: 99, padding: '8px 14px',
        }}>Open original ↗</a>
        <button ref={closeRef} type="button" aria-label="Close photos" onClick={onClose} style={{
          width: 40, height: 40, borderRadius: 10, border: 'none', background: 'rgba(255,255,255,.14)', color: '#fff', fontSize: 22, cursor: 'pointer',
        }}>×</button>
      </div>

      {/* Photo */}
      <div
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
        onPointerDown={e => { swipeFrom.current = e.clientX }}
        onPointerUp={e => {
          if (swipeFrom.current === null) return
          const dx = e.clientX - swipeFrom.current
          swipeFrom.current = null
          if (Math.abs(dx) > 50 && count > 1) go(dx < 0 ? 1 : -1)
        }}
        style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px 12px', touchAction: 'pan-y' }}
      >
        {count > 1 && <NavBtn label="Previous photo" onClick={() => go(-1)}>‹</NavBtn>}
        <img
          key={url}
          src={url}
          alt={`Photo ${index + 1} of ${count}`}
          draggable={false}
          style={{ maxWidth: 'calc(100% - 120px)', maxHeight: '100%', objectFit: 'contain', borderRadius: 6, userSelect: 'none' }}
        />
        {count > 1 && <NavBtn label="Next photo" onClick={() => go(1)}>›</NavBtn>}
      </div>

      {/* Thumbnails */}
      {count > 1 && (
        <div ref={stripRef} style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 16px 16px', justifyContent: count <= 10 ? 'center' : 'flex-start' }}>
          {photos.map((p, i) => (
            <button
              key={p}
              type="button"
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              style={{
                flex: '0 0 84px', width: 84, height: 60, padding: 0, borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
                border: i === index ? '3px solid var(--marigold)' : '1px solid rgba(255,255,255,.25)',
                opacity: i === index ? 1 : 0.7, background: '#2A3140',
              }}
            >
              <img src={p} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NavBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} style={{
      flex: '0 0 48px', width: 48, height: 48, borderRadius: '50%', border: 'none', cursor: 'pointer',
      background: 'rgba(255,255,255,.14)', color: '#fff', fontSize: 28, lineHeight: 1,
    }}>{children}</button>
  )
}
