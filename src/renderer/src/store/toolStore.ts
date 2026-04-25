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
      console.log('[ToolStore] ========== handleStatusEvent ==========')
      console.log('[ToolStore] Event type:', event.type)
      console.log('[ToolStore] Event callId:', event.callId)
      console.log('[ToolStore] Event toolName:', event.toolName)
      
      const { addCall, updateCallStatus } = get()

      switch (event.type) {
        case 'started': {
          console.log('[ToolStore] Handling started event...')
          // 检查是否已存在该调用
          const state = get()
          console.log('[ToolStore] Current calls count:', state.calls.size)
          console.log('[ToolStore] Call already exists:', state.calls.has(event.callId))
          
          if (!state.calls.has(event.callId)) {
            console.log('[ToolStore] Adding new call to store...')
            addCall({
              id: event.callId,
              name: event.toolName,
              arguments: {},
              status: 'executing',
              startTime: event.timestamp
            })
            console.log('[ToolStore] Call added successfully')
          } else {
            console.log('[ToolStore] Call already exists, skipping add')
          }
          break
        }

        case 'completed': {
          console.log('[ToolStore] Handling completed event...')
          console.log('[ToolStore] Result output length:', event.result?.output?.length || 0)
          updateCallStatus(
            event.callId,
            'completed',
            event.result?.output,
            undefined
          )
          console.log('[ToolStore] Call marked as completed')
          break
        }

        case 'failed': {
          console.log('[ToolStore] Handling failed event...')
          console.log('[ToolStore] Error:', event.error || event.result?.error)
          updateCallStatus(
            event.callId,
            'failed',
            undefined,
            event.error || event.result?.error
          )
          console.log('[ToolStore] Call marked as failed')
          break
        }

        case 'cancelled': {
          console.log('[ToolStore] Handling cancelled event...')
          updateCallStatus(event.callId, 'cancelled')
          console.log('[ToolStore] Call marked as cancelled')
          break
        }
        
        default:
          console.warn('[ToolStore] Unknown event type:', event.type)
      }
      
      const state = get()
      console.log('[ToolStore] Final calls count:', state.calls.size)
      console.log('[ToolStore] Active calls count:', state.activeCalls().length)
      console.log('[ToolStore] ========== handleStatusEvent END ==========')
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

      console.log('[ToolStore] Initializing...')
      set({ isInitialized: true })
      console.log('[ToolStore] Initialized successfully')
    }
  }))
)

// 导出便捷函数
export function getToolStore() {
  return useToolStore.getState()
}
