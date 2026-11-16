<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'
import { PlugZap, Router, Monitor } from 'lucide-vue-next'
import type { Device } from '@/types'
const props = defineProps<{data: { device: Device, onConsole?: (device:Device) => void }}>()
const device = computed(() => props.data.device)
const icon = computed(() => device.value.icon ? `/icons/${encodeURIComponent(device.value.icon)}` : '')
</script>
<template>
  <div class="device-node" :class="{'device-running': device.status === 'running'}" :title="device.name">
    <Handle id="target" type="target" :position="Position.Left" class="network-handle target" />
    <div class="device-image">
      <img v-if="icon" :src="icon" alt="" draggable="false" />
      <Monitor v-else-if="device.kind === 'pc'" :size="47" stroke-width="1.5" />
      <Router v-else :size="47" stroke-width="1.5" />
    </div>
    <div class="device-label"><i class="device-led" :class="device.status" />{{ device.name }}</div>
    <Handle id="source" type="source" :position="Position.Right" class="network-handle source" title="Зажмите и протяните кабель" >
      <PlugZap :size="13" stroke-width="2.5" />
    </Handle>
  </div>
</template>
