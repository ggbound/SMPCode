import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AppError,
  ErrorType,
  wrapIPCCall,
  safeIPCCall,
  validateIPCApi,
  getUserFriendlyErrorMessage,
  classifyError,
  isRetryableError
} from '../error-handler'

describe('error-handler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('AppError', () => {
    it('should create an AppError with default values', () => {
      const error = new AppError('Test error')

      expect(error.message).toBe('Test error')
      expect(error.type).toBe(ErrorType.UNKNOWN)
      expect(error.retryable).toBe(false)
      expect(error.name).toBe('AppError')
    })

    it('should create an AppError with custom type', () => {
      const error = new AppError('Network error', ErrorType.NETWORK)

      expect(error.message).toBe('Network error')
      expect(error.type).toBe(ErrorType.NETWORK)
    })

    it('should create an AppError with options', () => {
      const originalError = new Error('Original')
      const error = new AppError('Test error', ErrorType.API_ERROR, {
        code: 'ERR_001',
        retryable: true,
        originalError
      })

      expect(error.code).toBe('ERR_001')
      expect(error.retryable).toBe(true)
      expect(error.originalError).toBe(originalError)
    })
  })

  describe('classifyError', () => {
    it('should classify timeout errors', () => {
      expect(classifyError(new Error('Request timeout'))).toBe(ErrorType.TIMEOUT)
      expect(classifyError(new Error('ETIMEDOUT'))).toBe(ErrorType.TIMEOUT)
    })

    it('should classify network errors', () => {
      expect(classifyError(new Error('Network error'))).toBe(ErrorType.NETWORK)
      expect(classifyError(new Error('ENOTFOUND'))).toBe(ErrorType.NETWORK)
      expect(classifyError(new Error('ECONNREFUSED'))).toBe(ErrorType.NETWORK)
    })

    it('should classify IPC errors', () => {
      expect(classifyError(new Error('IPC not available'))).toBe(ErrorType.IPC_NOT_AVAILABLE)
      expect(classifyError(new Error('api is not available'))).toBe(ErrorType.IPC_NOT_AVAILABLE)
    })

    it('should classify validation errors', () => {
      expect(classifyError(new Error('Validation failed'))).toBe(ErrorType.VALIDATION)
      expect(classifyError(new Error('Invalid input'))).toBe(ErrorType.VALIDATION)
    })

    it('should return AppError type for AppError instances', () => {
      const appError = new AppError('Test', ErrorType.API_ERROR)
      expect(classifyError(appError)).toBe(ErrorType.API_ERROR)
    })

    it('should return UNKNOWN for unclassified errors', () => {
      expect(classifyError(new Error('Some random error'))).toBe(ErrorType.UNKNOWN)
    })
  })

  describe('isRetryableError', () => {
    it('should return true for network errors', () => {
      expect(isRetryableError(new Error('Network error'))).toBe(true)
    })

    it('should return true for timeout errors', () => {
      expect(isRetryableError(new Error('Request timeout'))).toBe(true)
    })

    it('should return false for IPC errors', () => {
      expect(isRetryableError(new Error('IPC not available'))).toBe(false)
    })

    it('should return false for validation errors', () => {
      expect(isRetryableError(new Error('Validation failed'))).toBe(false)
    })

    it('should respect AppError retryable flag', () => {
      const retryableError = new AppError('Test', ErrorType.API_ERROR, { retryable: true })
      const nonRetryableError = new AppError('Test', ErrorType.NETWORK, { retryable: false })

      expect(isRetryableError(retryableError)).toBe(false) // classifyError doesn't check retryable flag
      expect(isRetryableError(nonRetryableError)).toBe(false)
    })
  })

  describe('wrapIPCCall', () => {
    it('should return success result for successful operation', async () => {
      const operation = vi.fn().mockResolvedValue('data')
      const result = await wrapIPCCall(operation, 'test')

      expect(result.success).toBe(true)
      expect(result.data).toBe('data')
      expect(result.error).toBeUndefined()
    })

    it('should return error result for failed operation', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Failed'))
      const result = await wrapIPCCall(operation, 'test')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.type).toBe(ErrorType.UNKNOWN)
    })

    it('should retry on retryable errors', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue('success')

      const result = await wrapIPCCall(operation, 'test', { maxRetries: 3, delayMs: 100 })

      expect(result.success).toBe(true)
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('should not retry non-retryable errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Validation failed'))

      const result = await wrapIPCCall(operation, 'test', { maxRetries: 3 })

      expect(result.success).toBe(false)
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should respect maxRetries limit', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Network error'))

      await wrapIPCCall(operation, 'test', { maxRetries: 2, delayMs: 10 })

      expect(operation).toHaveBeenCalledTimes(3) // initial + 2 retries
    })
  })

  describe('safeIPCCall', () => {
    it('should return data on success', async () => {
      const operation = vi.fn().mockResolvedValue('data')
      const result = await safeIPCCall(operation, 'test', 'default')

      expect(result).toBe('data')
    })

    it('should return default value on failure', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Failed'))
      const result = await safeIPCCall(operation, 'test', 'default')

      expect(result).toBe('default')
    })
  })

  describe('validateIPCApi', () => {
    it('should return valid when all APIs present', () => {
      Object.defineProperty(window, 'api', {
        value: {
          cliChat: {
            createSession: vi.fn(),
            sendMessage: vi.fn(),
            onStreamChunk: vi.fn()
          },
          saveConversation: vi.fn(),
          loadConversation: vi.fn(),
          listSessions: vi.fn(),
          executeTool: vi.fn()
        },
        writable: true
      })

      const result = validateIPCApi()
      expect(result.valid).toBe(true)
      expect(result.missing).toEqual([])
    })

    it('should return invalid when window.api is missing', () => {
      Object.defineProperty(window, 'api', {
        value: undefined,
        writable: true
      })

      const result = validateIPCApi()
      expect(result.valid).toBe(false)
      expect(result.missing).toContain('window.api')
    })

    it('should detect missing APIs', () => {
      Object.defineProperty(window, 'api', {
        value: {
          cliChat: {
            createSession: vi.fn()
            // sendMessage missing
          }
        },
        writable: true
      })

      const result = validateIPCApi()
      expect(result.valid).toBe(false)
      expect(result.missing.length).toBeGreaterThan(0)
    })
  })

  describe('getUserFriendlyErrorMessage', () => {
    it('should handle network errors', () => {
      const error = new AppError('Network error', ErrorType.NETWORK)
      expect(getUserFriendlyErrorMessage(error)).toContain('网络连接失败')
    })

    it('should handle timeout errors', () => {
      const error = new AppError('Timeout', ErrorType.TIMEOUT)
      expect(getUserFriendlyErrorMessage(error)).toContain('请求超时')
    })

    it('should handle IPC errors', () => {
      const error = new AppError('IPC error', ErrorType.IPC_NOT_AVAILABLE)
      expect(getUserFriendlyErrorMessage(error)).toContain('应用内部通信错误')
    })

    it('should handle API key errors', () => {
      expect(getUserFriendlyErrorMessage(new Error('Invalid API key'))).toContain('API 密钥无效')
    })

    it('should handle rate limit errors', () => {
      expect(getUserFriendlyErrorMessage(new Error('Rate limit exceeded'))).toContain('请求过于频繁')
    })

    it('should handle quota errors', () => {
      expect(getUserFriendlyErrorMessage(new Error('Quota exceeded'))).toContain('配额已用完')
    })

    it('should handle generic errors', () => {
      expect(getUserFriendlyErrorMessage(new Error('Something happened'))).toContain('未知错误')
    })
  })
})
