/**
 * Port Runtime - Based on claw-code/src/runtime.py
 */

import {
  RoutedMatch,
  RuntimeSession,
  PortContext,
  WorkspaceSetup,
  SetupReport,
  TurnResult,
  PermissionDenial
} from './types'
import { PORTED_COMMANDS, executeCommand } from './commands'
import { PORTED_TOOLS } from './tools'
import { buildPortContext, renderContext } from './context'
import { runSetup, buildSystemInitMessage } from './setup'
import { HistoryLogImpl, UsageSummaryImpl } from './models'
import { QueryEnginePort } from './query-engine'
import { buildExecutionRegistry } from './execution-registry'
import { ToolPermissionContextImpl, inferPermissionDenials } from './permissions'

export type { RoutedMatch }

export class RuntimeSessionImpl implements RuntimeSession {
  prompt: string
  context: PortContext
  setup: WorkspaceSetup
  setupReport: SetupReport
  systemInitMessage: string
  history: HistoryLogImpl
  routedMatches: RoutedMatch[]
  turnResult: TurnResult
  commandExecutionMessages: string[]
  toolExecutionMessages: string[]
  streamEvents: Record<string, unknown>[]
  persistedSessionPath: string

  constructor(
    prompt: string,
    context: PortContext,
    setup: WorkspaceSetup,
    setupReport: SetupReport,
    systemInitMessage: string,
    history: HistoryLogImpl,
    routedMatches: RoutedMatch[],
    turnResult: TurnResult,
    commandExecutionMessages: string[],
    toolExecutionMessages: string[],
    streamEvents: Record<string, unknown>[],
    persistedSessionPath: string
  ) {
    this.prompt = prompt
    this.context = context
    this.setup = setup
    this.setupReport = setupReport
    this.systemInitMessage = systemInitMessage
    this.history = history
    this.routedMatches = routedMatches
    this.turnResult = turnResult
    this.commandExecutionMessages = commandExecutionMessages
    this.toolExecutionMessages = toolExecutionMessages
    this.streamEvents = streamEvents
    this.persistedSessionPath = persistedSessionPath
  }

  asMarkdown(): string {
    const lines = [
      '# Runtime Session',
      '',
      `Prompt: ${this.prompt}`,
      '',
      '## Context',
      renderContext(this.context),
      '',
      '## Setup',
      `- Node.js: ${this.setup.pythonVersion} (${this.setup.implementation})`,
      `- Platform: ${this.setup.platformName}`,
      `- Test command: ${this.setup.testCommand}`,
      '',
      '## Startup Steps',
      ...this.setupReport.startupSteps.map(step => `- ${step}`),
      '',
      '## System Init',
      this.systemInitMessage,
      '',
      '## Routed Matches',
      ...(this.routedMatches.length > 0
        ? this.routedMatches.map(
            match =>
              `- [${match.kind}] ${match.name} (${match.score}) — ${match.sourceHint}`
          )
        : ['- none']),
      '',
      '## Command Execution',
      ...(this.commandExecutionMessages.length > 0
        ? this.commandExecutionMessages
        : ['none']),
      '',
      '## Tool Execution',
      ...(this.toolExecutionMessages.length > 0 ? this.toolExecutionMessages : ['none']),
      '',
      '## Stream Events',
      ...this.streamEvents.map(event => `- ${event.type}: ${JSON.stringify(event)}`),
      '',
      '## Turn Result',
      this.turnResult.output,
      '',
      `Persisted session path: ${this.persistedSessionPath}`,
      '',
      this.history.asMarkdown()
    ]
    return lines.join('\n')
  }
}

export class PortRuntime {
  routePrompt(prompt: string, limit = 5): RoutedMatch[] {
    const tokens = new Set(
      prompt
        .toLowerCase()
        .replace(/[/\-]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 0)
    )

    const byKind: Record<string, RoutedMatch[]> = {
      command: this.collectMatches(tokens, PORTED_COMMANDS, 'command'),
      tool: this.collectMatches(tokens, PORTED_TOOLS, 'tool')
    }

    const selected: RoutedMatch[] = []
    for (const kind of ['command', 'tool']) {
      if (byKind[kind].length > 0) {
        selected.push(byKind[kind].shift()!)
      }
    }

    const leftovers = [...byKind['command'], ...byKind['tool']].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      return a.name.localeCompare(b.name)
    })

    selected.push(...leftovers.slice(0, Math.max(0, limit - selected.length)))
    return selected.slice(0, limit)
  }

  bootstrapSession(prompt: string, limit = 5): RuntimeSession {
    const context = buildPortContext()
    const setupReport = runSetup(true)
    const setup = setupReport.setup
    const history = new HistoryLogImpl()
    const engine = QueryEnginePort.fromWorkspace()

    history.add('context', `python_files=${context.pythonFileCount}, archive_available=${context.archiveAvailable}`)
    history.add('registry', `commands=${PORTED_COMMANDS.length}, tools=${PORTED_TOOLS.length}`)

    const matches = this.routePrompt(prompt, limit)
    const registry = buildExecutionRegistry()

    const commandExecs: string[] = []
    const toolExecs: string[] = []

    for (const match of matches) {
      if (match.kind === 'command') {
        const executor = registry.getCommand(match.name)
        if (executor) {
          commandExecs.push(executor.execute(prompt))
        }
      } else if (match.kind === 'tool') {
        const executor = registry.getTool(match.name)
        if (executor) {
          toolExecs.push(executor.execute(prompt))
        }
      }
    }

    const denials = this.inferPermissionDenials(matches)
    const streamEvents: Record<string, unknown>[] = []

    // Generate stream events
    const streamGenerator = engine.streamSubmitMessage(
      prompt,
      matches.filter(m => m.kind === 'command').map(m => m.name),
      matches.filter(m => m.kind === 'tool').map(m => m.name),
      denials
    )

    for (const event of streamGenerator) {
      streamEvents.push(event as Record<string, unknown>)
    }

    const turnResult = engine.submitMessage(
      prompt,
      matches.filter(m => m.kind === 'command').map(m => m.name),
      matches.filter(m => m.kind === 'tool').map(m => m.name),
      denials
    )

    const persistedSessionPath = engine.persistSession()

    history.add('routing', `matches=${matches.length} for prompt=${JSON.stringify(prompt)}`)
    history.add('execution', `command_execs=${commandExecs.length} tool_execs=${toolExecs.length}`)
    history.add(
      'turn',
      `commands=${turnResult.matchedCommands.length} tools=${turnResult.matchedTools.length} denials=${turnResult.permissionDenials.length} stop=${turnResult.stopReason}`
    )
    history.add('session_store', persistedSessionPath)

    return new RuntimeSessionImpl(
      prompt,
      context,
      setup,
      setupReport,
      buildSystemInitMessage(true),
      history,
      matches,
      turnResult,
      commandExecs,
      toolExecs,
      streamEvents,
      persistedSessionPath
    )
  }

  runTurnLoop(
    prompt: string,
    limit = 5,
    maxTurns = 3,
    structuredOutput = false
  ): TurnResult[] {
    const engine = QueryEnginePort.fromWorkspace()
    engine.config = {
      ...engine.config,
      maxTurns,
      structuredOutput
    }

    const matches = this.routePrompt(prompt, limit)
    const commandNames = matches.filter(m => m.kind === 'command').map(m => m.name)
    const toolNames = matches.filter(m => m.kind === 'tool').map(m => m.name)

    const results: TurnResult[] = []

    for (let turn = 0; turn < maxTurns; turn++) {
      const turnPrompt = turn === 0 ? prompt : `${prompt} [turn ${turn + 1}]`
      const result = engine.submitMessage(turnPrompt, commandNames, toolNames, [])
      results.push(result)

      if (result.stopReason !== 'completed') {
        break
      }
    }

    return results
  }

  private inferPermissionDenials(matches: RoutedMatch[]): PermissionDenial[] {
    const toolNames = matches.filter(m => m.kind === 'tool').map(m => m.name)
    const context = new ToolPermissionContextImpl()
    return inferPermissionDenials(toolNames, context)
  }

  private collectMatches(
    tokens: Set<string>,
    modules: PortingModule[],
    kind: 'command' | 'tool'
  ): RoutedMatch[] {
    const matches: RoutedMatch[] = []

    for (const module of modules) {
      const score = this.score(tokens, module)
      if (score > 0) {
        matches.push({
          kind,
          name: module.name,
          sourceHint: module.sourceHint,
          score
        })
      }
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.name.localeCompare(b.name)
    })

    return matches
  }

  private score(tokens: Set<string>, module: PortingModule): number {
    const haystacks = [
      module.name.toLowerCase(),
      module.sourceHint.toLowerCase(),
      module.responsibility.toLowerCase()
    ]

    let score = 0
    for (const token of tokens) {
      if (haystacks.some(haystack => haystack.includes(token))) {
        score++
      }
    }
    return score
  }
}

// Import PortingModule for type reference
import { PortingModule } from './types'
