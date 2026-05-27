import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../index'
import { act } from '@testing-library/react'

describe('useStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useStore.setState({
      apiKey: '',
      model: '',
      defaultModel: '',
      permissionMode: 'workspace-write',
      sessions: [],
      currentSession: null,
      messages: [],
      inputTokens: 0,
      outputTokens: 0,
      currentProjectPath: null,
      commands: [],
      tools: [],
      routeMatches: [],
      providers: [],
      streamingMessageId: null,
      chatMode: 'chat',
      codeCompletions: [],
      inlineEditSuggestions: [],
      codeContext: null,
      copilotEnabled: true
    })
  })

  describe('session management', () => {
    it('should add a session', () => {
      const session = {
        id: 'test-session',
        createdAt: new Date().toISOString(),
        messageCount: 0
      }

      act(() => {
        useStore.getState().addSession(session)
      })

      const state = useStore.getState()
      expect(state.sessions).toHaveLength(1)
      expect(state.sessions[0].id).toBe('test-session')
      expect(state.currentSession).toBe('test-session')
    })

    it('should select a session', () => {
      const session1 = {
        id: 'session-1',
        createdAt: new Date().toISOString(),
        messageCount: 0
      }
      const session2 = {
        id: 'session-2',
        createdAt: new Date().toISOString(),
        messageCount: 0
      }

      act(() => {
        useStore.getState().addSession(session1)
        useStore.getState().addSession(session2)
        useStore.getState().selectSession('session-1')
      })

      expect(useStore.getState().currentSession).toBe('session-1')
    })

    it('should update session title', () => {
      const session = {
        id: 'test-session',
        createdAt: new Date().toISOString(),
        messageCount: 0
      }

      act(() => {
        useStore.getState().addSession(session)
        useStore.getState().updateSessionTitle('test-session', 'New Title')
      })

      const updatedSession = useStore.getState().sessions[0]
      expect(updatedSession.title).toBe('New Title')
    })

    it('should delete a session', () => {
      const session = {
        id: 'test-session',
        createdAt: new Date().toISOString(),
        messageCount: 0
      }

      act(() => {
        useStore.getState().addSession(session)
        useStore.getState().deleteSession('test-session')
      })

      expect(useStore.getState().sessions).toHaveLength(0)
      expect(useStore.getState().currentSession).toBeNull()
    })
  })

  describe('message management', () => {
    it('should add a message', () => {
      const message = {
        role: 'user' as const,
        content: 'Hello'
      }

      act(() => {
        useStore.getState().addMessage(message)
      })

      expect(useStore.getState().messages).toHaveLength(1)
      expect(useStore.getState().messages[0].content).toBe('Hello')
      expect(useStore.getState().messages[0].timestamp).toBeDefined()
    })

    it('should update a message', () => {
      const message = {
        role: 'user' as const,
        content: 'Hello'
      }

      act(() => {
        useStore.getState().addMessage(message)
        useStore.getState().updateMessage(0, { content: 'Updated' })
      })

      expect(useStore.getState().messages[0].content).toBe('Updated')
    })

    it('should clear messages', () => {
      act(() => {
        useStore.getState().addMessage({ role: 'user', content: 'Hello' })
        useStore.getState().clearMessages()
      })

      expect(useStore.getState().messages).toHaveLength(0)
      expect(useStore.getState().inputTokens).toBe(0)
      expect(useStore.getState().outputTokens).toBe(0)
    })

    it('should clear message actions', () => {
      act(() => {
        useStore.getState().addMessage({ role: 'assistant', content: 'Test', needsAction: 'continue' })
        useStore.getState().clearMessageActions()
      })

      expect(useStore.getState().messages[0].needsAction).toBeUndefined()
    })
  })

  describe('token management', () => {
    it('should update tokens', () => {
      act(() => {
        useStore.getState().updateTokens(100, 200)
        useStore.getState().updateTokens(50, 100)
      })

      expect(useStore.getState().inputTokens).toBe(150)
      expect(useStore.getState().outputTokens).toBe(300)
    })
  })

  describe('config management', () => {
    it('should set API key', () => {
      act(() => {
        useStore.getState().setApiKey('test-api-key')
      })

      expect(useStore.getState().apiKey).toBe('test-api-key')
    })

    it('should set model', () => {
      act(() => {
        useStore.getState().setModel('claude-3')
      })

      expect(useStore.getState().model).toBe('claude-3')
    })

    it('should set chat mode', () => {
      act(() => {
        useStore.getState().setChatMode('agent')
      })

      expect(useStore.getState().chatMode).toBe('agent')
    })

    it('should set providers', () => {
      const providers = [
        {
          id: 'provider-1',
          name: 'Test Provider',
          type: 'anthropic' as const,
          apiKey: 'key',
          apiUrl: 'https://api.test.com',
          enabled: true,
          models: []
        }
      ]

      act(() => {
        useStore.getState().setProviders(providers)
      })

      expect(useStore.getState().providers).toHaveLength(1)
      expect(useStore.getState().providers[0].name).toBe('Test Provider')
    })
  })

  describe('step and tool call management', () => {
    it('should add step to message', () => {
      act(() => {
        useStore.getState().addMessage({ role: 'assistant', content: 'Test' })
        useStore.getState().addStepToMessage(0, {
          id: 'step-1',
          title: 'Test Step',
          status: 'pending',
          timestamp: Date.now()
        })
      })

      expect(useStore.getState().messages[0].steps).toHaveLength(1)
      expect(useStore.getState().messages[0].steps?.[0].title).toBe('Test Step')
    })

    it('should update step status', () => {
      const step = {
        id: 'step-1',
        title: 'Test Step',
        status: 'pending' as const,
        timestamp: Date.now()
      }

      act(() => {
        useStore.getState().addMessage({ role: 'assistant', content: 'Test' })
        useStore.getState().addStepToMessage(0, step)
        useStore.getState().updateStepStatus(0, 'step-1', 'completed')
      })

      expect(useStore.getState().messages[0].steps?.[0].status).toBe('completed')
    })

    it('should add tool call to message', () => {
      act(() => {
        useStore.getState().addMessage({ role: 'assistant', content: 'Test' })
        useStore.getState().addToolCallToMessage(0, {
          id: 'tool-1',
          name: 'read_file',
          args: { path: '/test' },
          status: 'pending',
          timestamp: Date.now()
        })
      })

      expect(useStore.getState().messages[0].toolCalls).toHaveLength(1)
      expect(useStore.getState().messages[0].toolCalls?.[0].name).toBe('read_file')
    })
  })

  describe('streaming management', () => {
    it('should start streaming', () => {
      act(() => {
        useStore.getState().startStreaming('message-1')
      })

      expect(useStore.getState().streamingMessageId).toBe('message-1')
    })

    it('should stop streaming', () => {
      act(() => {
        useStore.getState().startStreaming('message-1')
        useStore.getState().stopStreaming()
      })

      expect(useStore.getState().streamingMessageId).toBeNull()
    })
  })

  describe('code context management', () => {
    it('should set code context', () => {
      const context = {
        filePath: '/test/file.ts',
        language: 'typescript',
        cursorPosition: { line: 1, character: 0 },
        selectedCode: null
      }

      act(() => {
        useStore.getState().setCodeContext(context)
      })

      expect(useStore.getState().codeContext?.filePath).toBe('/test/file.ts')
    })

    it('should update code context', () => {
      act(() => {
        useStore.getState().setCodeContext({
          filePath: '/test/file.ts',
          language: 'typescript',
          cursorPosition: { line: 1, character: 0 },
          selectedCode: null
        })
        useStore.getState().updateCodeContext({ cursorPosition: { line: 5, character: 10 } })
      })

      expect(useStore.getState().codeContext?.cursorPosition).toEqual({ line: 5, character: 10 })
    })
  })
})
