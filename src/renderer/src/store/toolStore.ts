/**
 * 工具调用状态管理 - Zustand Store
 * 参考 claw-code 架构：集中式状态管理，响应式更新
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ToolCallRecord, ToolStatusEvent } from '../../../shared/types/tool-call'

// 最大历史记录数
const MAX_HISTORY_SIZE = 100

interface ToolStoreState {
  // 状态
  calls: Map<string, ToolCallRecord>
  activeCallIds: Set<string>
  isInitialized: boolean

  // 派生状态
  activeCalls: () => ToolCallRecord[]
  completedCalls: () => ToolCallRecord[]
  failedCalls: () => ToolCallRecord[]
  allCalls: () => ToolCallRecord[]

  // 操作
  addCall: (call: ToolCallRecord) => void
  updateCallStatus: (id: string, status: ToolCallRecord['status'], result?: string, error?: string) => void
  handleStatusEvent: (event: ToolStatusEvent) => void
  clearHistory: () => void
  removeCall: (id: string) => void
  initialize: () => void
}

export const useToolStore = create<ToolStoreState>()(
  subscribeWithSelector((set, get) => ({
    // 初始状态
    calls: new Map(),
    activeCallIds: new Set(),
    isInitialized: false,

    // 派生状态
    activeCalls: () => {
      const state = get()
      return Array.from(state.activeCallIds)
        .map(id => state.calls.get(id))
        .filter((call): call is ToolCallRecord => call !== undefined)
    },

    completedCalls: () => {
      const state = get()
      return Array.from(state.calls.values())
        .filter(call => call.status === 'completed')
    },

    failedCalls: () => {
      const state = get()
      return Array.from(state.calls.values())
        .filter(call => call.status === 'failed' || call.status === 'cancelled')
    },

    allCalls: () => {
      const state = get()
      return Array.from(state.calls.values())
        .sort((a, b) => b.startTime - a.startTime)
        .slice(0, MAX_HISTORY_SIZE) // 限制历史记录数量
    },

    // 操作
    addCall: (call: ToolCallRecord) => {
      set(state => {
        const newCalls = new Map(state.calls)
        newCalls.set(call.id, call)
        const newActiveIds = new Set(state.activeCallIds)
        newActiveIds.add(call.id)
        return { calls: newCalls, activeCallIds: newActiveIds }
      })
    },

    updateCallStatus: (id: string, status: ToolCallRecord['status'], result?: string, error?: string) => {
      set(state => {
        const call = state.calls.get(id)
        if (!call) return state

        const newCalls = new Map(state.calls)
        const updatedCall: ToolCallRecord = {
          ...call,
          status,
          endTime: Date.now(),
          executionTime: Date.now() - call.startTime
        }

        if (result !== undefined) updatedCall.result = result
        if (error !== undefined) updatedCall.error = error

        newCalls.set(id, updatedCall)

        // 如果调用完成，从活跃列表中移除
        const newActiveIds = new Set(state.activeCallIds)
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          newActiveIds.delete(id)
        }

        return { calls: newCalls, activeCallIds: newActiveIds }
      })
    },

    handleStatusEvent: (event: ToolStatusEvent) => {
      
      const { addCall, updateCallStatus } = get()

      switch (event.type) {
        case 'started': {
          // 检查是否已存在该调用
          const state = get()
          
          if (!state.calls.has(event.callId)) {
            addCall({
              id: event.callId,
              name: event.toolName,
              arguments: {},
              status: 'executing',
              startTime: event.timestamp
            })
          } else {
          }
          break
        }

        case 'completed': {
          updateCallStatus(
            event.callId,
            'completed',
            event.result?.output,
            undefined
          )
          break
        }

        case 'failed': {
          updateCallStatus(
            event.callId,
            'failed',
            undefined,
            event.error || event.result?.error
          )
          break
        }

        case 'cancelled': {
          updateCallStatus(event.callId, 'cancelled')
          break
        }
        
        default:
          console.warn('[ToolStore] Unknown event type:', event.type)
      }
      
      const state = get()
    },

    clearHistory: () => {
      set({ calls: new Map(), activeCallIds: new Set() })
    },

    removeCall: (id: string) => {
      set(state => {
        const newCalls = new Map(state.calls)
        newCalls.delete(id)
        const newActiveIds = new Set(state.activeCallIds)
        newActiveIds.delete(id)
        return { calls: newCalls, activeCallIds: newActiveIds }
      })
    },

    initialize: () => {
      const state = get()
      if (state.isInitialized) return

      set({ isInitialized: true })
    }
  }))
)

// 导出便捷函数
export function getToolStore() {
  return useToolStore.getState()
}
