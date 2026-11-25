import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { catalogDocument, catalogRobots, catalogSitemap } from './tools/public-catalog-html.ts'
import { catalogPaths } from './src/lib/publicCatalog.ts'

const notFound = 'catalog-not-found.html'
const catalogRequests = /^\/(?:artists|albums)(?:\/|$)/
const fillPage = (template: string, page: ReturnType<typeof catalogDocument>) => template
  .replace('<!-- catalog-head -->', () => page.head)
  .replace('<!-- catalog-body -->', () => page.body)
const pageFile = (path: string) => catalogPaths.includes(path) ? `${path.slice(1)}/index.html` : notFound

function publicCatalog(): Plugin {
  return {
    name: 'stanzer-public-catalog',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/\/$/, '')
        if (!catalogRequests.test(path) && path !== '/sitemap.xml' && path !== '/robots.txt') return next()
        try {
          if (path === '/sitemap.xml' || path === '/robots.txt') {
            res.setHeader('content-type', path === '/sitemap.xml' ? 'application/xml' : 'text/plain')
            res.end(path === '/sitemap.xml' ? catalogSitemap() : catalogRobots)
            return
          }
          const page = catalogDocument(path)
          const template = await readFile(resolve(server.config.root, 'catalog.html'), 'utf8')
          const html = await server.transformIndexHtml('/catalog.html', fillPage(template, page), req.url)
          res.statusCode = page.status
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(html)
        } catch (error) { next(error) }
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/\/$/, '')
        if (!catalogRequests.test(path)) return next()
        try {
          const file = pageFile(path)
          const html = await readFile(resolve(server.config.root, server.config.build.outDir, file), 'utf8')
          res.statusCode = file === notFound ? 404 : 200
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(html)
        } catch (error) { next(error) }
      })
    },
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const template = bundle['catalog.html']
        if (!template || template.type !== 'asset') throw new Error('Catalog HTML template is missing')
        const html = String(template.source)
        for (const path of [...catalogPaths, '/not-found']) {
          this.emitFile({ type: 'asset', fileName: pageFile(path), source: fillPage(html, catalogDocument(path)) })
        }
        delete bundle['catalog.html']
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: catalogSitemap() })
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: catalogRobots })
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), publicCatalog()],
  build: { rolldownOptions: { input: { main: resolve('index.html'), catalog: resolve('catalog.html') } } },
})
