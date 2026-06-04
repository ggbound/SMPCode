/**
 * 提醒服务
 * 支持定时提醒功能，通过飞书消息发送提醒
 */

import log from 'electron-log'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { getFeishuWebSocketService } from './feishu-ws-service'

// 使用 node-cron 进行定时任务调度
// 注意：需要在 package.json 中添加依赖
let cron: { schedule: (expression: string, callback: () => void, options?: { scheduled?: boolean; timezone?: string }) => { stop: () => void }; validate: (expression: string) => boolean } | null = null
try {
  const nodeCron = require('node-cron')
  cron = nodeCron
} catch {
  log.warn('[ReminderService] node-cron not available, will use setTimeout fallback')
}

/**
 * 提醒配置接口
 */
export interface Reminder {
  id: string
  content: string
  cronExpression: string  // Cron 表达式，如 "0 9 * * 1-5" 表示工作日早上9点
  targetType: 'user' | 'group'
  targetId: string        // 飞书用户ID或群ID
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastTriggeredAt?: number
  triggerCount: number
  description?: string    // 提醒描述/备注
  isOneTime?: boolean     // 是否为一次性提醒
}

/**
 * 提醒服务配置
 */
interface ReminderServiceConfig {
  reminders: Reminder[]
}

// 配置文件路径
const CONFIG_FILE_NAME = 'reminders.json'

/**
 * 提醒服务类
 */
class ReminderService {
  private reminders: Map<string, Reminder> = new Map()
  private cronJobs: Map<string, any> = new Map()  // node-cron 任务
  private timeoutJobs: Map<string, NodeJS.Timeout> = new Map()  // setTimeout 任务（fallback）
  private configPath: string
  private initialized = false

  constructor() {
    // 配置文件存储在用户数据目录
    const userDataPath = app.getPath('userData')
    this.configPath = path.join(userDataPath, CONFIG_FILE_NAME)
    log.info(`[ReminderService] Config path: ${this.configPath}`)
  }

  /**
   * 初始化服务
   */
  async init(): Promise<void> {
    if (this.initialized) return

    try {
      await this.loadReminders()
      this.startAllReminders()
      this.initialized = true
      log.info(`[ReminderService] Initialized with ${this.reminders.size} reminders`)
    } catch (error) {
      log.error('[ReminderService] Failed to initialize:', error)
      throw error
    }
  }

  /**
   * 加载提醒配置
   */
  private async loadReminders(): Promise<void> {
    try {
      if (!fs.existsSync(this.configPath)) {
        log.info('[ReminderService] No existing config file, starting fresh')
        return
      }

      const data = fs.readFileSync(this.configPath, 'utf-8')
      const config: ReminderServiceConfig = JSON.parse(data)

      if (config.reminders && Array.isArray(config.reminders)) {
        for (const reminder of config.reminders) {
          this.reminders.set(reminder.id, reminder)
        }
      }

      log.info(`[ReminderService] Loaded ${this.reminders.size} reminders from config`)
    } catch (error) {
      log.error('[ReminderService] Failed to load reminders:', error)
      // 如果加载失败，从空配置开始
      this.reminders.clear()
    }
  }

  /**
   * 保存提醒配置
   */
  private async saveReminders(): Promise<void> {
    try {
      const config: ReminderServiceConfig = {
        reminders: Array.from(this.reminders.values())
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
      log.debug('[ReminderService] Saved reminders to config file')
    } catch (error) {
      log.error('[ReminderService] Failed to save reminders:', error)
      throw error
    }
  }

  /**
   * 添加提醒
   */
  async addReminder(reminder: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt' | 'triggerCount'>): Promise<Reminder> {
    const now = Date.now()
    const newReminder: Reminder = {
      ...reminder,
      id: `reminder_${now}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now,
      triggerCount: 0
    }

    // 验证 Cron 表达式
    if (cron && !cron.validate(reminder.cronExpression)) {
      throw new Error(`Invalid cron expression: ${reminder.cronExpression}`)
    }

    this.reminders.set(newReminder.id, newReminder)
    await this.saveReminders()

    // 如果启用，立即启动
    if (newReminder.enabled) {
      this.startReminder(newReminder)
    }

    log.info(`[ReminderService] Added reminder: ${newReminder.id}`)
    return newReminder
  }

  /**
   * 更新提醒
   */
  async updateReminder(id: string, updates: Partial<Omit<Reminder, 'id' | 'createdAt'>>): Promise<Reminder | null> {
    const reminder = this.reminders.get(id)
    if (!reminder) {
      log.warn(`[ReminderService] Reminder not found: ${id}`)
      return null
    }

    // 停止旧的定时任务
    this.stopReminder(id)

    // 更新配置
    const updatedReminder: Reminder = {
      ...reminder,
      ...updates,
      updatedAt: Date.now()
    }

    // 如果更新了 Cron 表达式，验证它
    if (updates.cronExpression && cron && !cron.validate(updates.cronExpression)) {
      throw new Error(`Invalid cron expression: ${updates.cronExpression}`)
    }

    this.reminders.set(id, updatedReminder)
    await this.saveReminders()

    // 如果启用，重新启动
    if (updatedReminder.enabled) {
      this.startReminder(updatedReminder)
    }

    log.info(`[ReminderService] Updated reminder: ${id}`)
    return updatedReminder
  }

  /**
   * 删除提醒
   */
  async removeReminder(id: string): Promise<boolean> {
    const reminder = this.reminders.get(id)
    if (!reminder) {
      return false
    }

    // 停止定时任务
    this.stopReminder(id)

    this.reminders.delete(id)
    await this.saveReminders()

    log.info(`[ReminderService] Removed reminder: ${id}`)
    return true
  }

  /**
   * 获取所有提醒
   */
  getAllReminders(): Reminder[] {
    return Array.from(this.reminders.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * 获取单个提醒
   */
  getReminder(id: string): Reminder | undefined {
    return this.reminders.get(id)
  }

  /**
   * 启动单个提醒
   */
  private startReminder(reminder: Reminder): void {
    if (!reminder.enabled) return

    // 停止已有的任务
    this.stopReminder(reminder.id)

    if (cron) {
      // 使用 node-cron
      try {
        const job = cron.schedule(reminder.cronExpression, () => {
          this.onReminderTrigger(reminder)
        }, {
          scheduled: true,
          timezone: 'Asia/Shanghai'  // 使用中国时区
        })
        this.cronJobs.set(reminder.id, job)
        log.debug(`[ReminderService] Started cron job for reminder: ${reminder.id}`)
      } catch (error) {
        log.error(`[ReminderService] Failed to schedule cron job for ${reminder.id}:`, error)
      }
    } else {
      // Fallback: 使用 setTimeout 模拟简单的定时任务
      this.scheduleWithTimeout(reminder)
    }
  }

  /**
   * 使用 setTimeout 模拟定时任务（简单实现）
   */
  private scheduleWithTimeout(reminder: Reminder): void {
    // 解析 Cron 表达式获取下一次执行时间
    const nextTime = this.getNextExecutionTime(reminder.cronExpression)
    if (!nextTime) {
      log.warn(`[ReminderService] Could not parse cron expression: ${reminder.cronExpression}`)
      return
    }

    const delay = nextTime.getTime() - Date.now()
    if (delay <= 0) {
      log.warn(`[ReminderService] Next execution time is in the past, skipping: ${reminder.id}`)
      return
    }

    const timeout = setTimeout(() => {
      this.onReminderTrigger(reminder)
      // 重新调度下一次执行
      this.scheduleWithTimeout(reminder)
    }, delay)

    this.timeoutJobs.set(reminder.id, timeout)
    log.debug(`[ReminderService] Scheduled timeout for reminder: ${reminder.id} in ${delay}ms`)
  }

  /**
   * 简单的 Cron 表达式解析（仅支持基本格式）
   * 返回下一次执行时间
   */
  private getNextExecutionTime(cronExpression: string): Date | null {
    // 简单解析：支持 "分 时 * * *" 格式（每天指定时间）
    const parts = cronExpression.split(' ')
    if (parts.length !== 5) return null

    const [minute, hour] = parts.map(p => parseInt(p, 10))
    if (isNaN(minute) || isNaN(hour)) return null

    const now = new Date()
    let next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)

    // 如果今天的时间已过，设置为明天
    if (next <= now) {
      next.setDate(next.getDate() + 1)
    }

    return next
  }

  /**
   * 停止单个提醒
   */
  private stopReminder(id: string): void {
    // 停止 cron 任务
    const cronJob = this.cronJobs.get(id)
    if (cronJob) {
      cronJob.stop()
      this.cronJobs.delete(id)
    }

    // 停止 timeout 任务
    const timeout = this.timeoutJobs.get(id)
    if (timeout) {
      clearTimeout(timeout)
      this.timeoutJobs.delete(id)
    }
  }

  /**
   * 启动所有启用的提醒
   */
  private startAllReminders(): void {
    for (const reminder of this.reminders.values()) {
      if (reminder.enabled) {
        this.startReminder(reminder)
      }
    }
  }

  /**
   * 停止所有提醒
   */
  private stopAllReminders(): void {
    for (const id of this.cronJobs.keys()) {
      this.stopReminder(id)
    }
    for (const id of this.timeoutJobs.keys()) {
      this.stopReminder(id)
    }
  }

  /**
   * 提醒触发时的处理
   */
  private async onReminderTrigger(reminder: Reminder): Promise<void> {
    log.info(`[ReminderService] Reminder triggered: ${reminder.id}`)

    try {
      // 更新触发统计
      reminder.lastTriggeredAt = Date.now()
      reminder.triggerCount++
      await this.saveReminders()

      // 发送飞书消息
      const message = this.formatReminderMessage(reminder)
      const feishuService = getFeishuWebSocketService()
      if (feishuService) {
        await feishuService.sendMessage(
          message,
          reminder.targetId,
          reminder.targetType === 'group' ? 'group' : 'p2p'
        )
      } else {
        log.warn('[ReminderService] Feishu service not available, skipping message send')
      }

      log.info(`[ReminderService] Sent reminder message to ${reminder.targetType}:${reminder.targetId}`)

      // 如果是一次性提醒，触发后自动删除
      if (reminder.isOneTime) {
        await this.removeReminder(reminder.id)
        log.info(`[ReminderService] Removed one-time reminder: ${reminder.id}`)
      }
    } catch (error) {
      log.error('[ReminderService] Failed to send reminder:', error)
    }
  }

  /**
   * 格式化提醒消息
   */
  private formatReminderMessage(reminder: Reminder): string {
    const time = new Date().toLocaleString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })

    return `⏰ **定时提醒** (${time})\n\n${reminder.content}`
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    this.stopAllReminders()
    this.reminders.clear()
    this.initialized = false
    log.info('[ReminderService] Destroyed')
  }
}

// 单例实例
let reminderService: ReminderService | null = null

/**
 * 获取提醒服务实例
 */
export function getReminderService(): ReminderService {
  if (!reminderService) {
    reminderService = new ReminderService()
  }
  return reminderService
}

/**
 * 初始化提醒服务
 */
export async function initReminderService(): Promise<void> {
  const service = getReminderService()
  await service.init()
}

/**
 * 添加提醒（便捷函数）
 */
export async function addReminder(
  content: string,
  cronExpression: string,
  targetType: 'user' | 'group',
  targetId: string,
  description?: string,
  isOneTime?: boolean
): Promise<Reminder> {
  const service = getReminderService()
  return service.addReminder({
    content,
    cronExpression,
    targetType,
    targetId,
    enabled: true,
    description,
    isOneTime
  })
}

/**
 * 获取所有提醒
 */
export function getAllReminders(): Reminder[] {
  const service = getReminderService()
  return service.getAllReminders()
}

/**
 * 删除提醒
 */
export async function removeReminder(id: string): Promise<boolean> {
  const service = getReminderService()
  return service.removeReminder(id)
}

/**
 * 更新提醒
 */
export async function updateReminder(
  id: string,
  updates: Partial<Omit<Reminder, 'id' | 'createdAt'>>
): Promise<Reminder | null> {
  const service = getReminderService()
  return service.updateReminder(id, updates)
}

/**
 * 解析自然语言为 Cron 表达式
 * 支持：
 * - "今天早上9点" -> "0 9 日 月 *" (一次性提醒)
 * - "明天下午3点" -> "0 15 日 月 *" (一次性提醒)
 * - "每天早上9点" -> "0 9 * * *"
 * - "每周一早上9点" -> "0 9 * * 1"
 * - "工作日早上9点" -> "0 9 * * 1-5"
 */
export function parseNaturalLanguageToCron(text: string): { cron: string; description: string; isOneTime?: boolean } | null {
  const now = new Date()
  
  const patterns = [
    // 今天特定时间（一次性提醒）
    {
      regex: /今天(?:早上|上午|下午|晚上)?(\d{1,2})点/,
      handler: (match: RegExpMatchArray) => {
        const hour = parseInt(match[1], 10)
        return {
          cron: `0 ${hour} ${now.getDate()} ${now.getMonth() + 1} *`,
          description: `今天 ${hour}:00`,
          isOneTime: true
        }
      }
    },
    // 明天特定时间（一次性提醒）
    {
      regex: /明天(?:早上|上午|下午|晚上)?(\d{1,2})点/,
      handler: (match: RegExpMatchArray) => {
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        const hour = parseInt(match[1], 10)
        return {
          cron: `0 ${hour} ${tomorrow.getDate()} ${tomorrow.getMonth() + 1} *`,
          description: `明天 ${hour}:00`,
          isOneTime: true
        }
      }
    },
    // 每天特定时间
    {
      regex: /每天(?:早上|上午|下午|晚上)?(\d{1,2})点/,
      handler: (match: RegExpMatchArray) => ({
        cron: `0 ${match[1]} * * *`,
        description: `每天 ${match[1]}:00`
      })
    },
    // 工作日特定时间
    {
      regex: /工作日(?:早上|上午|下午|晚上)?(\d{1,2})点/,
      handler: (match: RegExpMatchArray) => ({
        cron: `0 ${match[1]} * * 1-5`,
        description: `工作日 ${match[1]}:00`
      })
    },
    // 每周几特定时间
    {
      regex: /每周([一二三四五六日])(?:早上|上午|下午|晚上)?(\d{1,2})点/,
      handler: (match: RegExpMatchArray) => {
        const dayMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0 }
        const day = dayMap[match[1]]
        return {
          cron: `0 ${match[2]} * * ${day}`,
          description: `每周${match[1]} ${match[2]}:00`
        }
      }
    },
    // 每小时
    {
      regex: /每(\d{1,2})小时/,
      handler: (match: RegExpMatchArray) => ({
        cron: `0 */${match[1]} * * *`,
        description: `每 ${match[1]} 小时`
      })
    },
    // 每分钟
    {
      regex: /每(\d{1,2})分钟/,
      handler: (match: RegExpMatchArray) => ({
        cron: `*/${match[1]} * * * *`,
        description: `每 ${match[1]} 分钟`
      })
    }
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern.regex)
    if (match) {
      return pattern.handler(match)
    }
  }

  return null
}

export default getReminderService
