<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Activity, Cpu, HardDrive, Network, ShieldCheck, Server, Monitor, RefreshCw, CheckCircle2, AlertTriangle, Info, Layers3, TerminalSquare } from '@lucide/vue'
import { useNetlabStore } from '@/stores/netlab'
const store=useNetlabStore()
const caps=computed(()=>[
  {id:'qemu',title:'QEMU',detail:'Эмулятор виртуальных устройств',ok:store.system.qemu===true,icon:Server},
  {id:'qemuImg',title:'Дисковые образы',detail:'Утилита qemu-img',ok:store.system.qemuImg===true,icon:HardDrive},
  {id:'kvm',title:'KVM',detail:'Аппаратное ускорение гостей',ok:store.system.kvm===true,icon:Cpu},
  {id:'ovs',title:'Open vSwitch',detail:'Виртуальные Ethernet-сети',ok:store.system.ovs===true,icon:Network},
  {id:'vmUser',title:'Пользователь VM',detail:'Изолированный netlab-vm',ok:store.system.vmUser===true,icon:ShieldCheck},
  {id:'vpcs',title:'VPCS',detail:'Лёгкие виртуальные ПК',ok:store.system.vpcs===true,icon:Monitor},
])
const health=computed(()=>[
  {name:'Запуск QEMU от netlab-vm',ok:store.system.qemuSpawn===true,detail:store.system.qemuSpawnError||'Проверка запуска с понижением привилегий прошла'},
  {name:'Запуск VPCS от netlab-vm',ok:store.system.vpcsSpawn===true,detail:store.system.vpcsSpawnError||'Проверка смены UID/GID и PTY прошла'},
])
const available=computed(()=>caps.value.filter(x=>x.ok).length)
const healthy=computed(()=>store.live&&caps.value.every(x=>x.ok)&&health.value.every(x=>x.ok))
const cpu=computed(()=>typeof store.metrics?.cpuPercent==='number'?Math.max(0,Math.min(100,store.metrics.cpuPercent)):null)
const ram=computed(()=>store.metrics?.memoryTotalMiB?Math.round((store.metrics.memoryUsedMiB||0)/store.metrics.memoryTotalMiB*100):null)
const formatGiB=(mib:number)=>`${(mib/1024).toFixed(1)} ГБ`
onMounted(()=>{void store.refreshSystem()})
</script>
<template>
  <div class="system-page">
    <header class="system-page-heading"><div><div class="system-eyebrow"><Activity :size="14"/> ДИАГНОСТИКА УЗЛА</div><h1>Состояние системы</h1><p>Службы, движки виртуализации и ресурсы сервера NetLab.</p></div>
      <button class="system-refresh" type="button" :disabled="store.checking" @click="store.refreshSystem()"><RefreshCw :size="16" :class="{'is-spinning':store.checking}"/> {{store.checking?'Проверяю…':'Обновить проверки'}}</button>
    </header>
    <section class="system-summary-grid">
      <article class="system-hero-card"><div class="system-kicker">ОБЩЕЕ СОСТОЯНИЕ</div><div class="system-health-row"><div class="system-health-icon" :class="{ready:healthy}"><CheckCircle2 v-if="healthy" :size="25"/><AlertTriangle v-else :size="25"/></div><div><strong>{{healthy?'Все компоненты готовы':'Требуется внимание'}}</strong><small>{{store.live?'API отвечает · проверка компонентов выполнена':'Нет подключения к NetLab API'}}</small></div></div><div class="system-hero-stats"><span><b>{{available}} / {{caps.length}}</b> компонентов</span><span><b>{{health.filter(x=>x.ok).length}} / {{health.length}}</b> проверки запуска</span></div></article>
      <article class="system-meter-card"><div class="system-meter-header"><Cpu :size="18"/><span>ЗАГРУЗКА CPU</span></div><div class="system-meter-number">{{cpu===null?'—':`${cpu.toFixed(1)}%`}}</div><div class="system-progress"><div :style="{width:`${cpu??0}%`}"/></div><small>{{cpu===null?'Ожидается второй замер CPU':'Использование процессора хоста'}}</small></article>
      <article class="system-meter-card"><div class="system-meter-header"><Layers3 :size="18"/><span>ОПЕРАТИВНАЯ ПАМЯТЬ</span></div><div class="system-meter-number">{{ram===null?'—':`${ram}%`}}</div><div class="system-progress"><div :style="{width:`${ram??0}%`}"/></div><small v-if="store.metrics?.memoryTotalMiB">{{formatGiB(store.metrics.memoryUsedMiB||0)}} из {{formatGiB(store.metrics?.memoryTotalMiB||0)}}</small><small v-else>Данные об использовании RAM недоступны</small></article>
    </section>
    <div class="system-section-title"><h2>Компоненты эмуляции</h2><span>{{available}} из {{caps.length}} доступны</span></div>
    <section class="system-components"><article v-for="item in caps" :key="item.id" class="system-component"><div class="system-component-icon"><component :is="item.icon" :size="20"/></div><div class="system-component-description"><strong>{{item.title}}</strong><small>{{item.detail}}</small></div><span class="system-chip" :class="{ok:item.ok}">{{item.ok?'Доступен':'Недоступен'}}</span></article></section>
    <div class="system-section-title"><h2>Проверка запуска</h2><span>Права и изоляция процессов</span></div>
    <section class="system-diagnostics"><article v-for="test in health" :key="test.name" class="system-diagnostic"><CheckCircle2 v-if="test.ok" class="system-check-good" :size="19"/><AlertTriangle v-else class="system-check-bad" :size="19"/><div><strong>{{test.name}}</strong><p>{{test.detail}}</p></div><span class="system-chip" :class="{ok:test.ok}">{{test.ok?'Пройдена':'Ошибка'}}</span></article></section>
    <div v-if="!health.every(t=>t.ok)" class="system-guidance"><Info :size="19"/><div><strong>Диагностика запуска устройств</strong><p>Если VPCS выдаёт «operation not permitted», обнови службу NetLab: для смены UID, GID и дополнительных групп необходимы <code>CAP_SETUID</code> и <code>CAP_SETGID</code>. После обновления повтори проверку. Журнал: <code>sudo journalctl -u netlab -n 100</code>.</p></div></div>
    <div class="system-guidance system-guidance-muted"><TerminalSquare :size="18"/><div><strong>О сервере</strong><p>Измерения CPU и RAM поступают с Debian через <code>/api/metrics</code>. Статус VPCS означает доступность бинарника, проверка запуска — отдельная. Это не подтверждение передачи Ethernet-пакетов в гостевой системе.</p></div></div>
  </div>
</template>
