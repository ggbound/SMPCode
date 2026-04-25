/**
 * 工具调用测试面板
 * 用于验证工具调用系统的各个组件
 */

import React, { useState, useEffect } from 'react'
import { Play, CheckCircle, XCircle, RefreshCw, Terminal, FileText, FilePlus, FileEdit, Trash2, FolderOpen, Search } from 'lucide-react'
import { executeTool } from '../services/tool-client'
import { useToolStore } from '../store/toolStore'
import type { ToolExecutionResult } from '../../../shared/types/tool-call'

interface TestCase {
  id: string
  name: string
  tool: string
  args: Record<string, unknown>
  description: string
}

const testCases: TestCase[] = [
  {
    id: 'test-write',
    name: '写入文件测试',
    tool: 'write_file',
    args: {
      path: '/tmp/test-tool-write.txt',
      content: 'Hello from tool test!\nThis is a test file created by the tool executor.'
    },
    description: '测试 write_file 工具的基本功能'
  },
  {
    id: 'test-read',
    name: '读取文件测试',
    tool: 'read_file',
    args: {
      path: '/tmp/test-tool-write.txt'
    },
    description: '测试 read_file 工具的基本功能'
  },
  {
    id: 'test-list',
    name: '列出目录测试',
    tool: 'list_directory',
    args: {
      path: '/tmp'
    },
    description: '测试 list_directory 工具的基本功能'
  },
  {
    id: 'test-bash',
    name: '执行命令测试',
    tool: 'execute_bash',
    args: {
      command: 'echo "Hello from bash test" && pwd'
    },
    description: '测试 execute_bash 工具的基本功能'
  },
  {
    id: 'test-search',
    name: '搜索文件测试',
    tool: 'search_files',
    args: {
      path: '/tmp',
      pattern: 'test.*\\.txt'
    },
    description: '测试 search_files 工具的基本功能'
  },
  {
    id: 'test-delete',
    name: '删除文件测试',
    tool: 'delete_file',
    args: {
      path: '/tmp/test-tool-write.txt'
    },
    description: '测试 delete_file 工具的基本功能'
  }
]

interface TestResult {
  testId: string
  success: boolean
  output?: string
  error?: string
  duration: number
}

export const ToolTestPanel: React.FC = () => {
  const [results, setResults] = useState<Map<string, TestResult>>(new Map())
  const [runningTests, setRunningTests] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'tests' | 'history'>('tests')

  // 从 store 获取工具调用历史
  const toolCalls = useToolStore(state => state.allCalls())

  const runTest = async (testCase: TestCase) => {
    setRunningTests(prev => new Set(prev).add(testCase.id))
    const startTime = Date.now()

    try {
      const result = await executeTool(testCase.tool, testCase.args, { cwd: '/' })
      const duration = Date.now() - startTime

      setResults(prev => new Map(prev).set(testCase.id, {
        testId: testCase.id,
        success: result.success,
        output: result.output,
        error: result.error,
        duration
      }))
    } catch (error) {
      const duration = Date.now() - startTime
      setResults(prev => new Map(prev).set(testCase.id, {
        testId: testCase.id,
        success: false,
        error: String(error),
        duration
      }))
    } finally {
      setRunningTests(prev => {
        const newSet = new Set(prev)
        newSet.delete(testCase.id)
        return newSet
      })
    }
  }

  const runAllTests = async () => {
    for (const testCase of testCases) {
      await runTest(testCase)
      // 添加小延迟以避免并发问题
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  const clearResults = () => {
    setResults(new Map())
  }

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'read_file': return <FileText size={16} />
      case 'write_file': return <FilePlus size={16} />
      case 'edit_file': return <FileEdit size={16} />
      case 'delete_file': return <Trash2 size={16} />
      case 'list_directory': return <FolderOpen size={16} />
      case 'execute_bash': return <Terminal size={16} />
      case 'search_files': return <Search size={16} />
      default: return <Terminal size={16} />
    }
  }

  return (
    <div className="tool-test-panel">
      <div className="test-panel-header">
        <h2>
          <Terminal size={20} />
          工具调用测试
        </h2>
        <div className="header-actions">
          <button
            className="action-btn primary"
            onClick={runAllTests}
            disabled={runningTests.size > 0}
          >
            <Play size={14} />
            运行全部测试
          </button>
          <button
            className="action-btn"
            onClick={clearResults}
            disabled={results.size === 0}
          >
            <RefreshCw size={14} />
            清除结果
          </button>
        </div>
      </div>

      <div className="test-tabs">
        <button
          className={`tab ${activeTab === 'tests' ? 'active' : ''}`}
          onClick={() => setActiveTab('tests')}
        >
          测试用例
        </button>
        <button
          className={`tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          调用历史 ({toolCalls.length})
        </button>
      </div>

      {activeTab === 'tests' ? (
        <div className="test-cases">
          {testCases.map(testCase => {
            const result = results.get(testCase.id)
            const isRunning = runningTests.has(testCase.id)

            return (
              <div
                key={testCase.id}
                className={`test-case ${result ? (result.success ? 'success' : 'failed') : ''} ${isRunning ? 'running' : ''}`}
              >
                <div className="test-header">
                  <div className="test-info">
                    <div className="test-icon">
                      {getToolIcon(testCase.tool)}
                    </div>
                    <div className="test-details">
                      <h4>{testCase.name}</h4>
                      <p>{testCase.description}</p>
                      <code className="test-args">
                        {testCase.tool}({JSON.stringify(testCase.args)})
                      </code>
                    </div>
                  </div>
                  <div className="test-actions">
                    {result && (
                      <span className="test-result-icon">
                        {result.success ? (
                          <CheckCircle size={20} className="success" />
                        ) : (
                          <XCircle size={20} className="failed" />
                        )}
                      </span>
                    )}
                    <button
                      className="run-btn"
                      onClick={() => runTest(testCase)}
                      disabled={isRunning}
                    >
                      {isRunning ? (
                        <RefreshCw size={14} className="spin" />
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                  </div>
                </div>

                {result && (
                  <div className="test-result">
                    <div className="result-meta">
                      <span className={`status ${result.success ? 'success' : 'failed'}`}>
                        {result.success ? '成功' : '失败'}
                      </span>
                      <span className="duration">{result.duration}ms</span>
                    </div>
                    {result.output && (
                      <pre className="result-output">{result.output}</pre>
                    )}
                    {result.error && (
                      <pre className="result-error">{result.error}</pre>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="tool-history">
          {toolCalls.length === 0 ? (
            <div className="empty-state">
              <Terminal size={48} className="empty-icon" />
              <p>暂无工具调用记录</p>
            </div>
          ) : (
            <div className="history-list">
              {toolCalls.map(call => (
                <div key={call.id} className={`history-item ${call.status}`}>
                  <div className="history-header">
                    {getToolIcon(call.name)}
                    <span className="tool-name">{call.name}</span>
                    <span className={`status-badge ${call.status}`}>{call.status}</span>
                  </div>
                  <div className="history-args">
                    {JSON.stringify(call.arguments)}
                  </div>
                  {call.result && (
                    <pre className="history-result">{call.result.slice(0, 200)}...</pre>
                  )}
                  {call.error && (
                    <pre className="history-error">{call.error}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ToolTestPanel
