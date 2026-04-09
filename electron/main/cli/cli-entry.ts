#!/usr/bin/env node
/**
 * CLI 主入口
 * 基于 Commander.js 构建的子命令系统
 */

import { Command } from 'commander'
import { join } from 'path'
import { readFileSync } from 'fs'
import log from 'electron-log'
import { runtimeEngine, createSession, executeTurn, runTurnLoop } from './runtime-engine'
import { commandRegistry, getAllCommands } from './command-registry'
import { toolRegistry, getAllTools } from './tool-registry'
import { initConfigStore, loadConfig } from '../config-service'

// 读取 package.json 获取版本
const packagePath = join(__dirname, '../../../../package.json')
let version = '0.1.0'
try {
  const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
  version = pkg.version
} catch {
  // 使用默认版本
}

// CLI 程序实例（延迟初始化）
let programInstance: Command | null = null

/**
 * 获取或创建 CLI 程序实例
 */
export function getCLIProgram(): Command {
  if (!programInstance) {
    // 初始化配置存储
    initConfigStore()
    
    // 创建 CLI 程序
    programInstance = createCLIProgram()
  }
  return programInstance
}

/**
 * 创建 CLI 程序
 */
function createCLIProgram(): Command {
  const program = new Command()

  program
    .name('smp-code')
    .description('SMP Code - AI-powered coding assistant CLI')
    .version(version)
    .option('-v, --verbose', 'verbose output')
    .option('--cwd <path>', 'working directory', process.cwd())

  // chat 命令 - 交互式对话
  program
    .command('chat')
    .description('Start an interactive chat session')
    .option('-m, --model <model>', 'AI model to use')
    .option('-s, --session <id>', 'resume existing session')
    .action(async (options) => {
      try {
        log.info('[CLI] Starting chat session...')
        const config = loadConfig()
        
        console.log('╔════════════════════════════════════╗')
        console.log('║     SMP Code - Interactive Chat    ║')
        console.log('╚════════════════════════════════════╝')
        console.log(`Working Directory: ${program.opts().cwd}`)
        console.log(`Model: ${options.model || config.defaultModel || 'default'}`)
        console.log('\nType your message or "exit" to quit.\n')

        // 这里可以集成 readline 实现真正的交互
        // 简化版：执行单次提示
        const session = createSession('Interactive chat', program.opts().cwd)
        console.log(`Session created: ${session.id}`)
        console.log('\nNote: Full interactive mode requires readline integration.')
        console.log('Use "smp-code run <prompt>" for single-turn execution.')
      } catch (error) {
        console.error('Error:', error)
        process.exit(1)
      }
    })

  // run 命令 - 单次执行提示
  program
    .command('run <prompt>')
    .description('Execute a single prompt')
    .option('-t, --turns <n>', 'maximum number of turns', '3')
    .option('--strict', 'strict permission mode')
    .option('--json', 'output as JSON')
    .action(async (prompt, options) => {
      try {
        log.info(`[CLI] Executing prompt: ${prompt}`)
        const cwd = program.opts().cwd
        const maxTurns = parseInt(options.turns, 10)
        
        console.log(`Executing: "${prompt}"`)
        console.log(`Working Directory: ${cwd}`)
        console.log(`Max Turns: ${maxTurns}`)
        console.log('─'.repeat(50))

        const results = await runTurnLoop(prompt, cwd, maxTurns)

        if (options.json) {
          console.log(JSON.stringify(results, null, 2))
        } else {
          for (let i = 0; i < results.length; i++) {
            const result = results[i]
            console.log(`\n## Turn ${i + 1}`)
            console.log(result.output)
            console.log(`\nStop Reason: ${result.stopReason}`)
            console.log(`Tokens: ${result.inputTokens} in / ${result.outputTokens} out`)
          }
        }

        // 显示最终摘要
        const lastResult = results[results.length - 1]
        console.log('\n' + '─'.repeat(50))
        console.log(`Total Turns: ${results.length}`)
        console.log(`Final Stop Reason: ${lastResult.stopReason}`)
      } catch (error) {
        console.error('Error:', error)
        process.exit(1)
      }
    })

  // exec 命令 - 执行特定命令
  program
    .command('exec <command>')
    .description('Execute a specific command')
    .option('-p, --prompt <text>', 'prompt for the command', '')
    .option('--json', 'output as JSON')
    .action(async (commandName, options) => {
      try {
        log.info(`[CLI] Executing command: ${commandName}`)
        const cwd = program.opts().cwd
        
        const result = await commandRegistry.execute(commandName, options.prompt, {
          cwd,
          config: loadConfig() as unknown as Record<string, unknown>
        })

        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
        } else {
          console.log(result.message)
          if (!result.success) {
            process.exit(1)
          }
        }
      } catch (error) {
        console.error('Error:', error)
        process.exit(1)
      }
    })

  // status 命令 - 显示状态
  program
    .command('status')
    .description('Show system status')
    .option('--json', 'output as JSON')
    .action(async (options) => {
      try {
        const config = loadConfig()
        const commands = getAllCommands()
        const tools = getAllTools()
        const sessions = runtimeEngine.getAllSessions()

        const status = {
          version,
          cwd: program.opts().cwd,
          config: {
            providers: config.providers?.length || 0,
            defaultModel: config.defaultModel || 'not set'
          },
          registry: {
            commands: commands.length,
            tools: tools.length
          },
          sessions: {
            active: sessions.length,
            totalTokens: sessions.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0)
          }
        }

        if (options.json) {
          console.log(JSON.stringify(status, null, 2))
        } else {
          console.log('╔════════════════════════════════════╗')
          console.log('║         SMP Code Status            ║')
          console.log('╚════════════════════════════════════╝')
          console.log(`Version: ${status.version}`)
          console.log(`Working Directory: ${status.cwd}`)
          console.log('\n## Configuration')
          console.log(`  Providers: ${status.config.providers}`)
          console.log(`  Default Model: ${status.config.defaultModel}`)
          console.log('\n## Registry')
          console.log(`  Commands: ${status.registry.commands}`)
          console.log(`  Tools: ${status.registry.tools}`)
          console.log('\n## Sessions')
          console.log(`  Active: ${status.sessions.active}`)
          console.log(`  Total Tokens: ${status.sessions.totalTokens}`)
        }
      } catch (error) {
        console.error('Error:', error)
        process.exit(1)
      }
    })

  // config 命令 - 配置管理
  const configCmd = program
    .command('config')
    .description('Manage configuration')

  configCmd
    .command('show')
    .description('Show current configuration')
    .option('--json', 'output as JSON')
    .action(async (options) => {
      try {
        const config = loadConfig()
        if (options.json) {
          console.log(JSON.stringify(config, null, 2))
        } else {
          console.log('╔════════════════════════════════════╗')
          console.log('║      SMP Code Configuration        ║')
          console.log('╚════════════════════════════════════╝')
          console.log(JSON.stringify(config, null, 2))
        }
      } catch (error) {
        console.error('Error:', error)
        process.exit(1)
      }
    })

  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key, value) => {
      try {
        const config = loadConfig()
        // 尝试解析 JSON 值
        let parsedValue: unknown = value
        try {
          parsedValue = JSON.parse(value)
        } catch {
          // 保持为字符串
        }
        
        // 设置值
        const configRecord = config as unknown as Record<string, unknown>
        configRecord[key] = parsedValue
        
        console.log(`Set ${key} = ${JSON.stringify(parsedValue)}`)
        console.log('Note: Use the GUI or edit config file to persist changes.')
      } catch (error) {
        console.error('Error:', error)
        process.exit(1)
      }
    })

  // commands 命令 - 列出命令
  program
    .command('commands')
    .description('List available commands')
    .option('-q, --query <text>', 'search query')
    .option('-l, --limit <n>', 'limit results', '20')
    .action(async (options) => {
      try {
        const limit = parseInt(options.limit, 10)
        const commands = options.query
          ? commandRegistry.search(options.query, limit)
          : getAllCommands().slice(0, limit)

        console.log(`Command entries: ${commands.length}`)
        console.log('')
        for (const cmd of commands) {
          console.log(`- ${cmd.name} — ${cmd.sourceHint}`)
          console.log(`  ${cmd.responsibility}`)
        }
      } catch (error) {
        console.error('Error:', error)
        process.exit(1)
      }
    })

  // tools 命令 - 列出工具
  program
    .command('tools')
    .description('List available tools')
    .option('-q, --query <text>', 'search query')
    .option('-l, --limit <n>', 'limit results', '20')
    .action(async (options) => {
      try {
        const limit = parseInt(options.limit, 10)
        const tools = options.query
          ? toolRegistry.search(options.query, limit)
          : getAllTools().slice(0, limit)

        console.log(`Tool entries: ${tools.length}`)
        console.log('')
        for (const tool of tools) {
          console.log(`- ${tool.name} — ${tool.sourceHint}`)
          console.log(`  ${tool.responsibility}`)
          console.log(`  Parameters: ${Object.keys(tool.parameters).join(', ')}`)
        }
      } catch (error) {
        console.error('Error:', error)
        process.exit(1)
      }
    })

  // session 命令 - 会话管理
  const sessionCmd = program
    .command('session')
    .description('Manage sessions')

  sessionCmd
    .command('list')
    .description('List active sessions')
    .action(async () => {
      const sessions = runtimeEngine.getAllSessions()
      console.log(`Active sessions: ${sessions.length}`)
      console.log('')
      for (const session of sessions) {
        console.log(`- ${session.id}`)
        console.log(`  Prompt: ${session.prompt}`)
        console.log(`  Messages: ${session.messages.length}`)
        console.log(`  Tokens: ${session.inputTokens} in / ${session.outputTokens} out`)
      }
    })

  sessionCmd
    .command('show <id>')
    .description('Show session details')
    .action(async (id) => {
      const summary = runtimeEngine.renderSessionSummary(id)
      console.log(summary)
    })

  sessionCmd
    .command('delete <id>')
    .description('Delete a session')
    .action(async (id) => {
      const deleted = runtimeEngine.deleteSession(id)
      if (deleted) {
        console.log(`Deleted session: ${id}`)
      } else {
        console.error(`Session not found: ${id}`)
        process.exit(1)
      }
    })

  // 路由命令 - 测试路由
  program
    .command('route <prompt>')
    .description('Route a prompt and show matches')
    .option('-l, --limit <n>', 'limit results', '5')
    .action(async (prompt, options) => {
      try {
        const limit = parseInt(options.limit, 10)
        const matches = runtimeEngine.routePrompt(prompt, limit)

        console.log(`Prompt: "${prompt}"`)
        console.log(`Matches: ${matches.length}`)
        console.log('')
        for (const match of matches) {
          console.log(`[${match.kind}] ${match.name} (score: ${match.score})`)
          console.log(`  Source: ${match.sourceHint}`)
        }
      } catch (error) {
        console.error('Error:', error)
        process.exit(1)
      }
    })

  return program
}


