import * as lark from '@larksuiteoapi/node-sdk'
import log from 'electron-log'

// 飞书配置类型
export interface FeishuConfig {
  enabled?: boolean  // 文档同步功能开关（已废弃，保留兼容性）
  appId: string
  appSecret: string
  accessToken?: string
  tokenExpiry?: number
  documentId?: string
  lastSyncTime?: number
  botEnabled?: boolean  // 机器人功能开关
  chatId?: string
  chatType?: 'group' | 'user' | 'thread' | 'p2p'
}

// WebSocket 连接状态
export interface WebSocketStatus {
  connected: boolean
  connecting: boolean
  lastConnectTime?: number
  lastDisconnectTime?: number
  reconnectCount: number
  error?: string
}

// 消息处理器类型
export type FeishuMessageHandler = (event: any) => Promise<string | null>

export class FeishuWebSocketService {
  private client: lark.Client | null = null
  private wsClient: lark.WSClient | null = null
  private config: FeishuConfig
  private messageHandler?: FeishuMessageHandler
  private statusChangeCallback?: (status: WebSocketStatus) => void
  private _status: WebSocketStatus = {
    connected: false,
    connecting: false,
    reconnectCount: 0
  }
  private reconnectTimer: NodeJS.Timeout | null = null
  private readonly maxReconnectAttempts = 10
  private readonly reconnectInterval = 5000 // 5秒

  constructor(
    config: FeishuConfig,
    messageHandler?: FeishuMessageHandler,
    statusChangeCallback?: (status: WebSocketStatus) => void
  ) {
    this.config = config
    this.messageHandler = messageHandler
    this.statusChangeCallback = statusChangeCallback
  }

  // 获取当前状态
  get status(): WebSocketStatus {
    return { ...this._status }
  }

  // 更新状态
  private updateStatus(partial: Partial<WebSocketStatus>) {
    this._status = { ...this._status, ...partial }
    this.statusChangeCallback?.(this._status)
  }

  // 初始化飞书客户端
  private initClient(): lark.Client {
    if (!this.client) {
      this.client = new lark.Client({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
      })
    }
    return this.client
  }

  // 启动 WebSocket 连接
  async start(): Promise<boolean> {
    if (this._status.connected || this._status.connecting) {
      log.info('[FeishuWebSocket] Already connected or connecting')
      return true
    }

    if (!this.config.appId || !this.config.appSecret) {
      log.error('[FeishuWebSocket] App ID or App Secret not configured')
      this.updateStatus({ error: 'App ID 或 App Secret 未配置' })
      return false
    }

    this.updateStatus({ connecting: true, error: undefined })

    try {
      const client = this.initClient()

      // 创建 WebSocket 客户端
      this.wsClient = new lark.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        loggerLevel: lark.LoggerLevel.info,
      })

      // 创建事件分发器并注册消息处理器
      const eventDispatcher = new lark.EventDispatcher({})
        .register({
          'im.message.receive_v1': async (data: any) => {
            log.info('[FeishuWebSocket] Received message event:', data)
            await this.handleMessageEvent(data, client)
          }
        })

      // 启动长连接
      await this.wsClient.start({
        eventDispatcher: eventDispatcher
      })

      // 连接成功
      log.info('[FeishuWebSocket] Connected successfully')
      this.updateStatus({
        connected: true,
        connecting: false,
        lastConnectTime: Date.now(),
        reconnectCount: 0,
        error: undefined
      })

      return true
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '连接失败'
      log.error('[FeishuWebSocket] Failed to start:', error)
      this.updateStatus({
        connected: false,
        connecting: false,
        error: errorMsg
      })
      // 自动重连
      this.scheduleReconnect()
      return false
    }
  }

  // 处理消息事件
  private async handleMessageEvent(event: any, client: lark.Client): Promise<void> {
    try {
      const message = event.message
      if (!message) {
        log.error('[FeishuWebSocket] No message in event:', event)
        return
      }

      // 调用消息处理器获取回复
      const reply = await this.messageHandler?.(event)

      // 如果有回复内容，发送回飞书
      if (reply) {
        await this.sendReply(message.message_id, message.chat_id, reply, message.chat_type, client)
      }
    } catch (error) {
      log.error('[FeishuWebSocket] Error handling message:', error)
    }
  }

  // 发送回复消息
  private async sendReply(
    messageId: string,
    chatId: string,
    content: string,
    chatType: 'group' | 'p2p',
    client: lark.Client
  ): Promise<boolean> {
    try {
      const response = await client.im.v1.message.reply({
        path: {
          message_id: messageId
        },
        data: {
          content: JSON.stringify({
            text: content
          }),
          msg_type: 'text'
        }
      })

      if (response.code === 0) {
        log.info('[FeishuWebSocket] Reply sent successfully')
        return true
      } else {
        log.error('[FeishuWebSocket] Failed to send reply:', response.msg)
        return false
      }
    } catch (error) {
      log.error('[FeishuWebSocket] Error sending reply:', error)
      return false
    }
  }

  // 公共方法：回复指定消息
  async replyMessage(messageId: string, chatId: string, content: string, chatType: 'group' | 'p2p' = 'group'): Promise<{ success: boolean; error?: string }> {
    try {
      // 确保客户端已初始化
      const client = this.initClient()
      const result = await this.sendReply(messageId, chatId, content, chatType, client)
      return { success: result }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log.error('[FeishuWebSocket] Error in replyMessage:', error)
      return { success: false, error: errorMsg }
    }
  }

  // 发送主动消息
  async sendMessage(content: string, chatId: string, chatType: 'group' | 'p2p' = 'group'): Promise<{ success: boolean; error?: string }> {
    try {
      log.info('[FeishuWebSocket] Sending message:', { chatId, chatType, contentLength: content.length })
      
      // 确保客户端已初始化
      const client = this.initClient()
      log.info('[FeishuWebSocket] Client initialized, appId:', this.config.appId?.substring(0, 6) + '...')

      // 飞书 API：群聊使用 chat_id，私聊也使用 chat_id（单聊会话ID）
      // 注意：open_id 是用户ID，chat_id 是会话ID，消息发送应该使用会话ID
      const receiveIdType = 'chat_id'
      log.info('[FeishuWebSocket] Using receive_id_type:', receiveIdType)
      
      const response = await client.im.v1.message.create({
        params: {
          receive_id_type: receiveIdType
        },
        data: {
          receive_id: chatId,
          content: JSON.stringify({
            text: content
          }),
          msg_type: 'text'
        }
      })

      log.info('[FeishuWebSocket] API response:', { code: response.code, msg: response.msg })

      if (response.code === 0) {
        log.info('[FeishuWebSocket] Message sent successfully')
        return { success: true }
      } else {
        log.error('[FeishuWebSocket] Failed to send message:', response.msg)
        return { success: false, error: response.msg || `API error: ${response.code}` }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log.error('[FeishuWebSocket] Error sending message:', error)
      return { success: false, error: errorMsg }
    }
  }

  // 安排重连
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    if (this._status.reconnectCount >= this.maxReconnectAttempts) {
      log.info('[FeishuWebSocket] Max reconnect attempts reached')
      this.updateStatus({ error: '重连次数已达上限' })
      return
    }

    const delay = Math.min(
      this.reconnectInterval * Math.pow(2, this._status.reconnectCount),
      60000 // 最大延迟 60 秒
    )

    log.info(`[FeishuWebSocket] Reconnecting in ${delay}ms (attempt ${this._status.reconnectCount + 1})`)

    this.reconnectTimer = setTimeout(() => {
      this.updateStatus({ reconnectCount: this._status.reconnectCount + 1 })
      this.start()
    }, delay)
  }

  // 停止 WebSocket 连接
  async stop(): Promise<void> {
    log.info('[FeishuWebSocket] Stopping...')

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.wsClient) {
      try {
        // WSClient 没有 close 方法，直接置空
        this.wsClient = null
      } catch (error) {
        log.error('[FeishuWebSocket] Error closing connection:', error)
      }
    }

    this.client = null
    this.updateStatus({
      connected: false,
      connecting: false,
      reconnectCount: 0
    })

    log.info('[FeishuWebSocket] Stopped')
  }

  // 更新配置
  updateConfig(config: FeishuConfig): void {
    const wasEnabled = this.config.botEnabled
    this.config = config

    // 如果配置变更，重新连接
    if (config.botEnabled && !wasEnabled) {
      this.stop().then(() => this.start())
    } else if (!config.botEnabled && wasEnabled) {
      this.stop()
    }
  }

  // 检查是否已连接
  isConnected(): boolean {
    return this._status.connected
  }
}

// 创建单例服务
let wsService: FeishuWebSocketService | null = null

export async function initFeishuWebSocketService(
  config: FeishuConfig,
  messageHandler?: FeishuMessageHandler,
  statusChangeCallback?: (status: WebSocketStatus) => void
): Promise<FeishuWebSocketService> {
  // 如果已有服务，先停止
  if (wsService) {
    await wsService.stop()
    wsService = null
  }
  wsService = new FeishuWebSocketService(config, messageHandler, statusChangeCallback)
  return wsService
}

export function getFeishuWebSocketService(): FeishuWebSocketService | null {
  return wsService
}

export function updateFeishuWebSocketConfig(config: FeishuConfig): void {
  if (wsService) {
    wsService.updateConfig(config)
  }
}

export function isFeishuWebSocketConnected(): boolean {
  return wsService?.isConnected() ?? false
}
