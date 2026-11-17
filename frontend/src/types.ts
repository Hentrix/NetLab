export type DeviceStatus = 'running' | 'stopped' | 'error' | string
export type DeviceKind = 'router' | 'switch' | 'pc' | 'firewall' | 'server' | string
export interface Device {
  id: string; name: string; imageId?: string; installIsoId?: string; icon?: string
  engine?: 'vpcs' | 'qemu'; kind?: DeviceKind; status?: DeviceStatus
  x: number; y: number; nicCount?: number; portStyle?: string; ports?: PortSpec[]; error?: string
  ram?: number; cpus?: number; nicModel?: string; diskBus?: string
}
export interface PortSpec { name?: string; speedMbps?: number }
export interface Cable {
  id: string; a: string; b: string; aPort: number; bPort: number
  color?: string; lineWidth?: number; lineStyle?: 'solid' | 'dashed' | 'dotted'
  status?: string
}
export interface Annotation {
  id: string; kind: 'text' | 'note'; text: string
  x: number; y: number; width: number; height: number
  color?: string; background?: string; borderColor?: string
  borderWidth?: number; fontSize?: number; bold?: boolean
  italic?: boolean; underline?: boolean; align?: 'left' | 'center' | 'right'
}
export interface Lab {
  id: string; name: string; workshop?: boolean; nodes: Device[]; links: Cable[]
  annotations?: Annotation[]
}
export interface ImageRecord { id: string; name: string; format?: string; size?: number; createdAt?: string }
export interface InstallMedia {id:string;name:string;size:number;createdAt?:string}
export interface PreparedTemplate {
 id:string;imageId:string;name:string;category:'desktop'|'server'|'network'|'other';
 family:string;version:string;kind:string;ram:number;cpus:number;nicModel:string;
 nicCount:number;diskBus:string;portStyle:string;icon?:string;createdAt?:string
}
export interface Template {
  id: string; name: string; imageId?:string; category?:string;family?:string;version?:string;
  kind?: DeviceKind; engine?: 'vpcs' | 'qemu';
  ram?: number; cpus?: number; portStyle?: string; nicCount?: number;
  nicModel?: string; diskBus?: string
}
export interface HostSystem {
  qemu?: boolean; ovs?: boolean; vpcs?: boolean; kvm?: boolean
  qemuImg?: boolean; vmUser?: boolean; qemuSpawn?: boolean; qemuSpawnError?: string
  vpcsSpawn?: boolean; vpcsSpawnError?: string
}
export interface HostMetrics {
  cpuPercent?: number | null; memoryUsedMiB?: number
  memoryTotalMiB?: number; savedAt?: string | null
}
