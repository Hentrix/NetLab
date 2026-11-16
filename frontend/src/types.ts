export type DeviceStatus = 'running' | 'stopped' | 'error' | string
export type DeviceKind = 'router' | 'switch' | 'pc' | 'firewall' | 'server' | string
export interface Device {
  id: string; name: string; imageId?: string; icon?: string
  engine?: 'vpcs' | 'qemu'; kind?: DeviceKind; status?: DeviceStatus
  x: number; y: number; nicCount?: number; portStyle?: string; error?: string
  ram?: number; cpus?: number; nicModel?: string; diskBus?: string
}
export interface Cable {
  id: string; a: string; b: string; aPort: number; bPort: number
  color?: string; lineWidth?: number; lineStyle?: 'solid' | 'dashed' | 'dotted'
  status?: string
}
export interface Lab {
  id: string; name: string; nodes: Device[]; links: Cable[]
  annotations?: unknown[]
}
export interface ImageRecord { id: string; name: string; format?: string; size?: number }
export interface Template {
  id: string; name: string; kind?: DeviceKind; engine?: 'vpcs' | 'qemu';
  ram?: number; cpus?: number; portStyle?: string; nicCount?: number;
  nicModel?: string; diskBus?: string
}
export interface HostSystem { qemu?: boolean; ovs?: boolean; vpcs?: boolean; kvm?: boolean }
