import type { Cable, Device } from '@/types'

/** Same-origin API so SSH tunnel, reverse proxy and HTTPS need no separate CORS policy. */
const API = '/api'
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status; this.name = 'ApiError' }
}
export async function api<T>(token: string, path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  let response: Response
  try { response = await fetch(`${API}/${path.replace(/^\//,'')}`, {...options, headers, cache: 'no-store'}) }
  catch { throw new ApiError('Нет соединения с NetLab API', 0) }
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try { message = (await response.json() as {error?: string}).error || message } catch { /* non-JSON error */ }
    throw new ApiError(message, response.status)
  }
  return response.json() as Promise<T>
}
export function json(data: unknown): string { return JSON.stringify(data) }
export function portLabel(device: Device | undefined, index: number): string {
  if (!device) return `eth${index}`
  if (device.ports?.[index]?.name) return device.ports[index].name!
  const style = device.portStyle || (device.engine === 'vpcs' ? 'eth' : 'eth')
  if (style === 'ether') return `ether${index + 1}`
  if (style === 'gi') return `Gi0/${index}`
  if (style === 'fa') return `Fa0/${index}`
  return `${style}${index}`
}
export function availablePorts(nodes: Device[], links: Cable[], id: string, excludeLink?: string): number[] {
  const device = nodes.find(node => node.id === id)
  if (!device) return []
  const used = new Set<number>()
  for (const cable of links) {
    if (cable.id === excludeLink) continue
    if (cable.a === id) used.add(cable.aPort)
    if (cable.b === id) used.add(cable.bPort)
  }
  return Array.from({length: Math.max(1, device.nicCount ?? 16)}, (_, i) => i).filter(i => !used.has(i))
}
