/**
 * Query Engine - Based on claw-code/src/query_engine.py
 */

import { v4 as uuidv4 } from 'uuid'
import {
  QueryEngineConfig,
  TurnResult,
  UsageSummary,
  PermissionDenial,
  StreamEvent,
  PortManifest
} from './types'
import { UsageSummaryImpl, TranscriptStoreImpl, HistoryLogImpl } from './models'
import { buildPortManifest } from './port-manifest'
import { saveSession, loadSession, createStoredSession } from './session-store'

export class QueryEnginePort {
  manifest: PortManifest
  config: QueryEngineConfig
  sessionId: string
  mutableMessages: string[] = []
  permissionDenials: PermissionDenial[] = []
  totalUsage: UsageSummary
  transcriptStore: TranscriptStoreImpl

  constructor(manifest: PortManifest, config?: QueryEngineConfig, sessionId?: string) {
    this.manifest = manifest
    this.config = config || {
      maxTurns: 8,
      maxBudgetTokens: 2000,
      compactAfterTurns: 12,
      structuredOutput: false,
      structuredRetryLimit: 2
    }
    this.sessionId = sessionId || uuidv4().replace(/-/g, '')
    this.totalUsage = new UsageSummaryImpl()
    this.transcriptStore = new TranscriptStoreImpl()
  }

  static fromWorkspace(): QueryEnginePort {
    return new QueryEnginePort(buildPortManifest())
  }

  static fromSavedSession(sessionId: string): QueryEnginePort | null {
    const stored = loadSession(sessionId)
    if (!stored) {
      return null
    }

    const transcript = new TranscriptStoreImpl()
    transcript.entries = [...stored.messages]
    transcript.flushed = true

    const engine = new QueryEnginePort(buildPortManifest(), undefined, sessionId)
    engine.mutableMessages = [...stored.messages]
    engine.totalUsage = new UsageSummaryImpl(stored.inputTokens, stored.outputTokens)
    engine.transcriptStore = transcript
    return engine
  }

  submitMessage(
    prompt: string,
    matchedCommands: string[] = [],
    matchedTools: string[] = [],
    deniedTools: PermissionDenial[] = []
  ): TurnResult {
    if (this.mutableMessages.length >= this.config.maxTurns) {
      const output = `Max turns reached before processing prompt: ${prompt}`
      return {
        prompt,
        output,
        matchedCommands,
        matchedTools,
        permissionDenials: deniedTools,
        usage: this.totalUsage,
        stopReason: 'max_turns_reached'
      }
    }

    const summaryLines = [
      `Prompt: ${prompt}`,
      `Matched commands: ${matchedCommands.length > 0 ? matchedCommands.join(', ') : 'none'}`,
      `Matched tools: ${matchedTools.length > 0 ? matchedTools.join(', ') : 'none'}`,
      `Permission denials: ${deniedTools.length}`
    ]

    const output = this.formatOutput(summaryLines)
    const projectedUsage = this.totalUsage.addTurn(prompt, output)
    
    let stopReason: TurnResult['stopReason'] = 'completed'
    if (projectedUsage.inputTokens + projectedUsage.outputTokens > this.config.maxBudgetTokens) {
      stopReason = 'max_budget_reached'
    }

    this.mutableMessages.push(prompt)
    this.transcriptStore.append(prompt)
    this.permissionDenials.push(...deniedTools)
    this.totalUsage = projectedUsage
    this.compactMessagesIfNeeded()

    return {
      prompt,
      output,
      matchedCommands,
      matchedTools,
      permissionDenials: deniedTools,
      usage: this.totalUsage,
      stopReason
    }
  }

  *streamSubmitMessage(
    prompt: string,
    matchedCommands: string[] = [],
    matchedTools: string[] = [],
    deniedTools: PermissionDenial[] = []
  ): Generator<StreamEvent> {
    yield { type: 'message_start', sessionId: this.sessionId, prompt }
    
    if (matchedCommands.length > 0) {
      yield { type: 'command_match', commands: matchedCommands }
    }
    
    if (matchedTools.length > 0) {
      yield { type: 'tool_match', tools: matchedTools }
    }
    
    if (deniedTools.length > 0) {
      yield { type: 'permission_denial', denials: deniedTools.map(d => d.toolName) }
    }

    const result = this.submitMessage(prompt, matchedCommands, matchedTools, deniedTools)
    
    yield { type: 'message_delta', text: result.output }
    yield {
      type: 'message_stop',
      usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      stopReason: result.stopReason,
      transcriptSize: this.transcriptStore.entries.length
    }
  }

  compactMessagesIfNeeded(): void {
    if (this.mutableMessages.length > this.config.compactAfterTurns) {
      this.mutableMessages = this.mutableMessages.slice(-this.config.compactAfterTurns)
    }
    this.transcriptStore.compact(this.config.compactAfterTurns)
  }

  replayUserMessages(): string[] {
    return this.transcriptStore.replay()
  }

  flushTranscript(): void {
    this.transcriptStore.flush()
  }

  persistSession(): string {
    this.flushTranscript()
    const session = createStoredSession(
      this.sessionId,
      this.mutableMessages,
      this.totalUsage.inputTokens,
      this.totalUsage.outputTokens
    )
    return saveSession(session)
  }

  private formatOutput(summaryLines: string[]): string {
    if (this.config.structuredOutput) {
      const payload = {
        summary: summaryLines,
        sessionId: this.sessionId
      }
      return this.renderStructuredOutput(payload)
    }
    return summaryLines.join('\n')
  }

  private renderStructuredOutput(payload: Record<string, unknown>): string {
    let lastError: Error | null = null
    
    for (let i = 0; i < this.config.structuredRetryLimit; i++) {
      try {
        return JSON.stringify(payload, null, 2)
      } catch (exc) {
        lastError = exc as Error
        payload = { summary: ['structured output retry'], sessionId: this.sessionId }
      }
    }
    
    throw new Error('structured output rendering failed', { cause: lastError })
  }

  renderSummary(): string {
    const sections = [
      '# Query Engine Summary',
      '',
      this.manifest.toMarkdown(),
      '',
      `Session id: ${this.sessionId}`,
      `Conversation turns stored: ${this.mutableMessages.length}`,
      `Permission denials tracked: ${this.permissionDenials.length}`,
      `Usage totals: in=${this.totalUsage.inputTokens} out=${this.totalUsage.outputTokens}`,
      `Max turns: ${this.config.maxTurns}`,
      `Max budget tokens: ${this.config.maxBudgetTokens}`,
      `Transcript flushed: ${this.transcriptStore.flushed}`
    ]
    
    return sections.join('\n')
  }
}
