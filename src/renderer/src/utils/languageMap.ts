/**
 * Unified language mapping for file extensions to Monaco/editor languages
 * This ensures consistency across all components
 */

// Map file extensions to Monaco language IDs
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // JavaScript/TypeScript
  'js': 'javascript',
  'mjs': 'javascript',
  'cjs': 'javascript',
  'ts': 'typescript',
  'tsx': 'typescript',
  'jsx': 'javascript',
  
  // Web
  'html': 'html',
  'htm': 'html',
  'css': 'css',
  'scss': 'scss',
  'sass': 'scss',
  'less': 'less',
  'vue': 'vue',
  'svelte': 'html',
  
  // Data formats
  'json': 'json',
  'jsonc': 'json',
  'xml': 'xml',
  'svg': 'xml',
  'yaml': 'yaml',
  'yml': 'yaml',
  'toml': 'ini',
  'ini': 'ini',
  'conf': 'ini',
  
  // Documentation
  'md': 'markdown',
  'markdown': 'markdown',
  'txt': 'plaintext',
  'text': 'plaintext',
  
  // Python
  'py': 'python',
  'pyw': 'python',
  'pyi': 'python',
  
  // Java
  'java': 'java',
  'class': 'java',
  'jar': 'java',
  
  // C/C++
  'c': 'c',
  'cpp': 'cpp',
  'cxx': 'cpp',
  'cc': 'cpp',
  'h': 'c',
  'hpp': 'cpp',
  
  // C#
  'cs': 'csharp',
  'csx': 'csharp',
  
  // Go
  'go': 'go',
  
  // Rust
  'rs': 'rust',
  
  // Ruby
  'rb': 'ruby',
  'erb': 'ruby',
  
  // PHP
  'php': 'php',
  'phtml': 'php',
  
  // Shell
  'sh': 'shell',
  'bash': 'shell',
  'zsh': 'shell',
  'fish': 'shell',
  'ps1': 'powershell',
  'psm1': 'powershell',
  
  // SQL
  'sql': 'sql',
  'mysql': 'sql',
  'pgsql': 'sql',
  
  // Swift
  'swift': 'swift',
  
  // Kotlin
  'kt': 'kotlin',
  'kts': 'kotlin',
  
  // Scala
  'scala': 'scala',
  'sc': 'scala',
  
  // Dart/Flutter
  'dart': 'dart',
  
  // Lua
  'lua': 'lua',
  
  // Perl
  'pl': 'perl',
  'pm': 'perl',
  
  // R
  'r': 'r',
  
  // MATLAB
  'm': 'matlab',
  'matlab': 'matlab',
  
  // Groovy
  'groovy': 'groovy',
  'gvy': 'groovy',
  
  // Gradle
  'gradle': 'groovy',
  
  // Dockerfile
  'dockerfile': 'dockerfile',
  
  // Makefile
  'makefile': 'makefile',
  'mk': 'makefile',
  
  // CMake
  'cmake': 'cmake',
  'cmake.in': 'cmake',
  
  // Vim
  'vim': 'vim',
  'vimrc': 'vim',
  
  // GraphQL
  'graphql': 'graphql',
  'gql': 'graphql',
}

// Map language IDs to display labels
export const LANGUAGE_TO_LABEL: Record<string, string> = {
  'javascript': 'JavaScript',
  'typescript': 'TypeScript',
  'html': 'HTML',
  'css': 'CSS',
  'scss': 'SCSS',
  'less': 'LESS',
  'vue': 'Vue',
  'svelte': 'Svelte',
  'json': 'JSON',
  'xml': 'XML',
  'yaml': 'YAML',
  'ini': 'INI',
  'markdown': 'Markdown',
  'plaintext': 'Plain Text',
  'python': 'Python',
  'java': 'Java',
  'c': 'C',
  'cpp': 'C++',
  'csharp': 'C#',
  'go': 'Go',
  'rust': 'Rust',
  'ruby': 'Ruby',
  'php': 'PHP',
  'shell': 'Shell',
  'bash': 'Bash',
  'zsh': 'Zsh',
  'powershell': 'PowerShell',
  'sql': 'SQL',
  'swift': 'Swift',
  'kotlin': 'Kotlin',
  'scala': 'Scala',
  'dart': 'Dart',
  'lua': 'Lua',
  'perl': 'Perl',
  'r': 'R',
  'matlab': 'MATLAB',
  'groovy': 'Groovy',
  'dockerfile': 'Dockerfile',
  'makefile': 'Makefile',
  'cmake': 'CMake',
  'vim': 'Vim',
  'graphql': 'GraphQL',
  'text': 'Text',
}

/**
 * Get Monaco language ID from file path
 */
export function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return EXTENSION_TO_LANGUAGE[ext] || 'text'
}

/**
 * Get display label for a language ID
 */
export function getLanguageLabel(language: string): string {
  return LANGUAGE_TO_LABEL[language.toLowerCase()] || language.toUpperCase()
}

/**
 * Get file extension from path
 */
export function getFileExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() || ''
}
