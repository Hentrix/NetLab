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
