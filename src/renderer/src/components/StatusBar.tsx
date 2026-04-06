import { t } from '../i18n'

interface StatusBarProps {
  permissionMode: string
  inputTokens: number
  outputTokens: number
}

function StatusBar({ permissionMode, inputTokens, outputTokens }: StatusBarProps) {
  const totalTokens = inputTokens + outputTokens
  const costEstimate = (totalTokens * 0.003).toFixed(4)

  // Map permission mode to translation key
  const getPermissionLabel = (mode: string) => {
    switch (mode) {
      case 'read-only': return t('readOnlyMode')
      case 'workspace-write': return t('workspaceWriteMode')
      case 'danger-full-access': return t('fullAccessMode')
      default: return mode
    }
  }

  return (
    <div className="status-bar">
      <div className="status-item">
        <span>{t('permission')}: {getPermissionLabel(permissionMode)}</span>
      </div>
      <div className="cost-display">
        <span>{t('in')}: {inputTokens}</span>
        <span>{t('out')}: {outputTokens}</span>
        <span>{t('total')}: {totalTokens}</span>
        <span>{t('estCost')}: ${costEstimate}</span>
      </div>
    </div>
  )
}

export default StatusBar