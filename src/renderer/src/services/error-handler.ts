/**
 * Error Handler Service - 统一错误处理服务
 * 提供 IPC 调用的错误处理、重试、日志记录
 */

// 错误类型定义
export enum ErrorType {
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',
  IPC_NOT_AVAILABLE = 'IPC_NOT_AVAILABLE',
  API_ERROR = 'API_ERROR',
  VALIDATION = 'VALIDATION',
  UNKNOWN = 'UNKNOWN'
}

// 自定义错误类
export class AppError extends Error {
  public readonly type: ErrorType
  public readonly code?: string
  public readonly retryable: boolean
  public readonly originalError?: unknown

  constructor(
    message: string,
    type: ErrorType = ErrorType.UNKNOWN,
    options: {
      code?: string
      retryable?: boolean
      originalError?: unknown
    } = {}
  ) {
    super(message)
    this.name = 'AppError'
    this.type = type
    this.code = options.code
    this.retryable = options.retryable ?? false
    this.originalError = options.originalError
  }
}

// IPC 调用结果
export interface IPCResult<T> {
  success: boolean
  data?: T
  error?: AppError
}

// 重试配置
export interface RetryConfig {
  maxRetries: number
  delayMs: number
  backoffMultiplier: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  delayMs: 1000,
  backoffMultiplier: 2
}

// 延迟函数
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 检测错误类型
function classifyError(error: unknown): ErrorType {
  if (error instanceof AppError) {
    return error.type
  }

  const errorMessage = String(error).toLowerCase()

  if (errorMessage.includes('timeout') || errorMessage.includes('etimedout')) {
    return ErrorType.TIMEOUT
  }

  if (errorMessage.includes('network') || errorMessage.includes('enotfound') || errorMessage.includes('econnrefused')) {
    return ErrorType.NETWORK
  }

  if (errorMessage.includes('ipc') || errorMessage.includes('not available')) {
    return ErrorType.IPC_NOT_AVAILABLE
  }

  if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
    return ErrorType.VALIDATION
  }

  return ErrorType.UNKNOWN
}

// 检测是否可重试
function isRetryableError(error: unknown): boolean {
  const errorType = classifyError(error)
  return errorType === ErrorType.NETWORK || errorType === ErrorType.TIMEOUT
}

/**
 * 包装 IPC 调用，提供统一的错误处理
 */
export async function wrapIPCCall<T>(
  operation: () => Promise<T>,
  operationName: string,
  retryConfig: Partial<RetryConfig> = {}
): Promise<IPCResult<T>> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
  let lastError: unknown
  let currentDelay = config.delayMs

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await operation()
      return { success: true, data: result }
    } catch (error) {
      lastError = error
      const errorType = classifyError(error)
      const retryable = isRetryableError(error) && attempt < config.maxRetries

      console.error(`[ErrorHandler] ${operationName} failed (attempt ${attempt + 1}/${config.maxRetries + 1}):`, error)

      if (!retryable) {
        break
      }

      console.log(`[ErrorHandler] Retrying ${operationName} in ${currentDelay}ms...`)
      await delay(currentDelay)
      currentDelay *= config.backoffMultiplier
    }
  }

  // 所有重试都失败了
  const errorType = classifyError(lastError)
  const appError = new AppError(
    `Operation "${operationName}" failed after ${config.maxRetries + 1} attempts: ${String(lastError)}`,
    errorType,
    {
      retryable: false,
      originalError: lastError
    }
  )

  return { success: false, error: appError }
}

/**
 * 安全执行 IPC 调用，失败时返回默认值
 */
export async function safeIPCCall<T>(
  operation: () => Promise<T>,
  operationName: string,
  defaultValue: T,
  retryConfig?: Partial<RetryConfig>
): Promise<T> {
  const result = await wrapIPCCall(operation, operationName, retryConfig)
  if (result.success) {
    return result.data as T
  }
  console.warn(`[ErrorHandler] ${operationName} failed, using default value:`, result.error)
  return defaultValue
}

/**
 * 验证 IPC API 是否可用
 */
export function validateIPCApi(): { valid: boolean; missing: string[] } {
  const missing: string[] = []

  if (!window.api) {
    missing.push('window.api')
    return { valid: false, missing }
  }

  // 检查关键 API
  const requiredApis = [
    { name: 'cliChat', methods: ['createSession', 'sendMessage'] },
    { name: 'saveConversation', methods: [] },
    { name: 'loadConversation', methods: [] },
    { name: 'listSessions', methods: [] },
    { name: 'executeTool', methods: [] }
  ]

  for (const api of requiredApis) {
    const apiObj = (window.api as any)[api.name]
    if (!apiObj) {
      missing.push(`api.${api.name}`)
    } else if (api.methods.length > 0) {
      for (const method of api.methods) {
        if (typeof apiObj[method] !== 'function') {
          missing.push(`api.${api.name}.${method}`)
        }
      }
    }
  }

  return { valid: missing.length === 0, missing }
}

/**
 * 用户友好的错误消息
 */
export function getUserFriendlyErrorMessage(error: AppError | Error | unknown): string {
  if (error instanceof AppError) {
    switch (error.type) {
      case ErrorType.NETWORK:
        return '网络连接失败，请检查网络设置后重试'
      case ErrorType.TIMEOUT:
        return '请求超时，请稍后重试'
      case ErrorType.IPC_NOT_AVAILABLE:
        return '应用内部通信错误，请重启应用后重试'
      case ErrorType.API_ERROR:
        return `API 错误: ${error.message}`
      case ErrorType.VALIDATION:
        return `输入错误: ${error.message}`
      default:
        return `发生错误: ${error.message}`
    }
  }

  const errorMessage = String(error).toLowerCase()

  if (errorMessage.includes('api key')) {
    return 'API 密钥无效或未配置，请在设置中配置 API 密钥'
  }

  if (errorMessage.includes('rate limit')) {
    return '请求过于频繁，请稍后再试'
  }

  if (errorMessage.includes('quota')) {
    return 'API 配额已用完，请检查账户余额'
  }

  return '发生未知错误，请稍后重试'
}

/**
 * 全局错误处理器
 */
export function setupGlobalErrorHandler(): void {
  // 处理未捕获的 Promise 错误
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[GlobalError] Unhandled promise rejection:', event.reason)
    event.preventDefault()
  })

  // 处理全局错误
  window.addEventListener('error', (event) => {
    // 忽略 ResizeObserver 警告（这是一个已知的 Chrome 警告，不影响功能）
    if (event.message && event.message.includes('ResizeObserver loop completed with undelivered notifications')) {
      event.preventDefault()
      return
    }

    // 收集更多上下文信息
    const errorInfo = {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
      target: event.target instanceof HTMLElement ? event.target.tagName : 'unknown'
    }
    
    if (event.error) {
      console.error('[GlobalError] Global error:', event.error)
    } else {
      // 可能是资源加载错误
      console.error('[GlobalError] Resource or script error:', errorInfo)
    }
    event.preventDefault()
  }, true) // 使用捕获阶段以捕获更多错误

  console.log('[ErrorHandler] Global error handlers installed')
}

// IPC 调用装饰器 - 用于简化 IPC 调用
export function createIPCCaller<TArgs extends any[], TReturn>(
  operation: (...args: TArgs) => Promise<TReturn>,
  operationName: string,
  defaultValue?: TReturn
) {
  return async (...args: TArgs): Promise<TReturn> => {
    if (defaultValue !== undefined) {
      return safeIPCCall(() => operation(...args), operationName, defaultValue)
    }

    const result = await wrapIPCCall(() => operation(...args), operationName)
    if (!result.success) {
      throw result.error
    }
    return result.data as TReturn
  }
}

export default {
  AppError,
  ErrorType,
  wrapIPCCall,
  safeIPCCall,
  validateIPCApi,
  getUserFriendlyErrorMessage,
  setupGlobalErrorHandler,
  createIPCCaller
}
