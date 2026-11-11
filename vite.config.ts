import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/** Files in public/, which are copied into the build as they are. */
function publicFiles(dir = 'public'): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? publicFiles(p) : [relative('public', p).replaceAll('\\', '/')]
  })
}

/**
 * Writes sw.js, the service worker that lets Popsheet open and work offline. It lists every file of the build;
 * all but the handwriting reader's large runtime are cached as soon as the app is installed.
 */
function serviceWorker(): Plugin {
  return {
    name: 'popsheet-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const all = [...new Set(['index.html', ...Object.keys(bundle), ...publicFiles()])].filter((f) => !f.endsWith('.map')).sort()
      const later = (f: string) => /\.wasm$|ort-wasm|reader\.worker/.test(f)
      const precache = all.filter((f) => !later(f))
      // Built file names carry a hash of their contents, so the list changes whenever anything does.
      const version = createHash('sha256').update(all.join('\n')).update(readFileSync('index.html')).digest('hex').slice(0, 12)
      const source = readFileSync('src/pwa/sw.template.js', 'utf8')
        .replace("/*VERSION*/ 'dev'", JSON.stringify(version))
        .replace('/*PRECACHE*/ []', JSON.stringify(precache))
        .replace('/*ALL*/ []', JSON.stringify(all))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative paths, so the same build works at any address (for example github.io/popsheet/).
  base: './',
  plugins: [react(), serviceWorker()],
})
