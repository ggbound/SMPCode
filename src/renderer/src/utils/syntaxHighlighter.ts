/**
 * 统一的高亮语法模块
 * 解决 react-syntax-highlighter 在不同版本中的兼容性问题
 */

import { Light as SyntaxHighlighter } from 'react-syntax-highlighter'
import atomOneDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark'

// 导入所有常用语言
import javascript from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript'
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript'
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python'
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css'
import scss from 'react-syntax-highlighter/dist/esm/languages/hljs/scss'
import less from 'react-syntax-highlighter/dist/esm/languages/hljs/less'
import stylus from 'react-syntax-highlighter/dist/esm/languages/hljs/stylus'
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml'
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import java from 'react-syntax-highlighter/dist/esm/languages/hljs/java'
import c from 'react-syntax-highlighter/dist/esm/languages/hljs/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/hljs/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/hljs/csharp'
import go from 'react-syntax-highlighter/dist/esm/languages/hljs/go'
import rust from 'react-syntax-highlighter/dist/esm/languages/hljs/rust'
import ruby from 'react-syntax-highlighter/dist/esm/languages/hljs/ruby'
import php from 'react-syntax-highlighter/dist/esm/languages/hljs/php'
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql'
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml'
import markdown from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown'
import plaintext from 'react-syntax-highlighter/dist/esm/languages/hljs/plaintext'
import dart from 'react-syntax-highlighter/dist/esm/languages/hljs/dart'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/hljs/kotlin'
import scala from 'react-syntax-highlighter/dist/esm/languages/hljs/scala'
import swift from 'react-syntax-highlighter/dist/esm/languages/hljs/swift'
import lessStyles from 'react-syntax-highlighter/dist/esm/languages/hljs/less'  // for less
import sass from 'react-syntax-highlighter/dist/esm/languages/hljs/scss'  // using scss for sass
import dockerfile from 'react-syntax-highlighter/dist/esm/languages/hljs/dockerfile'
import makefile from 'react-syntax-highlighter/dist/esm/languages/hljs/makefile'
import cmake from 'react-syntax-highlighter/dist/esm/languages/hljs/cmake'
import powershell from 'react-syntax-highlighter/dist/esm/languages/hljs/powershell'

// 注册所有语言
const registerLanguages = () => {
  // JavaScript/TypeScript
  SyntaxHighlighter.registerLanguage('javascript', javascript)
  SyntaxHighlighter.registerLanguage('js', javascript)
  SyntaxHighlighter.registerLanguage('typescript', typescript)
  SyntaxHighlighter.registerLanguage('ts', typescript)
  SyntaxHighlighter.registerLanguage('jsx', javascript)
  SyntaxHighlighter.registerLanguage('tsx', typescript)
  
  // Python
  SyntaxHighlighter.registerLanguage('python', python)
  SyntaxHighlighter.registerLanguage('py', python)
  
  // CSS/SCSS/Less/Stylus
  SyntaxHighlighter.registerLanguage('css', css)
  SyntaxHighlighter.registerLanguage('scss', scss)
  SyntaxHighlighter.registerLanguage('less', less)
  SyntaxHighlighter.registerLanguage('sass', scss)
  SyntaxHighlighter.registerLanguage('stylus', stylus)
  
  // Data formats
  SyntaxHighlighter.registerLanguage('json', json)
  SyntaxHighlighter.registerLanguage('html', xml)
  SyntaxHighlighter.registerLanguage('xml', xml)
  
  // Shell/Bash/PowerShell
  SyntaxHighlighter.registerLanguage('bash', bash)
  SyntaxHighlighter.registerLanguage('shell', bash)
  SyntaxHighlighter.registerLanguage('sh', bash)
  SyntaxHighlighter.registerLanguage('zsh', bash)
  SyntaxHighlighter.registerLanguage('powershell', powershell)
  
  // Java/C/C++
  SyntaxHighlighter.registerLanguage('java', java)
  SyntaxHighlighter.registerLanguage('c', c)
  SyntaxHighlighter.registerLanguage('cpp', cpp)
  SyntaxHighlighter.registerLanguage('csharp', csharp)
  SyntaxHighlighter.registerLanguage('go', go)
  SyntaxHighlighter.registerLanguage('rust', rust)
  SyntaxHighlighter.registerLanguage('ruby', ruby)
  SyntaxHighlighter.registerLanguage('php', php)
  
  // Database
  SyntaxHighlighter.registerLanguage('sql', sql)
  
  // Config files
  SyntaxHighlighter.registerLanguage('yaml', yaml)
  SyntaxHighlighter.registerLanguage('dockerfile', dockerfile)
  SyntaxHighlighter.registerLanguage('makefile', makefile)
  SyntaxHighlighter.registerLanguage('cmake', cmake)
  
  // Documentation
  SyntaxHighlighter.registerLanguage('markdown', markdown)
  SyntaxHighlighter.registerLanguage('md', markdown)
  
  // Plain text (fallback)
  SyntaxHighlighter.registerLanguage('plaintext', plaintext)
  SyntaxHighlighter.registerLanguage('text', plaintext)
  
  // Other languages
  SyntaxHighlighter.registerLanguage('swift', swift)
  SyntaxHighlighter.registerLanguage('kotlin', kotlin)
  SyntaxHighlighter.registerLanguage('scala', scala)
  SyntaxHighlighter.registerLanguage('dart', dart)
  
  // Vue 使用 xml (HTML) 作为后备高亮 (因为 highlightjs-vue 导出有问题)
  // 这会对 Vue 文件进行基本的 HTML 高亮
  SyntaxHighlighter.registerLanguage('vue', xml)
  SyntaxHighlighter.registerLanguage('svelte', xml)
}

// 初始化时注册所有语言
registerLanguages()

// 语言名称标准化映射
const normalizeLanguage = (lang: string): string => {
  const langLower = lang.toLowerCase()
  
  // 直接支持的语言
  const supportedLanguages = [
    'javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx',
    'python', 'py',
    'css', 'scss', 'less', 'sass', 'stylus',
    'html', 'xml',
    'json', 'yaml', 'yml',
    'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'php',
    'swift', 'kotlin', 'scala', 'dart',
    'bash', 'shell', 'sh', 'zsh', 'powershell',
    'sql',
    'markdown', 'md',
    'dockerfile', 'makefile', 'cmake',
    'vue', 'svelte', 'plaintext', 'text'
  ]
  
  if (supportedLanguages.includes(langLower)) {
    return langLower
  }
  
  // 语言名称映射
  const languageMapping: Record<string, string> = {
    'text': 'plaintext',
    'shell': 'bash',
    'sh': 'bash',
    'zsh': 'bash',
    'py': 'python',
    'cs': 'csharp',
    'yml': 'yaml'
  }
  
  return languageMapping[langLower] || 'plaintext'
}

// 导出统一的高亮组件和工具函数
export { SyntaxHighlighter, atomOneDark, normalizeLanguage }