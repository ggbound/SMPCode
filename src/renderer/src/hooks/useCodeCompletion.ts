import { useState, useCallback, useRef, useEffect } from 'react'
import { useStore } from '../store'

const API_BASE = 'http://localhost:3847/api'

// Debounce delay for completion requests
const COMPLETION_DEBOUNCE_MS = 300

export interface CompletionItem {
  id: string
  text: string
  confidence: number
  range: { start: number; end: number }
}

export interface CompletionState {
  isLoading: boolean
  completions: CompletionItem[]
  activeIndex: number
  visible: boolean
}

/**
 * Hook for code completion functionality
 * Provides Copilot-style inline code completions
 */
export function useCodeCompletion() {
  const [state, setState] = useState<CompletionState>({
    isLoading: false,
    completions: [],
    activeIndex: 0,
    visible: false
  })

  const { providers, model } = useStore()
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * Get API credentials for the current model
   */
  const getApiCredentials = useCallback(() => {
    const providerForModel = providers.find(p =>
      p.enabled && p.models.some(m => m.id === model)
    )

    return {
      apiKey: providerForModel?.apiKey || '',
      apiUrl: providerForModel?.apiUrl,
      model
    }
  }, [providers, model])

  /**
   * Request completions from the API
   */
  const requestCompletions = useCallback(async (
    prefix: string,
    suffix: string,
    language: string,
    filePath: string
  ): Promise<CompletionItem[]> => {
    const { apiKey, apiUrl } = getApiCredentials()

    if (!apiKey) {
      console.warn('[useCodeCompletion] No API key available')
      return []
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    try {
      const response = await fetch(`${API_BASE}/copilot/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix,
          suffix,
          language,
          filePath,
          apiKey,
          model,
          apiUrl
        }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()

      return data.completions.map((c: { text: string; confidence: number }, index: number) => ({
        id: `completion-${Date.now()}-${index}`,
        text: c.text,
        confidence: c.confidence,
        range: { start: prefix.length, end: prefix.length + c.text.length }
      }))
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('[useCodeCompletion] Request failed:', error)
      }
      return []
    }
  }, [getApiCredentials, model])

  /**
   * Trigger completion at current cursor position
   */
  const triggerCompletion = useCallback((
    prefix: string,
    suffix: string,
    language: string,
    filePath: string
  ) => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Hide current completions if prefix is too short
    if (prefix.length < 3) {
      setState(prev => ({ ...prev, visible: false, completions: [] }))
      return
    }

    // Debounce completion request
    debounceTimerRef.current = setTimeout(async () => {
      setState(prev => ({ ...prev, isLoading: true }))

      const completions = await requestCompletions(prefix, suffix, language, filePath)

      setState({
        isLoading: false,
        completions,
        activeIndex: 0,
        visible: completions.length > 0
      })
    }, COMPLETION_DEBOUNCE_MS)
  }, [requestCompletions])

  /**
   * Accept the active completion
   */
  const acceptCompletion = useCallback((index?: number): string | null => {
    const targetIndex = index ?? state.activeIndex
    const completion = state.completions[targetIndex]

    if (!completion) return null

    setState(prev => ({ ...prev, visible: false, completions: [] }))
    return completion.text
  }, [state.completions, state.activeIndex])

  /**
   * Reject/clear completions
   */
  const rejectCompletion = useCallback(() => {
    setState(prev => ({ ...prev, visible: false, completions: [] }))
  }, [])

  /**
   * Navigate to next completion
   */
  const nextCompletion = useCallback(() => {
    setState(prev => ({
      ...prev,
      activeIndex: (prev.activeIndex + 1) % prev.completions.length
    }))
  }, [])

  /**
   * Navigate to previous completion
   */
  const prevCompletion = useCallback(() => {
    setState(prev => ({
      ...prev,
      activeIndex: prev.activeIndex === 0
        ? prev.completions.length - 1
        : prev.activeIndex - 1
    }))
  }, [])

  /**
   * Check if completions are available
   */
  const hasCompletions = useCallback(() => {
    return state.completions.length > 0 && state.visible
  }, [state.completions.length, state.visible])

  /**
   * Get the active completion text
   */
  const getActiveCompletion = useCallback(() => {
    return state.completions[state.activeIndex]?.text || null
  }, [state.completions, state.activeIndex])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  return {
    // State
    isLoading: state.isLoading,
    completions: state.completions,
    activeIndex: state.activeIndex,
    visible: state.visible,

    // Actions
    triggerCompletion,
    acceptCompletion,
    rejectCompletion,
    nextCompletion,
    prevCompletion,
    hasCompletions,
    getActiveCompletion
  }
}

export default useCodeCompletion
