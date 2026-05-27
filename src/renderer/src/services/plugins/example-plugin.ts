/**
 * Example Plugin - 示例插件
 * 展示如何使用插件 API
 */

import { PluginContext, StatusBarItem } from './plugin-api'

/**
 * 插件激活函数
 * 在插件被激活时调用
 */
export async function activate(context: PluginContext): Promise<any> {
  const { editor, ui, storage, log, events } = context

  log.info('Example plugin activated!')

  // 创建状态栏项
  const statusBarItem = ui.createStatusBarItem('right', 100)
  statusBarItem.text = '$(smiley) Hello'
  statusBarItem.tooltip = 'Click to say hello'
  statusBarItem.command = 'example.hello'
  statusBarItem.show()

  // 注册命令
  ui.registerCommand('example.hello', async () => {
    ui.showMessage('Hello from Example Plugin!', 'info')

    // 获取编辑器中的选中文字
    const selectedText = editor.getSelectedText()
    if (selectedText) {
      ui.showMessage(`You selected: ${selectedText}`, 'info')
    }
  })

  ui.registerCommand('example.insertTimestamp', async () => {
    const timestamp = new Date().toISOString()
    editor.insertText(`// Timestamp: ${timestamp}\n`)
  })

  ui.registerCommand('example.countLines', async () => {
    const model = editor.getModel()
    if (model) {
      const lineCount = model.getLineCount()
      ui.showMessage(`This file has ${lineCount} lines`, 'info')
    }
  })

  // 注册快捷键
  ui.registerKeybinding('ctrl+shift+t', 'example.insertTimestamp')

  // 注册菜单项
  ui.registerMenuItem('editor/context', {
    id: 'example.insertTimestamp',
    label: 'Insert Timestamp',
    command: 'example.insertTimestamp',
    group: '9_cutcopypaste@5'
  })

  // 监听编辑器事件
  const disposable = events.on('fileOpened', (filePath: string) => {
    log.info(`File opened: ${filePath}`)
  })

  // 存储数据
  const usageCount = await storage.get<number>('usageCount', 0)
  await storage.set('usageCount', usageCount + 1)

  // 监听存储变化
  const storageDisposable = storage.onChange('usageCount', (value) => {
    log.info(`Usage count changed to: ${value}`)
  })

  // 返回插件导出
  return {
    // 命令实现
    'example.hello': () => {
      ui.showMessage('Hello!', 'info')
    },

    'example.insertTimestamp': () => {
      const timestamp = new Date().toISOString()
      editor.insertText(`// ${timestamp}\n`)
    },

    'example.countLines': () => {
      const model = editor.getModel()
      if (model) {
        ui.showMessage(`Lines: ${model.getLineCount()}`, 'info')
      }
    },

    // 停用函数
    deactivate: () => {
      log.info('Example plugin deactivated')
      statusBarItem.dispose()
      disposable()
      storageDisposable()
    },

    // 公开 API
    getUsageCount: () => storage.get('usageCount', 0),
    resetUsageCount: () => storage.set('usageCount', 0)
  }
}

/**
 * 示例：使用 AI API
 */
export async function createAIAssistantFeature(context: PluginContext): Promise<void> {
  const { ai, ui, log } = context

  ui.registerCommand('example.askAI', async () => {
    const question = await ui.showInput('What would you like to ask the AI?')
    if (!question) return

    ui.showMessage('Asking AI...', 'info')

    try {
      const response = await ai.sendMessage(question, {
        stream: true
      })

      ui.showMessage(`AI Response: ${response.content.substring(0, 100)}...`, 'success')
    } catch (error) {
      log.error('AI request failed:', error)
      ui.showMessage('Failed to get AI response', 'error')
    }
  })
}

/**
 * 示例：文件系统操作
 */
export async function createFileManagerFeature(context: PluginContext): Promise<void> {
  const { fs, ui, log } = context

  ui.registerCommand('example.listFiles', async () => {
    try {
      const files = await fs.readDir('.')
      ui.showQuickPick(files, 'Select a file')
    } catch (error) {
      log.error('Failed to list files:', error)
      ui.showMessage('Failed to list files', 'error')
    }
  })

  ui.registerCommand('example.readFile', async () => {
    const path = await ui.showInput('Enter file path:')
    if (!path) return

    try {
      const content = await fs.readFile(path)
      ui.showMessage(`File content: ${content.substring(0, 100)}...`, 'info')
    } catch (error) {
      log.error('Failed to read file:', error)
      ui.showMessage('Failed to read file', 'error')
    }
  })
}

/**
 * 示例：工具集成
 */
export async function createToolIntegrationFeature(context: PluginContext): Promise<void> {
  const { tools, ui, log } = context

  // 注册自定义工具
  tools.register({
    name: 'example_custom_tool',
    description: 'An example custom tool',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to process'
        }
      },
      required: ['message']
    },
    execute: async (args, ctx) => {
      ctx.log.info('Custom tool executed:', args.message)
      return `Processed: ${args.message}`
    }
  })

  ui.registerCommand('example.runCustomTool', async () => {
    try {
      const result = await tools.execute('example_custom_tool', {
        message: 'Hello from plugin!'
      })
      ui.showMessage(`Tool result: ${result}`, 'success')
    } catch (error) {
      log.error('Tool execution failed:', error)
      ui.showMessage('Tool execution failed', 'error')
    }
  })
}

/**
 * 示例：Webview 面板
 */
export async function createWebviewFeature(context: PluginContext): Promise<void> {
  const { ui, events } = context

  ui.registerCommand('example.openWebview', () => {
    const panel = ui.showWebviewPanel(
      'examplePanel',
      'Example Webview',
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    )

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Example Plugin</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, sans-serif;
              padding: 20px;
              background: #1e1e1e;
              color: #e4e4e4;
            }
            h1 {
              color: #4ade80;
            }
            button {
              padding: 10px 20px;
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            }
            button:hover {
              background: #2563eb;
            }
          </style>
        </head>
        <body>
          <h1>Hello from Example Plugin!</h1>
          <p>This is a custom webview panel.</p>
          <button id="sendMessage">Send Message to Extension</button>
          <div id="messages"></div>
          <script>
            const vscode = acquireVsCodeApi();
            document.getElementById('sendMessage').addEventListener('click', () => {
              vscode.postMessage({ command: 'hello', text: 'Hello from webview!' });
            });
            window.addEventListener('message', event => {
              const message = event.data;
              const messagesDiv = document.getElementById('messages');
              messagesDiv.innerHTML += '<p>' + message.text + '</p>';
            });
          </script>
        </body>
      </html>
    `

    panel.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'hello':
          panel.webview.postMessage({ text: 'Hello back from extension!' })
          break
      }
    })
  })
}

export default { activate }
