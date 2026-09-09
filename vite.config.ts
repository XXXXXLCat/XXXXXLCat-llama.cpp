import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// dev 下 /llama 反向代理的上游目标。默认 127.0.0.1:8080（与旧行为一致），
// 但会被前端 POST /__llama_target { target } 动态改写，从而跟随「参数设置」
// 里的 host/port（生产环境走 Rust 代理 server.rs，本变量仅用于 dev）。
let llamaTarget = process.env.VITE_LLAMA_TARGET || 'http://127.0.0.1:8080'

// http-proxy 实例的最小结构（用于运行时改写上游地址）。
interface ProxyWithTarget {
  options: { target?: string | URL }
}

// dev 下 /llama 反向代理的上游目标。
const llamaProxy: ProxyOptions = {
  target: llamaTarget,
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/llama/, ''),
  selfHandleResponse: true,
  configure: (proxy) => {
    // 拿到 http-proxy 实例。Vite 8 的 http-proxy-3 不实现 router，
    // 只能靠改写 proxy.options.target 来动态切换上游（每次请求都读它）。
    llamaProxyInstance = proxy as unknown as ProxyWithTarget
    proxy.on('proxyRes', (proxyRes, _req, res) => {
      const ct = (proxyRes.headers['content-type'] || '').toString()
      const enc = (proxyRes.headers['content-encoding'] || '').toString().toLowerCase()
      const status = proxyRes.statusCode || 200
      const isHtml = ct.includes('text/html')

      // 非 HTML：JS/CSS 资产、SSE 流式对话等 —— 原样透传（保留 gzip）。
      if (!isHtml) {
        delete proxyRes.headers['content-length']
        res.writeHead(status, proxyRes.headers as Record<string, string | string[] | undefined>)
        proxyRes.pipe(res)
        return
      }

      // HTML：先收集全部字节，按需解压 gzip，注入脚本，再以明文回传。
      const chunks: Buffer[] = []
      proxyRes.on('data', (c: Buffer) => chunks.push(c))
      proxyRes.on('end', () => {
        let buf = Buffer.concat(chunks)
        try {
          if (enc.includes('gzip')) buf = zlib.gunzipSync(buf)
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf)
          else if (enc.includes('br')) buf = zlib.brotliDecompressSync(buf)
        } catch {
          // 解压失败则保留原字节
        }
        let html = buf.toString('utf8')
        const inject = '<script src="/webui-i18n.js?v=48"></script>'
        const lower = html.toLowerCase()
        const i = lower.indexOf('</head>')
        const j = lower.indexOf('</body>')
        if (i >= 0) html = html.slice(0, i) + inject + html.slice(i)
        else if (j >= 0) html = html.slice(0, j) + inject + html.slice(j)
        else html += inject

        const headers = { ...proxyRes.headers } as Record<string, string | string[] | undefined>
        delete headers['content-encoding']
        delete headers['content-length']
        headers['content-type'] = 'text/html; charset=utf-8'
        headers['content-length'] = String(Buffer.byteLength(html))
        res.writeHead(status, headers)
        res.end(html)
      })
    })
  },
}

// http-proxy 实例引用（用于运行时更新上游地址）。
let llamaProxyInstance: ProxyWithTarget | null = null

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // dev 仅有的一个轻量中间件：接收前端推送的真实 llama-server 地址，
    // 写进代理实例的 options.target，使上面的 /llama 代理能跟随
    // 「参数设置」里的 host/port（Vite 8 的 http-proxy-3 不支持 router）。
    {
      name: 'llama-target-middleware',
      configureServer(server) {
        server.middlewares.use('/__llama_target', (req, res) => {
          if (req.method === 'POST') {
            let body = ''
            req.on('data', (c) => (body += c.toString()))
            req.on('end', () => {
              try {
                const parsed = JSON.parse(body) as { target?: string }
                if (parsed.target) {
                  llamaTarget = parsed.target
                  if (llamaProxyInstance) llamaProxyInstance.options.target = parsed.target
                }
              } catch {
                // 忽略非法请求体
              }
              res.statusCode = 204
              res.end()
            })
          } else {
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ target: llamaTarget }))
          }
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Dev only: proxy /api to the backend service.
    // Override the target with VITE_API_PROXY_TARGET (e.g. PowerShell:
    // $env:VITE_API_PROXY_TARGET="http://127.0.0.1:9000"; npm run dev)
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // Dev only: proxy the llama.cpp WebUI through a local reverse proxy so we can
      // inject webui-i18n.js (按宿主语言翻译界面) without recompiling llama.cpp.
      // Override the upstream target with VITE_LLAMA_TARGET (default llama.cpp :8080)。
      // 上游地址默认 127.0.0.1:8080，但会被前端 POST /__llama_target 动态改写
      // （见上方 llama-target-middleware），因此跟随「参数设置」里的 host/port。
      //
      // 关键：llama.cpp 的 WebUI HTML 是 gzip 压缩返回的，且要求客户端带
      // Accept-Encoding: gzip（否则返回 415）。所以这里必须先把 gzip 解压、
      // 注入脚本，再以明文回传；非 HTML（JS/CSS 资产、SSE 流式）则原样透传。
      '/llama': llamaProxy,
    },
  },
})
