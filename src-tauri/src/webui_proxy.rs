/*
 * webui_proxy.rs — 本地反向代理，为 llama.cpp WebUI 注入界面翻译脚本。
 *
 * 为什么需要它：llama.cpp 的 WebUI 是编译进 llama-server 的英文静态资源，
 * 无法直接改。我们在「本应用」与「llama-server」之间插一层极薄的代理：
 *   - 对 HTML 响应注入 <script src="/webui-i18n.js"></script>
 *   - 自行托管 /webui-i18n.js（内容与 public/webui-i18n.js 同源）
 * 是否真的翻译、翻成哪种语言，由脚本在 iframe 内按宿主「偏好设置 → 语言」决定：
 * 宿主通过 postMessage 下发当前语言，只有登记了字典的语言（如 zh）才替换，
 * 英语与暂无字典的语言保持官方原版英文。
 *   - 其余请求（含 SSE 流式对话）原样透传
 * 这样无需重编译 llama.cpp；llama.cpp 升级后只需更新那份 JS 字典。
 *
 * 前端 /webui 页面的 iframe 在开发环境指向 vite 的 /llama（见 vite.config.ts），
 * 在生产环境指向本代理（默认 127.0.0.1:18080）。
 */
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use axum::body::{to_bytes, Body};
use axum::http::Request;
use axum::response::Response;
use axum::Router;
use futures_util::StreamExt;
use reqwest::Client;

const PROXY_PORT: u16 = 18080;
// ?v 每次改 webui-i18n.js 或注入 CSS 都要 +1，否则浏览器用旧缓存、改动不生效。
// 注意：vite.config.ts 里的 dev 注入必须同步改同一版本号。
const INJECT_TAG: &str = "<script src=\"/webui-i18n.js?v=48\"></script>";
const INJECT_JS: &str = include_str!("../../public/webui-i18n.js");

/// 上游（llama-server）暂未就绪 / 不可达时返回的页面：带 1s 自动刷新，
/// 服务一就绪即自动出现，避免把「error sending request」之类原始报错甩给用户、
/// 并卡死 iframe（502 页面不会自动重载）。
const STARTING_PAGE: &str = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta http-equiv=\"refresh\" content=\"1\"><style>html,body{margin:0;height:100%;background:#0d0d0d;color:#a0a0a0;font-family:system-ui,sans-serif}body{display:flex;align-items:center;justify-content:center}</style></head><body><div>服务启动中，正在自动连接…（若长时间无响应请手动刷新 WebUI）</div></body></html>";

static HANDLE: OnceLock<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>> = OnceLock::new();

#[derive(Clone)]
struct AppState {
    client: Client,
    target: String,
}

/// 启动代理（若已在运行则忽略）。`target` 为 llama-server 的客户端可达地址，
/// 例如 http://127.0.0.1:8080。
pub fn ensure_started(target: &str) {
    let cell = HANDLE.get_or_init(|| Mutex::new(None));
    let mut guard = cell.lock().unwrap();
    if guard.is_some() {
        return;
    }
    let target = target.trim_end_matches('/').to_string();
    let join = tauri::async_runtime::spawn(async move {
        run(target).await;
    });
    *guard = Some(join);
}

/// 停止代理（在停止 llama-server 时调用）。
pub fn stop() {
    if let Some(cell) = HANDLE.get() {
        if let Ok(mut guard) = cell.lock() {
            if let Some(join) = guard.take() {
                join.abort();
            }
        }
    }
}

async fn run(target: String) {
    let client = match Client::builder().build() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[webui-proxy] reqwest client 构建失败: {e}");
            return;
        }
    };
    let state = AppState { client, target };
    let handler_state = state.clone();

    // 用闭包捕获 state，使路由保持 Router<()>（axum::serve 要求无状态路由）。
    let app = Router::new().fallback(move |req: Request<Body>| {
        let st = handler_state.clone();
        async move { handle(req, st).await }
    });

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], PROXY_PORT));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[webui-proxy] 绑定 {addr} 失败: {e}");
            return;
        }
    };
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[webui-proxy] 服务异常: {e}");
    }
}

async fn handle(req: Request<Body>, state: AppState) -> Response<Body> {
    let path = req.uri().path();

    // 自行托管翻译脚本（与 public/webui-i18n.js 同源）。
    if path == "/webui-i18n.js" {
        return Response::builder()
            .status(200)
            .header("content-type", "application/javascript; charset=utf-8")
            .header("cache-control", "no-store")
            .body(Body::from(INJECT_JS))
            .unwrap_or_else(|_| Response::new(Body::empty()));
    }

    let upstream = format!(
        "{}{}",
        state.target,
        req.uri()
            .path_and_query()
            .map(|q| q.as_str())
            .unwrap_or("")
    );

    let method = req.method().clone();
    // 注意：不转发 accept-encoding / host / content-length。
    // 让 reqwest 自行协商并自动解压 gzip（llama.cpp 的 WebUI 以 gzip 返回，
    // 且要求客户端带 gzip 才返回 200），这样 resp.bytes()/流拿到的就是明文，
    // 注入脚本后再以明文回传，浏览器才能正确解析。
    let skip = |k: &str| {
        matches!(
            k.to_ascii_lowercase().as_str(),
            "accept-encoding" | "host" | "content-length"
        )
    };
    let headers: HashMap<String, String> = req
        .headers()
        .iter()
        .filter(|(k, _)| !skip(k.as_str()))
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body_bytes = match to_bytes(req.into_body(), usize::MAX).await {
        Ok(b) => b,
        Err(_) => bytes::Bytes::new(),
    };

    let mut rb = state.client.request(method, &upstream);
    for (k, v) in &headers {
        rb = rb.header(k, v);
    }

    let resp = match rb.body(body_bytes).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[webui-proxy] 上游暂未就绪，返回启动页: {e}");
            return Response::builder()
                .status(200)
                .header("content-type", "text/html; charset=utf-8")
                .header("cache-control", "no-store")
                .body(Body::from(STARTING_PAGE))
                .unwrap_or_else(|_| Response::new(Body::empty()));
        }
    };

    let status = resp.status();
    let ct = resp.headers().get("content-type").cloned();
    let is_html = ct
        .as_ref()
        .map(|c| c.to_str().unwrap_or("").contains("text/html"))
        .unwrap_or(false);

    if is_html {
        return match resp.bytes().await {
            Ok(buf) => {
                let mut html = String::from_utf8_lossy(&buf).to_string();
                if let Some(i) = html.to_lowercase().find("</head>") {
                    html.insert_str(i, INJECT_TAG);
                } else if let Some(i) = html.to_lowercase().find("</body>") {
                    html.insert_str(i, INJECT_TAG);
                } else {
                    html.push_str(INJECT_TAG);
                }
                let mut builder = Response::builder().status(status);
                if let Some(ct) = ct {
                    builder = builder.header("content-type", ct);
                }
                builder
                    .header("content-length", html.len())
                    .body(Body::from(html))
                    .unwrap_or_else(|_| Response::new(Body::empty()))
            }
            Err(e) => {
                eprintln!("[webui-proxy] 上游响应读取失败，返回启动页: {e}");
                Response::builder()
                    .status(200)
                    .header("content-type", "text/html; charset=utf-8")
                    .header("cache-control", "no-store")
                    .body(Body::from(STARTING_PAGE))
                    .unwrap_or_else(|_| Response::new(Body::empty()))
            }
        };
    }

    // 非 HTML（含 SSE 流式对话）原样流式透传。
    let stream = resp.bytes_stream().map(|r| {
        r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
    });
    let body = Body::from_stream(stream);
    let mut builder = Response::builder().status(status);
    if let Some(ct) = ct {
        builder = builder.header("content-type", ct);
    }
    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Body::empty()))
}
