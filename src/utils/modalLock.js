// Ref-counted so nested overlays (e.g. Quick Add Client inside Add Policy)
// do not clear the lock when the inner sheet closes.

let lockCount = 0
let previousMainOverflow = ''

export function acquireModalLock() {
  lockCount += 1
  if (lockCount !== 1) return
  document.body.dataset.giModalOpen = 'true'
  const main = document.getElementById('main-scroll')
  if (main) {
    previousMainOverflow = main.style.overflow
    main.style.overflow = 'hidden'
  }
}

export function releaseModalLock() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount !== 0) return
  delete document.body.dataset.giModalOpen
  const main = document.getElementById('main-scroll')
  if (main) main.style.overflow = previousMainOverflow || ''
  previousMainOverflow = ''
}
