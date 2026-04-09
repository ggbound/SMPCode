/**
 * Session Store - Based on claw-code/src/session_store.py
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { StoredSession } from './types'

const SESSIONS_DIR = path.join(app.getPath('userData'), 'sessions')

// Ensure sessions directory exists
function ensureSessionsDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  }
}

export function saveSession(session: StoredSession): string {
  ensureSessionsDir()
  
  const filePath = path.join(SESSIONS_DIR, `${session.sessionId}.json`)
  const data = {
    ...session,
    updatedAt: Date.now()
  }
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  return filePath
}

export function loadSession(sessionId: string): StoredSession | null {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`)
  
  if (!fs.existsSync(filePath)) {
    return null
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return {
      sessionId: data.sessionId,
      messages: data.messages || [],
      inputTokens: data.inputTokens || 0,
      outputTokens: data.outputTokens || 0,
      createdAt: data.createdAt || Date.now(),
      updatedAt: data.updatedAt || Date.now()
    }
  } catch (error) {
    console.error(`Failed to load session ${sessionId}:`, error)
    return null
  }
}

export function listSessions(): StoredSession[] {
  ensureSessionsDir()
  
  const sessions: StoredSession[] = []
  const files = fs.readdirSync(SESSIONS_DIR)
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const sessionId = file.replace('.json', '')
      const session = loadSession(sessionId)
      if (session) {
        sessions.push(session)
      }
    }
  }
  
  // Sort by updatedAt descending
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function deleteSession(sessionId: string): boolean {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`)
  
  if (!fs.existsSync(filePath)) {
    return false
  }
  
  try {
    fs.unlinkSync(filePath)
    return true
  } catch (error) {
    console.error(`Failed to delete session ${sessionId}:`, error)
    return false
  }
}

export function createStoredSession(
  sessionId: string,
  messages: string[] = [],
  inputTokens = 0,
  outputTokens = 0
): StoredSession {
  const now = Date.now()
  return {
    sessionId,
    messages,
    inputTokens,
    outputTokens,
    createdAt: now,
    updatedAt: now
  }
}
