import type { FeishuConfig, SyncStatus } from '../store'

// 飞书 API 响应类型
interface FeishuTokenResponse {
  code: number
  msg?: string
  tenant_access_token?: string
  expire?: number
}

interface FeishuMessageResponse {
  code: number
  msg?: string
  data?: {
    message_id?: string
  }
}

// 飞书事件回调类型
export interface FeishuEventCallback {
  uuid: string
  event: {
    type: string
    app_id: string
    tenant_key: string
    sender: {
      sender_id: {
        union_id: string
        user_id: string
        open_id: string
      }
      sender_type: string
      tenant_key: string
    }
    message: {
      message_id: string
      root_id?: string
      parent_id?: string
      create_time: string
      chat_id: string
      chat_type: 'group' | 'p2p'
      message_type: string
      content: string
      mentions?: Array<{
        key: string
        id: {
          union_id: string
          user_id: string
          open_id: string
        }
        name: string
        tenant_key: string
      }>
    }
  }
}

// 消息处理器类型
export type MessageHandler = (event: FeishuEventCallback) => Promise<string | null>

// 飞书服务类 - 仅用于机器人消息交互
export class FeishuService {
  private config: FeishuConfig
  private onStatusChange?: (status: Partial<SyncStatus>) => void

  constructor(config: FeishuConfig, onStatusChange?: (status: Partial<SyncStatus>) => void) {
    this.config = config
    this.onStatusChange = onStatusChange
  }

  // 更新配置
  updateConfig(config: FeishuConfig) {
    this.config = config
  }

  // 获取访问令牌
  async getAccessToken(): Promise<string | null> {
    // 检查现有令牌是否有效
    if (this.config.accessToken && this.config.tokenExpiry && this.config.tokenExpiry > Date.now()) {
      return this.config.accessToken
    }

    try {
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret
        })
      })

      const data: FeishuTokenResponse = await response.json()

      if (data.code === 0 && data.tenant_access_token) {
        // 更新配置
        this.config.accessToken = data.tenant_access_token
        this.config.tokenExpiry = Date.now() + (data.expire || 7200) * 1000
        return data.tenant_access_token
      }

      console.error('Failed to get Feishu access token:', data.msg)
      return null
    } catch (error) {
      console.error('Error getting Feishu access token:', error)
      return null
    }
  }

  // ==================== 机器人消息交互功能 ====================

  // 发送消息到飞书群聊/用户
  async sendMessage(content: string, chatId?: string, chatType?: 'group' | 'user' | 'thread' | 'p2p'): Promise<boolean> {
    if (!this.config.botEnabled) {
      console.log('Feishu bot is disabled')
      return false
    }

    const token = await this.getAccessToken()
    if (!token) return false

    const targetChatId = chatId || this.config.chatId
    const targetChatType = chatType || this.config.chatType || 'group'

    if (!targetChatId) {
      console.error('No chat ID specified')
      return false
    }

    try {
      // 解析消息内容（飞书消息需要 JSON 格式）
      let messageContent: any
      try {
        // 尝试解析为 JSON（如果已经是富文本格式）
        messageContent = JSON.parse(content)
      } catch {
        // 普通文本，包装为 text 格式
        messageContent = { text: content }
      }

      const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          receive_id: targetChatId,
          msg_type: 'text',
          content: JSON.stringify(messageContent)
        })
      })

      const data: FeishuMessageResponse = await response.json()

      if (data.code === 0) {
        console.log('Message sent to Feishu:', data.data?.message_id)
        return true
      }

      console.error('Failed to send message to Feishu:', data.msg)
      return false
    } catch (error) {
      console.error('Error sending message to Feishu:', error)
      return false
    }
  }

  // 发送富文本消息
  async sendRichText(content: string, chatId?: string, chatType?: 'group' | 'user' | 'thread'): Promise<boolean> {
    if (!this.config.botEnabled) {
      console.log('Feishu bot is disabled')
      return false
    }

    const token = await this.getAccessToken()
    if (!token) return false

    const targetChatId = chatId || this.config.chatId
    const targetChatType = chatType || this.config.chatType || 'group'

    if (!targetChatId) {
      console.error('No chat ID specified')
      return false
    }

    try {
      // 构建富文本消息
      const richTextContent = {
        text: content
      }

      const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          receive_id: targetChatId,
          msg_type: 'text',
          content: JSON.stringify(richTextContent)
        })
      })

      const data: FeishuMessageResponse = await response.json()

      if (data.code === 0) {
        console.log('Rich text message sent to Feishu:', data.data?.message_id)
        return true
      }

      console.error('Failed to send rich text message to Feishu:', data.msg)
      return false
    } catch (error) {
      console.error('Error sending rich text message to Feishu:', error)
      return false
    }
  }

  // 回复消息（在群聊中回复指定消息）
  async replyMessage(content: string, messageId: string, chatId?: string): Promise<boolean> {
    if (!this.config.botEnabled) {
      console.log('Feishu bot is disabled')
      return false
    }

    const token = await this.getAccessToken()
    if (!token) return false

    const targetChatId = chatId || this.config.chatId

    if (!targetChatId) {
      console.error('No chat ID specified')
      return false
    }

    try {
      const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: JSON.stringify({ text: content })
        })
      })

      const data: FeishuMessageResponse = await response.json()

      if (data.code === 0) {
        console.log('Reply sent to Feishu:', data.data?.message_id)
        return true
      }

      console.error('Failed to reply message in Feishu:', data.msg)
      return false
    } catch (error) {
      console.error('Error replying message in Feishu:', error)
      return false
    }
  }

  // 解析接收到的消息内容
  parseMessageContent(content: string): string {
    try {
      const parsed = JSON.parse(content)
      // 处理不同类型的消息
      if (parsed.text) {
        return parsed.text
      }
      return content
    } catch {
      return content
    }
  }

  // 处理接收到的消息事件
  async handleIncomingMessage(event: FeishuEventCallback, handler: MessageHandler): Promise<void> {
    if (!this.config.botEnabled) {
      console.log('Feishu bot is disabled, ignoring message')
      return
    }

    try {
      // 解析消息内容
      const content = this.parseMessageContent(event.event.message.content)
      console.log('Received message from Feishu:', {
        chatId: event.event.message.chat_id,
        sender: event.event.sender.sender_id.open_id,
        content: content
      })

      // 调用处理器获取回复
      const reply = await handler(event)

      // 如果有回复内容，发送回飞书
      if (reply) {
        // 如果是群聊且消息提到了机器人，使用回复功能
        if (event.event.message.chat_type === 'group' && event.event.message.mentions) {
          await this.replyMessage(reply, event.event.message.message_id, event.event.message.chat_id)
        } else {
          // 私聊直接发送消息
          await this.sendMessage(reply, event.event.message.chat_id, 'user')
        }
      }
    } catch (error) {
      console.error('Error handling incoming Feishu message:', error)
    }
  }

  // 获取用户 Open ID（用于识别用户）
  getUserOpenId(event: FeishuEventCallback): string {
    return event.event.sender.sender_id.open_id
  }

  // 获取消息中的纯文本（去除 @ 机器人的部分）
  getMessageText(event: FeishuEventCallback): string {
    let content = this.parseMessageContent(event.event.message.content)
    
    // 如果消息中有提到机器人，去除 @ 部分
    if (event.event.message.mentions) {
      for (const mention of event.event.message.mentions) {
        content = content.replace(mention.key, '').trim()
      }
    }
    
    return content
  }
}

// 创建单例服务
let feishuService: FeishuService | null = null

export function initFeishuService(config: FeishuConfig, onStatusChange?: (status: Partial<SyncStatus>) => void): FeishuService {
  feishuService = new FeishuService(config, onStatusChange)
  return feishuService
}

export function getFeishuService(): FeishuService | null {
  return feishuService
}

export function updateFeishuConfig(config: FeishuConfig) {
  if (feishuService) {
    feishuService.updateConfig(config)
  }
}
