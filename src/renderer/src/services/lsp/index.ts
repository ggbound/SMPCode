/**
 * LSP Services - Language Server Protocol 服务
 */

export { LSPClient, LSPClientOptions, LSPClientState, DiagnosticChangeEvent } from './lsp-client'
export { LSPManager, LanguageServerConfig, LanguageServerInfo, LanguageSupport, DefaultLanguageServers } from './lsp-manager'

// LSP 功能检测
export function isLSPSupported(languageId: string): boolean {
  const supportedLanguages = [
    'typescript',
    'javascript',
    'typescriptreact',
    'javascriptreact',
    'python',
    'rust',
    'go',
    'java',
    'c',
    'cpp',
    'csharp',
    'php',
    'ruby',
    'json',
    'css',
    'scss',
    'less',
    'html',
    'yaml',
    'markdown'
  ]

  return supportedLanguages.includes(languageId.toLowerCase())
}

// 获取语言服务器配置
export function getLanguageServerConfig(languageId: string): { id: string; name: string } | null {
  const serverMap: { [key: string]: { id: string; name: string } } = {
    typescript: { id: 'typescript-language-server', name: 'TypeScript' },
    javascript: { id: 'typescript-language-server', name: 'JavaScript' },
    typescriptreact: { id: 'typescript-language-server', name: 'TypeScript React' },
    javascriptreact: { id: 'typescript-language-server', name: 'JavaScript React' },
    python: { id: 'python-language-server', name: 'Python' },
    rust: { id: 'rust-analyzer', name: 'Rust' },
    go: { id: 'gopls', name: 'Go' }
  }

  return serverMap[languageId.toLowerCase()] || null
}

// 检查是否需要安装语言服务器
export function checkLanguageServerInstalled(serverId: string): Promise<boolean> {
  return new Promise((resolve) => {
    // 通过 IPC 检查主进程
    const ipc = (window as any).api?.lsp
    if (ipc?.checkServerInstalled) {
      ipc.checkServerInstalled(serverId).then(resolve).catch(() => resolve(false))
    } else {
      resolve(false)
    }
  })
}

// 安装语言服务器
export function installLanguageServer(serverId: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const ipc = (window as any).api?.lsp
    if (ipc?.installServer) {
      ipc.installServer(serverId).then(resolve).catch(reject)
    } else {
      reject(new Error('LSP IPC not available'))
    }
  })
}

export default {
  isLSPSupported,
  getLanguageServerConfig,
  checkLanguageServerInstalled,
  installLanguageServer
}
