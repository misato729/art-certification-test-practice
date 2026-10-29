import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter } from 'h3'
import { scanServerRoutes, type Nitro } from 'nitropack'

/** Use Nitro's actual file scanner and its H3 router, with no build or DB setup. */
export async function createApiTestApp() {
  // The scanner reads only these options; no Nitro build/runtime is started in tests.
  const nitro = { options: { scanDirs: [fileURLToPath(new URL('../../server/', import.meta.url))], ignore: [] } } as unknown as Nitro
  const routes = await scanServerRoutes(nitro, 'api', '/api')
  const router = createRouter({ preemptive: true })
  for (const route of routes) {
    const handler = (await import(pathToFileURL(route.handler).href)).default
    router.use(route.route, handler, route.method)
  }
  return createApp().use(router.handler)
}
