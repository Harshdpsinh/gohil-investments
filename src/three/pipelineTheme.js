// src/three/pipelineTheme.js
// Palette + board layout for the 3D pipeline view. Pure data and pure functions —
// no three.js import here so it stays unit testable.

export const PIPELINE_FONT = '/fonts/pipeline-600.woff'

export const THEMES = {
  neon: {
    bg: '#05060f',
    board: '#0b1024',
    fog: ['#05060f', 14, 34],
    text: '#e8ecff',
    sub: '#8b93c7',
    key: '#7c5cff',
    rim: '#00e5ff',
    ambient: 0.35,
    glass: 'border-white/10 bg-white/[0.04]',
  },
  frost: {
    bg: '#eef1f8',
    board: '#dfe4f2',
    fog: ['#eef1f8', 16, 40],
    text: '#0b1024',
    sub: '#5b6382',
    key: '#4f7cff',
    rim: '#7c5cff',
    ambient: 0.95,
    glass: 'border-black/5 bg-white/50',
  },
}

// Column order on the board.
export const STAGES = [
  { id: 'Upcoming', color: '#00e5ff' },
  { id: 'Due Soon', color: '#7c5cff' },
  { id: 'Overdue',  color: '#ff8a3d' },
  { id: 'Settled',  color: '#22e39a' },
]

export const STAGE_IDS = STAGES.map(s => s.id)

/** Renewal urgency -> pipeline stage. days === null means no usable due date. */
export function stageForDays(days) {
  if (days === null || days === undefined) return 'Settled'
  if (days < 0) return 'Overdue'
  if (days <= 7) return 'Due Soon'
  if (days <= 30) return 'Upcoming'
  return 'Settled'
}

/**
 * Grid position per deal: x = stage column, y = row within that column.
 * Returns [] for a falsy list so the caller never has to guard.
 */
export function layout(deals = []) {
  const rows = {}
  return deals.map(deal => {
    const found = STAGES.findIndex(s => s.id === deal.stage)
    const col = found === -1 ? 0 : found
    const row = (rows[col] = (rows[col] ?? -1) + 1)
    return {
      deal,
      color: STAGES[col].color,
      position: [(col - (STAGES.length - 1) / 2) * 2.7, 1.2 - row * 1.55, 0],
    }
  })
}
