// Reveal: fades + slides its content up the first time it scrolls into
// view (IntersectionObserver, no library). `delay` (ms) staggers siblings.
// Reduced-motion users just see the content, no animation.
import { useEffect, useRef, useState, type ReactNode } from 'react'

function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect() // animate once
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        visible ? '' : 'motion-safe:translate-y-8 motion-safe:opacity-0'
      } ${className}`}
    >
      {children}
    </div>
  )
}

export default Reveal
