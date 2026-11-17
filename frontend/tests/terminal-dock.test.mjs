import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const component = readFileSync(fileURLToPath(new URL('../src/components/TerminalDock.vue', import.meta.url)), 'utf8')
const markup = component.split('</script>')[1]

test('console dock renders tab bar, terminal hosts and footer as active markup', () => {
  assert.match(markup, /<nav class="term-tabs" v-show="!minimized"/)
  assert.match(markup, /<div class="terminal-hosts" v-show="!minimized"/)
  assert.match(markup, /<footer class="term-footer" v-show="!minimized"/)
  // An undirected nested <template> is an inert HTML template in this
  // context and made all terminal content disappear while the header remained.
  assert.doesNotMatch(markup, /<template\s*>\s*<nav class="term-tabs"/)
})

test('terminal focus is independent of ResizeObserver fitting', () => {
  assert.match(component, /function fitActive\(\)/)
  const fitting = component.split('function fitActive()')[1].split('async function focusSession')[0]
  assert.doesNotMatch(fitting, /focusRevision|\.focus\(/)
  assert.match(component, /async function focusSession\(id:string\)/)
  assert.match(component, /void focusSession\(id\)/)
  assert.match(markup, /class="terminal-hosts" v-show="!minimized" @pointerdown="focusConsoleArea"/)
})

test('switching terminal tabs retains measurable hosts and activates xterm textarea', () => {
  assert.match(component, /function showSession\(id:string\)/)
  const switcher = component.split('function showSession(id:string)')[1].split('function focusTerminal')[0]
  assert.match(switcher, /style\.visibility=selected\?'visible':'hidden'/)
  assert.match(switcher, /style\.pointerEvents=selected\?'auto':'none'/)
  assert.doesNotMatch(component, /host\.style\.display=/)
  assert.match(component, /querySelector<HTMLTextAreaElement>\('\.xterm-helper-textarea'\)/)
  assert.match(component, /focus\(\{preventScroll:true\}\)/)
  assert.match(component, /@pointerdown\.prevent="select\(s\.id\)"/)
  assert.match(component, /showSession\(id\)/)
})

test('tab click focuses its xterm immediately, before async resize frame', () => {
  const switching=component.split('function select(id:string)')[1].split('function focusConsoleArea')[0]
  const immediate=switching.indexOf('focusTerminal(session)')
  const deferred=switching.indexOf('void focusSession(id)')
  assert.ok(immediate>=0&&deferred>immediate)
  assert.match(switching,/session\.host\.isConnected/)
})
