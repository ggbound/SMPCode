/**
 * InlineAI - 代码内联 AI 组件
 * 在编辑器右键菜单中集成 "Ask AI" 功能
 */

import React, { useState, useEffect, useCallback } from 'react'
import { MessageSquare, X, Send, Loader2 } from 'lucide-react'

interface InlineAIProps {
  projectPath: string
  filePath: string
  selectedCode: string
  startLine: number
  endLine: number
  language: string
  onClose: () => void
  onApply?: (newCode: string) => void
}

export const InlineAI: React.FC<InlineAIProps> = ({
  projectPath,
  filePath,
  selectedCode,
  startLine,
  endLine,
  language,
  onClose,
  onApply
}) => {
  const [instruction, setInstruction] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  // 创建内联 AI 会话
  const createSession = useCallback(async () => {
    if (!window.api?.inlineAI) return
    try {
      const result = await window.api.inlineAI.create(
        filePath,
        selectedCode,
        startLine,
        endLine,
        language
      )
      if (result.success && result.session) {
        setSessionId(result.session.id)
      }
    } catch (error) {
      console.error('Failed to create inline AI session:', error)
    }
  }, [filePath, selectedCode, startLine, endLine, language])

  // 初始化会话
  useEffect(() => {
    createSession()
  }, [createSession])

  // 发送指令到 AI
  const handleSubmit = async () => {
    if (!instruction.trim() || !sessionId || !window.api?.inlineAI) return
    
    setIsProcessing(true)
    setResult(null)
    
    try {
      // 生成提示词
      const promptResult = await window.api.inlineAI.generatePrompt(
        selectedCode,
        instruction,
        language
      )
      
      if (promptResult.success && promptResult.prompt) {
        // 这里应该发送到 AI 服务
        // 简化版本：模拟 AI 响应
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // 模拟 AI 响应
        const mockResponse = `我将优化这段代码：\n\`\`\`${language}\n// 优化后的代码\n${selectedCode}\n\`\`\``
        
        setResult(mockResponse)
        
        // 更新会话
        await window.api.inlineAI.update(sessionId, {
          status: 'completed',
          result: mockResponse
        })
      }
    } catch (error) {
      console.error('Failed to process inline AI:', error)
      setResult('处理失败，请重试')
    } finally {
      setIsProcessing(false)
    }
  }

  // 应用结果
  const handleApply = () => {
    if (result && onApply) {
      // 提取代码块
      const codeBlockMatch = result.match(/```[\w]*\n([\s\S]*?)```/)
      if (codeBlockMatch) {
        onApply(codeBlockMatch[1].trim())
      }
    }
    onClose()
  }

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '500px',
      maxHeight: '80vh',
      backgroundColor: '#1e1e1e',
      border: '1px solid #444',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      zIndex: 1000,
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px',
        backgroundColor: '#252526',
        borderBottom: '1px solid #333'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <MessageSquare size={20} />
          <span style={{ fontWeight: 600 }}>Ask AI</span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#999',
            cursor: 'pointer',
            padding: '4px'
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '16px', maxHeight: '60vh', overflow: 'auto' }}>
        {/* 选中的代码 */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ 
            fontSize: '12px', 
            color: '#999', 
            marginBottom: '8px' 
          }}>
            选中的代码 ({startLine}-{endLine} 行):
          </div>
          <pre style={{
            backgroundColor: '#2d2d2d',
            padding: '12px',
            borderRadius: '6px',
            fontSize: '13px',
            overflow: 'auto',
            maxHeight: '150px'
          }}>
            {selectedCode}
          </pre>
        </div>

        {/* 输入框 */}
        {!result && (
          <div style={{ marginBottom: '16px' }}>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="输入指令，例如：优化这段代码、解释这段代码..."
              style={{
                width: '100%',
                minHeight: '80px',
                padding: '12px',
                backgroundColor: '#2d2d2d',
                border: '1px solid #444',
                borderRadius: '6px',
                color: '#e2e8f0',
                fontSize: '14px',
                resize: 'vertical'
              }}
            />
          </div>
        )}

        {/* 结果 */}
        {result && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ 
              fontSize: '12px', 
              color: '#999', 
              marginBottom: '8px' 
            }}>
              AI 响应:
            </div>
            <div style={{
              backgroundColor: '#2d2d2d',
              padding: '12px',
              borderRadius: '6px',
              fontSize: '13px',
              whiteSpace: 'pre-wrap'
            }}>
              {result}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '10px',
        padding: '16px',
        backgroundColor: '#252526',
        borderTop: '1px solid #333'
      }}>
        {!result ? (
          <>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px',
                backgroundColor: '#333',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!instruction.trim() || isProcessing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '10px 20px',
                backgroundColor: '#3b82f6',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '14px',
                cursor: !instruction.trim() || isProcessing ? 'not-allowed' : 'pointer',
                opacity: !instruction.trim() || isProcessing ? 0.5 : 1
              }}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <Send size={16} />
                  发送
                </>
              )}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setResult(null)}
              style={{
                padding: '10px 20px',
                backgroundColor: '#333',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              继续提问
            </button>
            <button
              onClick={handleApply}
              style={{
                padding: '10px 20px',
                backgroundColor: '#22c55e',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              应用更改
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default InlineAI
