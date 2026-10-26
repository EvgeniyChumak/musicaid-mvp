import { useEffect, useRef } from 'react'

// Adapted directly from Fuhrmann's src/scripts/pixel-hover.ts.
// The interaction constants and random neighbour-chain algorithm are preserved.
const SYMBOLS = [
  'DO',
  'RE',
  'MI',
  'FA',
  'SOL',
  'LA',
  'SI',
  '<svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
]
const BLOCK_SIZE = 16
const DETECTION_RADIUS = 50
const CLUSTER_SIZE = 7
const BLOCK_LIFETIME = 300
const EMPTY_RATIO = 0.3
const SCRAMBLE_RATIO = 0.25
const SCRAMBLE_INTERVAL = 150

type Block = {
  element: HTMLDivElement
  x: number
  y: number
  col: number
  row: number
  isEmpty: boolean
  shouldScramble: boolean
  highlightEndTime: number
  scrambleTimer: number | null
}

const randomSymbol = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
const setSymbol = (element: HTMLDivElement, symbol: string) => {
  element.innerHTML = symbol
}

class PixelHoverEffect {
  private blocks: Block[] = []
  private overlay: HTMLDivElement | null = null
  private frame = 0

  constructor(private element: HTMLElement) {
    this.build()
    this.element.addEventListener('mousemove', this.onMove)
    this.frame = requestAnimationFrame(this.tick)
  }

  private build() {
    const overlay = document.createElement('div')
    overlay.className = 'pixel-overlay'

    const cols = Math.ceil(this.element.offsetWidth / BLOCK_SIZE)
    const rows = Math.ceil(this.element.offsetHeight / BLOCK_SIZE)

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const element = document.createElement('div')
        const isEmpty = Math.random() < EMPTY_RATIO

        element.className = 'pixel-overlay__block'
        setSymbol(element, isEmpty ? '' : randomSymbol())
        element.style.width = `${BLOCK_SIZE}px`
        element.style.height = `${BLOCK_SIZE}px`
        element.style.left = `${col * BLOCK_SIZE}px`
        element.style.top = `${row * BLOCK_SIZE}px`
        overlay.appendChild(element)

        this.blocks.push({
          element,
          x: col * BLOCK_SIZE + BLOCK_SIZE / 2,
          y: row * BLOCK_SIZE + BLOCK_SIZE / 2,
          col,
          row,
          isEmpty,
          shouldScramble: !isEmpty && Math.random() < SCRAMBLE_RATIO,
          highlightEndTime: 0,
          scrambleTimer: null,
        })
      }
    }

    this.overlay = overlay
    this.element.appendChild(overlay)
  }

  private activate(block: Block, endTime: number) {
    block.element.classList.add('is--active')
    block.highlightEndTime = endTime

    if (block.shouldScramble && block.scrambleTimer === null) {
      block.scrambleTimer = window.setInterval(() => {
        setSymbol(block.element, randomSymbol())
      }, SCRAMBLE_INTERVAL)
    }
  }

  private onMove = (event: MouseEvent) => {
    const rect = this.element.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    let closest: Block | null = null
    let closestDistance = Infinity
    for (const block of this.blocks) {
      const distance = Math.hypot(mouseX - block.x, mouseY - block.y)
      if (distance < closestDistance) {
        closestDistance = distance
        closest = block
      }
    }
    if (!closest || closestDistance > DETECTION_RADIUS) return

    const now = Date.now()
    this.activate(closest, now + BLOCK_LIFETIME)

    const clusterCount = Math.floor(Math.random() * CLUSTER_SIZE) + 1
    const active = [closest]
    let current = closest

    for (let i = 0; i < clusterCount; i++) {
      const neighbors = this.blocks.filter(
        (block) =>
          !active.includes(block) &&
          Math.abs(block.col - current.col) <= 1 &&
          Math.abs(block.row - current.row) <= 1,
      )
      if (!neighbors.length) break

      const next = neighbors[Math.floor(Math.random() * neighbors.length)]
      this.activate(next, now + BLOCK_LIFETIME + i * 10)
      active.push(next)
      current = next
    }
  }

  private tick = () => {
    const now = Date.now()

    for (const block of this.blocks) {
      if (block.highlightEndTime === 0 || now <= block.highlightEndTime) continue

      block.element.classList.remove('is--active')
      block.highlightEndTime = 0

      if (block.scrambleTimer !== null) {
        clearInterval(block.scrambleTimer)
        block.scrambleTimer = null
        if (!block.isEmpty) setSymbol(block.element, randomSymbol())
      }
    }

    this.frame = requestAnimationFrame(this.tick)
  }

  destroy() {
    this.element.removeEventListener('mousemove', this.onMove)
    cancelAnimationFrame(this.frame)
    for (const block of this.blocks) {
      if (block.scrambleTimer !== null) clearInterval(block.scrambleTimer)
    }
    this.overlay?.remove()
  }
}

export function PixelHover() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = rootRef.current
    if (!element || !window.matchMedia('(hover: hover)').matches) return

    const effect = new PixelHoverEffect(element)
    return () => effect.destroy()
  }, [])

  return <div ref={rootRef} className="pixel-hover" aria-hidden="true" />
}
