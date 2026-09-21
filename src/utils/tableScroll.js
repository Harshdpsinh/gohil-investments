/** Max horizontal travel. 0 when nothing overflows. */
export function maxScrollLeft(el) {
  if (!el) return 0
  return Math.max(0, el.scrollWidth - el.clientWidth)
}

/**
 * Copy one scroller's position onto another as a ratio of their ranges.
 * Dummy top bars and the real table often have different gutters / vertical
 * scrollbars, so copying scrollLeft 1:1 stops the top bar halfway.
 */
export function copyScrollLeft(from, to) {
  if (!from || !to) return
  const fromMax = maxScrollLeft(from)
  const toMax = maxScrollLeft(to)
  if (fromMax <= 0 || toMax <= 0) {
    to.scrollLeft = 0
    return
  }
  to.scrollLeft = (from.scrollLeft / fromMax) * toMax
}

export function syncSpacerWidth(spacer, scroller) {
  if (!spacer || !scroller) return
  spacer.style.width = `${Math.max(scroller.scrollWidth, scroller.clientWidth)}px`
}
