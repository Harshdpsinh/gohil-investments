const OCR_CACHE = 'gohil-commission-ocr-v1'
const OCR_HOSTS = new Set(['cdn.jsdelivr.net'])

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || !OCR_HOSTS.has(url.hostname)) return
  if (!/pdfjs-dist|tesseract/i.test(url.pathname)) return
  event.respondWith((async () => {
    const cache = await caches.open(OCR_CACHE)
    try {
      const response = await fetch(event.request)
      if (response.ok || response.type === 'opaque') cache.put(event.request, response.clone())
      return response
    } catch (error) {
      const cached = await cache.match(event.request)
      if (cached) return cached
      throw error
    }
  })())
})
