import * as React from 'react'
import { Paperclip, Send, X } from 'lucide-react'

import { useLauncher } from '@/hooks/use-launcher'
import { useI18n } from '@/lib/i18n'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Message, MessageContent } from '@/components/ui/message'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentActions,
  AttachmentAction,
} from '@/components/ui/attachment'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

interface ChatMsg {
  id: number
  role: 'user' | 'assistant'
  content: string
  /** data URLs，仅用户消息携带 */
  images?: string[]
}

interface PendingImage {
  id: number
  name: string
  dataUrl: string
  base64: string
}

function readImage(file: File): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
      resolve({ id: Date.now() + Math.random(), name: file.name, dataUrl, base64 })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * chat.title整页：复用本地 llama-server 的 OpenAI 兼容 /v1/chat/completions。
 * 支持多模态图片输入（走 llama.cpp 的 message.images 字段，需console.visionModel mmproj）。
 * 消息渲染走 shadcn 官方的 Message + Bubble，滚动用 ScrollArea。
 */
export function ChatPage() {
  const { t } = useI18n()
  const { status, config } = useLauncher()
  const endpoint = status.endpoint
  const canChat = Boolean(endpoint)

  const [messages, setMessages] = React.useState<ChatMsg[]>([])
  const [input, setInput] = React.useState('')
  const [pending, setPending] = React.useState<PendingImage[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [lightbox, setLightbox] = React.useState<string | null>(null)
  const idRef = React.useRef(0)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const nextId = () => (idRef.current += 1)

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    const imgs = await Promise.all(files.map(readImage))
    setPending((prev) => [...prev, ...imgs])
    e.target.value = ''
  }

  const removePending = (id: number) =>
    setPending((prev) => prev.filter((p) => p.id !== id))

  const send = React.useCallback(async () => {
    const text = input.trim()
    if ((!text && pending.length === 0) || busy || !endpoint) return

    const imgs = pending.map((p) => p.dataUrl)
    const userMsg: ChatMsg = { id: nextId(), role: 'user', content: text, images: imgs }
    const history = [...messages, userMsg]
    const assistantId = nextId()
    setMessages([...history, { id: assistantId, role: 'assistant', content: '' }])
    setInput('')
    setPending([])
    setBusy(true)
    setError(null)

    try {
      // llama.cpp 多模态当前走 MTMD，OpenAI 兼容接口要求图片以 content 数组里的
      // image_url 部件chat.send（老式 messages[].images 字段 MTMD settings.paths不识别，会被静默丢弃）。
      const payloadMessages = history.map((m) => {
        if (m.images && m.images.length > 0) {
          return {
            role: m.role,
            content: [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.images.map((d) => ({
                type: 'image_url',
                image_url: { url: d },
              })),
            ],
          }
        }
        return { role: m.role, content: m.content }
      })
      const res = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.alias || 'local',
          messages: payloadMessages,
          temperature: config.temperature,
          stream: false,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const data = await res.json()
      const reply: string =
        data?.choices?.[0]?.message?.content ?? t('chat.noContent')
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: reply } : m)),
      )
    } catch (e) {
      setError(String(e))
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `⚠️ ${t('chat.requestFailed')}：${String(e)}` }
            : m,
        ),
      )
    } finally {
      setBusy(false)
    }
  }, [input, pending, busy, endpoint, messages, config.alias, config.temperature, t])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <ScrollArea className="min-h-0 flex-1 rounded-xl border bg-card">
        <div className="flex flex-col gap-3 p-3">
          {messages.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {canChat ? t('chat.startChat') : t('chat.needServer')}
            </p>
          ) : (
            messages.map((m) => (
              <Message key={m.id} align={m.role === 'user' ? 'end' : 'start'}>
                <MessageContent>
                  <Bubble variant={m.role === 'user' ? 'default' : 'muted'}>
                    <BubbleContent className="whitespace-pre-wrap">
                      {m.content || (busy ? t('chat.generating') : '')}
                      {m.images && m.images.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-3">
                          {m.images.map((src, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setLightbox(src)}
                              aria-label={t('chat.imagePreview')}
                              className="overflow-hidden rounded-lg border border-border transition-transform hover:scale-105"
                            >
                              <img
                                src={src}
                                alt=""
                                className="h-24 w-24 object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {pending.length > 0 && (
        <AttachmentGroup>
          {pending.map((p) => (
            <Attachment key={p.id} state="done" orientation="vertical" size="sm">
              <AttachmentMedia variant="image">
                <img src={p.dataUrl} alt={p.name} />
              </AttachmentMedia>
              <AttachmentActions>
                <AttachmentAction aria-label={t('chat.removeImage')} onClick={() => removePending(p.id)}>
                  <X className="size-3.5" />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}

      <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onPick}
        />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chat.inputPlaceholder')}
          disabled={!canChat || busy}
          className="h-9 flex-1 border-0 bg-transparent px-3 shadow-none focus-visible:ring-0"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileRef.current?.click()}
          disabled={!canChat || busy}
          aria-label={t('chat.addImage')}
          className="size-8 shrink-0"
        >
          <Paperclip className="size-4" />
        </Button>
        <Button
          onClick={() => void send()}
          disabled={!canChat || busy || (!input.trim() && pending.length === 0)}
        >
          {t('chat.send')}
          <Send className="ml-1 size-4" />
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Dialog
        open={lightbox !== null}
        onOpenChange={(open) => {
          if (!open) setLightbox(null)
        }}
      >
        <DialogContent className="max-w-[90vw] w-auto border-0 bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">{t('chat.imagePreview')}</DialogTitle>
          {lightbox && (
            <img
              src={lightbox}
              alt=""
              className="max-h-[85vh] w-auto rounded-xl"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
