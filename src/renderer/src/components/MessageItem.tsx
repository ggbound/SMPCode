/**
 * 消息项组件 - 优化版本
 * 使用 React.memo 避免不必要的重渲染
 * 参考 Kilo Code 设计风格
 */

import { memo } from 'react'
import type { Message, ImageContent } from '../store'
import { MarkdownRenderer } from './MarkdownRenderer'
import { t } from '../i18n'
import { KiloChatMessage } from './KiloChatMessage'

// 图片画廊组件
const ImageGallery = memo(function ImageGallery({ images }: { images: ImageContent[] }) {
  if (!images || images.length === 0) return null

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      marginTop: '8px',
      marginBottom: '8px'
    }}>
      {images.map((img, index) => (
        <div
          key={index}
          style={{
            position: 'relative',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            maxWidth: images.length === 1 ? '300px' : '150px'
          }}
          onClick={() => {
            // 点击可查看大图
            const newWindow = window.open()
            if (newWindow) {
              newWindow.document.write(`<img src="data:${img.mimeType};base64,${img.data}" style="max-width:100%;height:auto;" />`)
            }
          }}
        >
          <img
            src={`data:${img.mimeType};base64,${img.data}`}
            alt={img.name || `Image ${index + 1}`}
            style={{
              width: '100%',
              height: 'auto',
              maxHeight: images.length === 1 ? '300px' : '150px',
              objectFit: 'cover',
              display: 'block'
            }}
          />
          {img.name && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              background: 'rgba(0, 0, 0, 0.6)',
              color: 'white',
              fontSize: '10px',
              padding: '4px 8px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {img.name}
            </div>
          )}
        </div>
      ))}
    </div>
  )
})

interface MessageItemProps {
  msg: Message
  index: number
  onContinueTimeout?: () => void
  onStopTimeout?: () => void
  isTimeoutMessage: boolean
}

// 使用 memo 包裹组件，只有当 props 变化时才重新渲染
export const MessageItem = memo(function MessageItem({
  msg,
  index,
  onContinueTimeout,
  onStopTimeout,
  isTimeoutMessage
}: MessageItemProps) {
  // 用户消息
  if (msg.role === 'user') {
    return (
      <div className="user-message-wrapper">
        <div className="user-message-bubble">
          {msg.content}
          <ImageGallery images={msg.images || []} />
        </div>
      </div>
    )
  }

  // Builder 模式消息 - 使用 Kilo 风格组件
  if (msg.isBuilder) {
    return (
      <div className="assistant-message-wrapper">
        <KiloChatMessage
          message={msg}
          onContinue={isTimeoutMessage ? onContinueTimeout : undefined}
          onStop={isTimeoutMessage ? onStopTimeout : undefined}
        />
      </div>
    )
  }

  // 普通 AI 消息
  return (
    <div className="assistant-message-wrapper">
      <div className="assistant-message-content">
        <MarkdownRenderer content={msg.content} />
      </div>
    </div>
  )
})

export default MessageItem
