/**
 * Models for Port Architecture
 */

import { PortingBacklog, PortingModule, HistoryLog, HistoryEntry, UsageSummary, TranscriptStore } from './types'

// ============ Porting Module Implementation ============

export function createPortingModule(
  name: string,
  responsibility: string,
  sourceHint: string,
  status: 'mirrored' | 'pending' | 'completed' = 'mirrored'
): PortingModule {
  return {
    name,
    responsibility,
    sourceHint,
    status
  }
}

// ============ Porting Backlog Implementation ============

export function createPortingBacklog(title: string, modules: PortingModule[]): PortingBacklog {
  return {
    title,
    modules
  }
}

export function buildCommandBacklog(modules: PortingModule[]): PortingBacklog {
  return createPortingBacklog('Command surface', modules)
}

export function buildToolBacklog(modules: PortingModule[]): PortingBacklog {
  return createPortingBacklog('Tool surface', modules)
}

// ============ History Log Implementation ============

export class HistoryLogImpl implements HistoryLog {
  entries: HistoryEntry[] = []

  add(type: string, message: string): void {
    this.entries.push({
      type,
      message,
      timestamp: Date.now()
    })
  }

  asMarkdown(): string {
    const lines = ['## History Log', '']
    for (const entry of this.entries) {
      const time = new Date(entry.timestamp).toISOString()
      lines.push(`- [${entry.type}] ${time}: ${entry.message}`)
    }
    return lines.join('\n')
  }
}

// ============ Usage Summary Implementation ============

export class UsageSummaryImpl implements UsageSummary {
  inputTokens: number
  outputTokens: number

  constructor(inputTokens = 0, outputTokens = 0) {
    this.inputTokens = inputTokens
    this.outputTokens = outputTokens
  }

  addTurn(prompt: string, output: string): UsageSummary {
    // Simple token estimation: 1 token ≈ 4 characters
    const inputTokens = Math.ceil(prompt.length / 4)
    const outputTokens = Math.ceil(output.length / 4)
    return new UsageSummaryImpl(
      this.inputTokens + inputTokens,
      this.outputTokens + outputTokens
    )
  }
}

// ============ Transcript Store Implementation ============

export class TranscriptStoreImpl implements TranscriptStore {
  entries: string[] = []
  flushed = false

  append(entry: string): void {
    this.entries.push(entry)
  }

  compact(limit: number): void {
    if (this.entries.length > limit) {
      this.entries = this.entries.slice(-limit)
    }
  }

  replay(): string[] {
    return [...this.entries]
  }

  flush(): void {
    this.flushed = true
  }
}
