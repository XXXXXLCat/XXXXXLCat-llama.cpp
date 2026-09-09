/**
 * 图片读取与缩放工具。
 *
 * 选择把图片转成 data URL 而非持有 File 对象：聊天消息会被 persist 进
 * localStorage，File 不可序列化；而 data URL 同时充当缩略图与发给模型的多模态
 * 载荷。为控制体积（localStorage 通常仅 ~5MB 配额），发送前按最长边缩放到
 * maxDim，并以 JPEG 重编码，单张通常可压到数百 KB 以内，既避免撑爆存储，
 * 也让模型输入保持在合理分辨率。
 */

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * 把任意文件原样读为 data URL（不缩放）。用于 PDF：llama-server 在视觉模型 +
 * mmproj 下可直接接收 PDF 的 data URL 作为 image_url（服务端会渲染各页为图片）。
 * 与 fileToImageDataUrl 不同，这里保留原始字节，不做画布重编码。
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return readAsDataUrl(file)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('decode failed'))
    img.src = src
  })
}

/**
 * 把图片文件读取为（按需缩放后的）data URL。
 * - 非图片类型（text/pdf…）直接返回 undefined，由调用方按 'file' 处理。
 * - 图片：先读原始 data URL，若超过 maxDim 则按最长边缩放；再按 maxMpixels（百万像素）
 *   二次限制总像素（聊天设置 MAX_IMAGE_RESOLUTION，0/不传表示不限制），最后重编码为 JPEG。
 * - 任何解码/绘制失败都回退到原始 data URL，保证不丢图。
 */
export async function fileToImageDataUrl(
  file: File,
  maxDim = 1280,
  quality = 0.82,
  maxMpixels?: number,
): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined
  const original = await readAsDataUrl(file)
  try {
    const img = await loadImage(original)
    // 1) 最长边不超过 maxDim
    let targetW = img.width
    let targetH = img.height
    if (img.width > maxDim || img.height > maxDim) {
      const scale = Math.min(maxDim / img.width, maxDim / img.height)
      targetW = Math.max(1, Math.round(img.width * scale))
      targetH = Math.max(1, Math.round(img.height * scale))
    }
    // 2) 总像素不超过 maxMpixels（百万像素）
    if (maxMpixels && maxMpixels > 0) {
      const currentMp = (targetW * targetH) / 1e6
      if (currentMp > maxMpixels) {
        const scale = Math.sqrt(maxMpixels / currentMp)
        targetW = Math.max(1, Math.round(targetW * scale))
        targetH = Math.max(1, Math.round(targetH * scale))
      }
    }
    if (targetW === img.width && targetH === img.height) return original
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.drawImage(img, 0, 0, targetW, targetH)
    // 透明 PNG 重编码为 JPEG 会变黑底，但聊天图片场景影响可接受
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return original
  }
}
