/**
 * Setup Report - Workspace Setup Information
 */

import { WorkspaceSetup, SetupReport } from './types'
import * as os from 'os'

export function runSetup(trusted = false): SetupReport {
  const setup: WorkspaceSetup = {
    pythonVersion: process.version,
    implementation: 'Node.js',
    platformName: `${os.platform()} ${os.arch()}`,
    testCommand: 'npm test'
  }
  
  return {
    setup,
    startupSteps: [
      'Loaded command snapshot',
      'Loaded tool snapshot',
      'Initialized query engine',
      'Built port context',
      trusted ? 'Running in trusted mode' : 'Running in standard mode'
    ]
  }
}

export function buildSystemInitMessage(trusted = false): string {
  const lines = [
    'System initialized successfully.',
    '',
    'Available capabilities:',
    '- Command routing and execution',
    '- Tool routing and execution',
    '- Multi-turn conversation loop',
    '- Session persistence',
    '- Stream processing',
    ''
  ]
  
  if (trusted) {
    lines.push('Running in trusted mode with elevated permissions.')
  }
  
  return lines.join('\n')
}
