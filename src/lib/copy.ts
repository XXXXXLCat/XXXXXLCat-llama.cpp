import { toast } from 'sonner'

/**
 * 写入剪贴板。
 *
 * 优先使用现代异步 Clipboard API。在 Tauri v2 的 webview 中，若 capabilities
 * 未授予 `core:clipboard:allow-write-text` 权限，或 `navigator.clipboard` 不可用
 * （非安全上下文等），`writeText` 会抛 `NotAllowedError`。此时回退到
 * `document.execCommand('copy')` —— WebView2 下无需任何权限即可工作。
 */
export async function copyToClipboard(text: string, label?: string) {
  const ok = await writeClipboard(text)
  if (ok) {
    toast.success(label ? `${label} copied` : 'Copied')
  } else {
    toast.error('Copy failed')
  }
}

async function writeClipboard(text: string): Promise<boolean> {
  // 1) 现代异步 API：需要安全上下文 + clipboard 权限
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落到回退方案
  }

  // 2) 回退：临时 textarea + execCommand('copy')（Tauri WebView2 可用，无需权限）
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '0'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
