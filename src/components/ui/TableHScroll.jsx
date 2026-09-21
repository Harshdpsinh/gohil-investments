import { useEffect, useRef } from 'react'
import { copyScrollLeft, syncSpacerWidth } from '../../utils/tableScroll'

/**
 * Top + bottom horizontal scroll, kept in ratio so the top bar reaches the
 * last column. Used on every wide table — dummy min-width used to stop halfway.
 */
export default function TableHScroll({
  children,
  className = '',
  topClassName = '',
  tableClassName = '',
}) {
  const topRef = useRef(null)
  const tableRef = useRef(null)
  const spacerRef = useRef(null)

  useEffect(() => {
    const top = topRef.current
    const table = tableRef.current
    const spacer = spacerRef.current
    if (!top || !table || !spacer) return undefined

    let lock = false
    const measure = () => syncSpacerWidth(spacer, table)
    const fromTop = () => {
      if (lock) return
      lock = true
      copyScrollLeft(top, table)
      lock = false
    }
    const fromTable = () => {
      if (lock) return
      lock = true
      copyScrollLeft(table, top)
      lock = false
    }

    measure()
    const Observer = typeof ResizeObserver === 'function'
      ? ResizeObserver
      : class { observe() {} unobserve() {} disconnect() {} }
    const ro = new Observer(measure)
    ro.observe(table)
    const inner = table.firstElementChild
    if (inner) ro.observe(inner)
    top.addEventListener('scroll', fromTop, { passive: true })
    table.addEventListener('scroll', fromTable, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      top.removeEventListener('scroll', fromTop)
      table.removeEventListener('scroll', fromTable)
      window.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <div className={className}>
      <div
        ref={topRef}
        className={`table-scroll-top overflow-x-auto overflow-y-hidden ${topClassName}`}
        style={{ height: 14 }}
        aria-hidden="true"
      >
        <div ref={spacerRef} style={{ height: 1, width: 0 }} />
      </div>
      <div ref={tableRef} className={`table-container ${tableClassName}`}>
        {children}
      </div>
    </div>
  )
}
