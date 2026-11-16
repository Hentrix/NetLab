import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('TypeScript resolves the same @/src aliases as Vite', () => {
  const tsconfig = JSON.parse(readFileSync(resolve(root, 'tsconfig.json'), 'utf8'))
  const paths = tsconfig.compilerOptions.paths
  assert.deepEqual(paths?.['@/*'], ['src/*'])
  for (const module of ['types.ts', 'api/client.ts', 'stores/netlab.ts', 'components/TopologyCanvas.vue', 'components/TerminalDock.vue']) {
    assert.ok(existsSync(resolve(root, 'src', module)), `${module} must exist`)
  }
})

test('API domain functions import their TypeScript types explicitly', () => {
  const api = readFileSync(resolve(root, 'src/api/client.ts'), 'utf8')
  assert.match(api, /import\s+type\s*\{\s*Cable\s*,\s*Device\s*\}\s*from\s*['"]@\/types['"]/) 
})
