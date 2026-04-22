import { useState, useCallback } from 'react'
import { useStore } from '../store'

const API_BASE = 'http://localhost:3847/api'

export interface CodeAnalysis {
  complexity: number
  dependencies: string[]
  functions: Array<{
    name: string
    line: number
    character: number
  }>
  classes: Array<{
    name: string
    line: number
    character: number
  }>
  potentialIssues: Array<{
    type: string
    message: string
    line: number
    severity: 'warning' | 'error' | 'info'
  }>
}

export interface ExplanationResult {
  explanation: string
  keyPoints: string[]
  loading: boolean
  error?: string
}

export interface RefactoringResult {
  refactoredCode: string
  explanation: string
  changes: Array<{
    type: string
    description: string
    lineRange?: { start: number; end: number }
  }>
  loading: boolean
  error?: string
}

export interface InlineEditResult {
  editedCode: string
  explanation: string
  diff: string
  loading: boolean
  error?: string
}

/**
 * Hook for code intelligence features
 * Provides code explanation, refactoring, and inline editing capabilities
 */
export function useCodeIntelligence() {
  const [analysis, setAnalysis] = useState<CodeAnalysis | null>(null)
  const [explanation, setExplanation] = useState<ExplanationResult | null>(null)
  const [refactoring, setRefactoring] = useState<RefactoringResult | null>(null)
  const [inlineEdit, setInlineEdit] = useState<InlineEditResult | null>(null)

  const { providers, model } = useStore()

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
   * Analyze code for complexity and issues
   */
  const analyzeCode = useCallback(async (
    code: string,
    language: string,
    filePath: string
  ): Promise<CodeAnalysis | null> => {
    try {
      const response = await fetch(`${API_BASE}/copilot/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          language,
          filePath
        })
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      setAnalysis(data)
      return data
    } catch (error) {
      console.error('[useCodeIntelligence] Analysis failed:', error)
      return null
    }
  }, [])

  /**
   * Explain selected code
   */
  const explainCode = useCallback(async (
    code: string,
    language: string,
    filePath: string,
    selectionRange?: { start: number; end: number }
  ): Promise<ExplanationResult | null> => {
    const { apiKey, apiUrl } = getApiCredentials()

    if (!apiKey) {
      setExplanation({
        explanation: '',
        keyPoints: [],
        loading: false,
        error: 'No API key configured'
      })
      return null
    }

    setExplanation({
      explanation: '',
      keyPoints: [],
      loading: true
    })

    try {
      const response = await fetch(`${API_BASE}/copilot/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          language,
          filePath,
          selectionRange,
          apiKey,
          model,
          apiUrl
        })
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      const result: ExplanationResult = {
        explanation: data.explanation,
        keyPoints: data.keyPoints || [],
        loading: false
      }
      setExplanation(result)
      return result
    } catch (error) {
      const result: ExplanationResult = {
        explanation: '',
        keyPoints: [],
        loading: false,
        error: String(error)
      }
      setExplanation(result)
      return result
    }
  }, [getApiCredentials, model])

  /**
   * Refactor code
   */
  const refactorCode = useCallback(async (
    code: string,
    language: string,
    filePath: string,
    refactoringType: 'improve' | 'simplify' | 'optimize' | 'fix' | 'document'
  ): Promise<RefactoringResult | null> => {
    const { apiKey, apiUrl } = getApiCredentials()

    if (!apiKey) {
      setRefactoring({
        refactoredCode: '',
        explanation: '',
        changes: [],
        loading: false,
        error: 'No API key configured'
      })
      return null
    }

    setRefactoring({
      refactoredCode: '',
      explanation: '',
      changes: [],
      loading: true
    })

    try {
      const response = await fetch(`${API_BASE}/copilot/refactor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          language,
          filePath,
          refactoringType,
          apiKey,
          model,
          apiUrl
        })
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      const result: RefactoringResult = {
        refactoredCode: data.refactoredCode,
        explanation: data.explanation,
        changes: data.changes || [],
        loading: false
      }
      setRefactoring(result)
      return result
    } catch (error) {
      const result: RefactoringResult = {
        refactoredCode: '',
        explanation: '',
        changes: [],
        loading: false,
        error: String(error)
      }
      setRefactoring(result)
      return result
    }
  }, [getApiCredentials, model])

  /**
   * Get inline edit suggestion
   */
  const getInlineEdit = useCallback(async (
    code: string,
    instruction: string,
    language: string,
    filePath: string,
    selectionRange: { start: number; end: number }
  ): Promise<InlineEditResult | null> => {
    const { apiKey, apiUrl } = getApiCredentials()

    if (!apiKey) {
      setInlineEdit({
        editedCode: '',
        explanation: '',
        diff: '',
        loading: false,
        error: 'No API key configured'
      })
      return null
    }

    setInlineEdit({
      editedCode: '',
      explanation: '',
      diff: '',
      loading: true
    })

    try {
      const response = await fetch(`${API_BASE}/copilot/inline-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          instruction,
          language,
          filePath,
          selectionRange,
          apiKey,
          model,
          apiUrl
        })
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      const result: InlineEditResult = {
        editedCode: data.editedCode,
        explanation: data.explanation,
        diff: data.diff,
        loading: false
      }
      setInlineEdit(result)
      return result
    } catch (error) {
      const result: InlineEditResult = {
        editedCode: '',
        explanation: '',
        diff: '',
        loading: false,
        error: String(error)
      }
      setInlineEdit(result)
      return result
    }
  }, [getApiCredentials, model])

  /**
   * Clear all intelligence results
   */
  const clearResults = useCallback(() => {
    setAnalysis(null)
    setExplanation(null)
    setRefactoring(null)
    setInlineEdit(null)
  }, [])

  return {
    // State
    analysis,
    explanation,
    refactoring,
    inlineEdit,

    // Actions
    analyzeCode,
    explainCode,
    refactorCode,
    getInlineEdit,
    clearResults
  }
}

export default useCodeIntelligence
