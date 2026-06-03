/**
 * 浏览器工具服务
 * 用于获取网页内容并进行分析
 */

import { BrowserWindow } from 'electron'
import log from 'electron-log'
import * as path from 'path'

// 缓存 BrowserWindow 实例
let browserWindow: BrowserWindow | null = null

/**
 * 获取或创建隐藏的 BrowserWindow
 */
function getBrowserWindow(): BrowserWindow {
  if (browserWindow && !browserWindow.isDestroyed()) {
    return browserWindow
  }

  browserWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // 隐藏窗口
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      offscreen: true // 使用离屏渲染
    }
  })

  // 窗口关闭时清理引用
  browserWindow.on('closed', () => {
    browserWindow = null
  })

  return browserWindow
}

/**
 * 浏览器工具执行结果
 */
export interface BrowseResult {
  success: boolean
  title?: string
  url: string
  content: string
  error?: string
  metadata?: {
    loadTime: number
    contentLength: number
    hasJavaScript: boolean
  }
}

/**
 * 获取网页内容
 * @param url 要访问的 URL
 * @param options 选项
 */
export async function browseWebsite(
  url: string,
  options: {
    waitForSelector?: string
    timeout?: number
    maxLength?: number
  } = {}
): Promise<BrowseResult> {
  const startTime = Date.now()
  const { waitForSelector, timeout = 30000, maxLength = 50000 } = options

  // 验证 URL
  let validatedUrl: string
  try {
    const urlObj = new URL(url)
    // 只允许 http 和 https 协议
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return {
        success: false,
        url,
        content: '',
        error: `不支持的协议: ${urlObj.protocol}。只支持 http 和 https。`
      }
    }
    validatedUrl = urlObj.toString()
  } catch (error) {
    // 尝试添加 https:// 前缀
    try {
      const urlObj = new URL(`https://${url}`)
      validatedUrl = urlObj.toString()
    } catch {
      return {
        success: false,
        url,
        content: '',
        error: `无效的 URL: ${url}`
      }
    }
  }

  log.info(`[BrowserTool] Browsing website: ${validatedUrl}`)

  try {
    const win = getBrowserWindow()

    // 加载页面
    await win.loadURL(validatedUrl)

    // 等待页面加载完成
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`页面加载超时 (${timeout}ms)`))
      }, timeout)

      win.webContents.once('dom-ready', () => {
        clearTimeout(timeoutId)
        resolve()
      })

      win.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
        clearTimeout(timeoutId)
        reject(new Error(`页面加载失败: ${errorDescription} (code: ${errorCode})`))
      })
    })

    // 如果指定了选择器，等待该元素出现
    if (waitForSelector) {
      try {
        await win.webContents.executeJavaScript(`
          new Promise((resolve, reject) => {
            const checkElement = () => {
              const element = document.querySelector('${waitForSelector}')
              if (element) {
                resolve(true)
              } else {
                setTimeout(checkElement, 100)
              }
            }
            checkElement()
            setTimeout(() => reject(new Error('等待元素超时')), 10000)
          })
        `)
      } catch (error) {
        log.warn(`[BrowserTool] Wait for selector failed: ${waitForSelector}`, error)
        // 继续执行，不中断
      }
    }

    // 获取页面信息
    const pageInfo = await win.webContents.executeJavaScript(`
      (() => {
        // 移除脚本和样式标签，获取纯文本内容
        const clone = document.body.cloneNode(true)
        
        // 移除不需要的元素
        const scripts = clone.querySelectorAll('script, style, nav, header, footer, aside, .advertisement, .ads, .sidebar')
        scripts.forEach(el => el.remove())
        
        // 获取标题
        const title = document.title || ''
        
        // 获取主要内容
        let content = ''
        
        // 尝试获取文章主体
        const article = clone.querySelector('article, main, .content, .post-content, .entry-content, [role="main"]')
        if (article) {
          content = article.innerText
        } else {
          // 获取 body 文本
          content = clone.innerText
        }
        
        // 清理内容
        content = content
          .replace(/\\s+/g, ' ')
          .replace(/\\n\\s*\\n/g, '\\n')
          .trim()
        
        // 检查是否有 JavaScript
        const hasJavaScript = document.querySelectorAll('script').length > 0
        
        return {
          title,
          content,
          hasJavaScript
        }
      })()
    `)

    const loadTime = Date.now() - startTime
    const contentLength = pageInfo.content.length

    // 截断过长的内容
    let finalContent = pageInfo.content
    if (finalContent.length > maxLength) {
      finalContent = finalContent.substring(0, maxLength) + '\n\n... (内容已截断，原始长度: ' + finalContent.length + ' 字符)'
    }

    log.info(`[BrowserTool] Successfully loaded page: ${pageInfo.title}, content length: ${contentLength}`)

    return {
      success: true,
      title: pageInfo.title,
      url: validatedUrl,
      content: finalContent,
      metadata: {
        loadTime,
        contentLength,
        hasJavaScript: pageInfo.hasJavaScript
      }
    }

  } catch (error) {
    log.error(`[BrowserTool] Failed to browse website:`, error)
    return {
      success: false,
      url: validatedUrl,
      content: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 关闭浏览器窗口
 */
export function closeBrowserWindow(): void {
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.close()
    browserWindow = null
    log.info('[BrowserTool] Browser window closed')
  }
}

// 应用退出时清理
process.on('exit', closeBrowserWindow)
process.on('SIGINT', closeBrowserWindow)
process.on('SIGTERM', closeBrowserWindow)
