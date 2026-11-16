import type { Cable, Device } from '../types'

/** Stable topology geometry shared by the VueFlow edges and their per-link handles. */
export const DEVICE_WIDTH = 112
export const DEVICE_HEIGHT = 101
export type Side = 'left' | 'right' | 'top' | 'bottom'
export interface PortAnchor { side: Side; x: number; y: number }
export interface CableGeometry { source: PortAnchor; target: PortAnchor }
interface End { id: string; node: Device; other: Device; side: Side; end: 'source' | 'target'; anchor?: PortAnchor }
const center = (n: Device) => ({ x: n.x + DEVICE_WIDTH / 2, y: n.y + DEVICE_HEIGHT / 2 })
export function connectionSide(node: Device, other: Device): Side {
  const a = center(node), b = center(other)
  const dx = b.x - a.x, dy = b.y - a.y
  return Math.abs(dx) / DEVICE_WIDTH >= Math.abs(dy) / DEVICE_HEIGHT
    ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
}
function anchor(side: Side, i: number, count: number): PortAnchor {
  // A cable keeps its own socket; opposite port numbering cannot invert a bundle.
  const spacing = Math.min(22, (side === 'top' || side === 'bottom' ? 90 : 85) / Math.max(1, count - 1))
  const offset = (i - (count - 1) / 2) * spacing
  if (side === 'left') return { side, x: 0, y: DEVICE_HEIGHT / 2 + offset }
  if (side === 'right') return { side, x: DEVICE_WIDTH, y: DEVICE_HEIGHT / 2 + offset }
  if (side === 'top') return { side, x: DEVICE_WIDTH / 2 + offset, y: 0 }
  return { side, x: DEVICE_WIDTH / 2 + offset, y: DEVICE_HEIGHT }
}
export function layoutCables(nodes: Device[], links: Cable[]): Map<string, CableGeometry> {
  const devices = new Map(nodes.map(n => [n.id, n] as const))
  const banks = new Map<string, End[]>()
  const pairs = new Map<string, { source: End; target: End }>()
  for (const link of links) {
    const a = devices.get(link.a), b = devices.get(link.b)
    if (!a || !b || a.id === b.id) continue
    const source: End = { id: link.id, node: a, other: b, side: connectionSide(a, b), end: 'source' }
    const target: End = { id: link.id, node: b, other: a, side: connectionSide(b, a), end: 'target' }
    pairs.set(link.id, { source, target })
    for (const end of [source, target]) {
      const key = `${end.node.id}:${end.side}`
      if (!banks.has(key)) banks.set(key, [])
      banks.get(key)!.push(end)
    }
  }
  for (const bank of banks.values()) {
    const vertical = bank[0].side === 'left' || bank[0].side === 'right'
    bank.sort((a, b) => {
      const ac = center(a.other), bc = center(b.other)
      const delta = vertical ? ac.y - bc.y : ac.x - bc.x
      return delta || a.id.localeCompare(b.id)
    })
    bank.forEach((end, i) => { end.anchor = anchor(end.side, i, bank.length) })
  }
  const out = new Map<string, CableGeometry>()
  for (const [id, ends] of pairs) {
    if (ends.source.anchor && ends.target.anchor)
      out.set(id, { source: ends.source.anchor, target: ends.target.anchor })
  }
  return out
}
/** A label is centered ON its line; no perpendicular displacement is permitted. */
export function portLabelPoint(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x, dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  const distance = Math.min(46, length * 0.31)
  return { x: from.x + (length ? dx / length * distance : 0), y: from.y + (length ? dy / length * distance : 0) }
}
