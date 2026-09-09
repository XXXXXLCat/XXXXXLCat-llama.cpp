// ---------------------------------------------------------------------------
// 从 assistant 消息中解析分段：优先使用独立的 reasoningContent 字段，
// 其次从 content 中解析 <think>...</think> 标签。
// 复刻自 llama.cpp WEBUI 的 deriveAgenticSections（简化版）。
// ---------------------------------------------------------------------------

export type AgenticSectionType = 'text' | 'reasoning' | 'reasoning_pending'

export interface AgenticSection {
  type: AgenticSectionType
  content: string
  wasInterrupted?: boolean
}

const THINK_OPEN_RE = /<think>/g
const THINK_CLOSE_RE = /<\/think>/g

export function deriveAgenticSections(
  content: string,
  reasoningContent?: string,
  isStreaming = false,
): AgenticSection[] {
  const sections: AgenticSection[] = []

  // 1. 独立的 reasoningContent 字段（SSE delta.reasoning_content）
  if (reasoningContent && reasoningContent.trim()) {
    sections.push({
      type: isStreaming ? 'reasoning_pending' : 'reasoning',
      content: reasoningContent,
    })
  }

  // 2. 从 content 中解析 <think>...</think> 标签（兼容旧格式）
  if (!content || !content.trim()) return sections

  let cursor = 0
  let thinkOpenMatch: RegExpExecArray | null

  THINK_OPEN_RE.lastIndex = 0
  THINK_CLOSE_RE.lastIndex = 0

  while ((thinkOpenMatch = THINK_OPEN_RE.exec(content)) !== null) {
    const thinkStart = thinkOpenMatch.index
    const openEnd = thinkStart + thinkOpenMatch[0].length

    if (thinkStart > cursor) {
      const textBefore = content.slice(cursor, thinkStart)
      if (textBefore.trim()) {
        sections.push({ type: 'text', content: textBefore })
      }
    }

    THINK_CLOSE_RE.lastIndex = openEnd
    const closeMatch = THINK_CLOSE_RE.exec(content)

    if (closeMatch) {
      const thinkContent = content.slice(openEnd, closeMatch.index)
      if (thinkContent.trim()) {
        sections.push({ type: 'reasoning', content: thinkContent })
      }
      cursor = closeMatch.index + closeMatch[0].length
    } else {
      const thinkContent = content.slice(openEnd)
      if (thinkContent.trim()) {
        const wasInterrupted = !isStreaming
        sections.push({
          type: 'reasoning_pending',
          content: thinkContent,
          wasInterrupted,
        })
      }
      cursor = content.length
    }
  }

  if (cursor < content.length) {
    const remaining = content.slice(cursor)
    if (remaining.trim()) {
      sections.push({ type: 'text', content: remaining })
    }
  }

  return sections
}
