// Seti-UI Icon Theme - Font-based icons
// Based on https://github.com/jesseweed/seti-ui

// Icon font character mappings (subset of most common file types)
// Using actual Unicode characters instead of escape sequences
const SETI_ICON_CHARS: Record<string, string> = {
  // JavaScript/TypeScript
  'javascript': '\uE060',  // JS
  'typescript': '\uE0D1',  // TS
  'react': '\uE0D1',       // TSX/JSX
  'react-ts': '\uE0D1',    // TSX
  
  // Web
  'html': '\uE061',        // HTML
  'css': '\uE062',         // CSS
  'sass': '\uE063',        // SCSS/SASS
  
  // Config
  'json': '\uE0B9',        // JSON
  'yaml': '\uE0D0',        // YAML
  'config': '\uE05C',      // Config
  
  // Programming languages
  'python': '\uE0D4',      // Python
  'java': '\uE064',        // Java
  'go': '\uE065',          // Go
  'rust': '\uE0D5',        // Rust
  'ruby': '\uE066',        // Ruby
  'php': '\uE068',         // PHP
  'swift': '\uE069',       // Swift
  'kotlin': '\uE0B8',      // Kotlin
  'scala': '\uE06A',       // Scala
  'c': '\uE06B',           // C
  'cpp': '\uE06C',         // C++
  'csharp': '\uE06D',      // C#
  
  // Shell
  'shell': '\uE06E',       // Shell
  'powershell': '\uE0D3',  // PowerShell
  
  // Other
  'markdown': '\uE06F',    // Markdown
  'docker': '\uE070',      // Docker
  'git': '\uE071',         // Git
  'database': '\uE072',    // Database
  'image': '\uE073',       // Image
  'pdf': '\uE074',         // PDF
  'zip': '\uE075',         // Archive
  'text': '\uE076',        // Text
  'xml': '\uE077',         // XML
  
  // Frameworks
  'vue': '\uE078',         // Vue
  'laravel': '\uE079',     // Laravel
  'npm': '\uE07A',         // NPM
  
  // Default
  'default': '\uE05D',     // Default file
}

// Icon colors (matching Seti-UI theme)
const SETI_ICON_COLORS: Record<string, string> = {
  'javascript': '#F7DF1E',
  'typescript': '#3178C6',
  'html': '#E34F26',
  'css': '#264DE4',
  'sass': '#CC6699',
  'json': '#6B8E23',
  'yaml': '#CB171E',
  'python': '#3776AB',
  'java': '#007396',
  'go': '#00ADD8',
  'rust': '#DEA584',
  'ruby': '#CC342D',
  'php': '#777BB4',
  'swift': '#FA7343',
  'kotlin': '#7F52FF',
  'scala': '#DC322F',
  'c': '#00599C',
  'cpp': '#004482',
  'csharp': '#68217A',
  'shell': '#4EAA25',
  'markdown': '#42A5F5',
  'docker': '#2496ED',
  'git': '#F05032',
  'database': '#336791',
  'image': '#26A69A',
  'pdf': '#E53935',
  'zip': '#795548',
  'text': '#78909C',
  'xml': '#F06292',
  'vue': '#41B883',
  'laravel': '#FF2D20',
  'npm': '#CB3837',
  'config': '#FFCA28',
  'default': '#9E9E9E',
}

// File extension to icon type mapping
const EXTENSION_MAP: Record<string, string> = {
  // JavaScript
  'js': 'javascript',
  'mjs': 'javascript',
  'cjs': 'javascript',
  'jsx': 'react',
  
  // TypeScript
  'ts': 'typescript',
  'tsx': 'react-ts',
  
  // Web
  'html': 'html',
  'htm': 'html',
  'css': 'css',
  'scss': 'sass',
  'sass': 'sass',
  'less': 'css',
  
  // Config
  'json': 'json',
  'yaml': 'yaml',
  'yml': 'yaml',
  'toml': 'config',
  'ini': 'config',
  'conf': 'config',
  'cfg': 'config',
  'config': 'config',
  
  // Programming
  'py': 'python',
  'pyc': 'python',
  'pyo': 'python',
  'java': 'java',
  'class': 'java',
  'jar': 'java',
  'go': 'go',
  'rs': 'rust',
  'rb': 'ruby',
  'php': 'php',
  'swift': 'swift',
  'kt': 'kotlin',
  'kts': 'kotlin',
  'scala': 'scala',
  'c': 'c',
  'cpp': 'cpp',
  'cc': 'cpp',
  'cxx': 'cpp',
  'h': 'cpp',
  'hpp': 'cpp',
  'cs': 'csharp',
  
  // Shell
  'sh': 'shell',
  'bash': 'shell',
  'zsh': 'shell',
  'fish': 'shell',
  'ps1': 'powershell',
  'bat': 'shell',
  'cmd': 'shell',
  
  // Documents
  'md': 'markdown',
  'markdown': 'markdown',
  'txt': 'text',
  'log': 'text',
  'pdf': 'pdf',
  
  // Data
  'xml': 'xml',
  'sql': 'database',
  'db': 'database',
  'sqlite': 'database',
  
  // Images
  'png': 'image',
  'jpg': 'image',
  'jpeg': 'image',
  'gif': 'image',
  'svg': 'image',
  'webp': 'image',
  'ico': 'image',
  
  // Archives
  'zip': 'zip',
  'rar': 'zip',
  '7z': 'zip',
  'tar': 'zip',
  'gz': 'zip',
  
  // Frameworks
  'vue': 'vue',
  'blade.php': 'laravel',
  'blade': 'laravel',
}

// Special file names to icon type mapping
const FILENAME_MAP: Record<string, string> = {
  'package.json': 'npm',
  'package-lock.json': 'npm',
  'composer.json': 'php',
  'composer.lock': 'php',
  'dockerfile': 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.env': 'config',
  '.env.local': 'config',
  '.env.example': 'config',
  'readme.md': 'markdown',
  'readme': 'markdown',
  'license': 'text',
  'license.txt': 'text',
  'makefile': 'shell',
  'cmake': 'shell',
}

// Folder icons
const FOLDER_ICON_CHARS: Record<string, string> = {
  'default': '\uE05E',
  'src': '\uE080',
  'dist': '\uE081',
  'build': '\uE081',
  'test': '\uE082',
  'tests': '\uE082',
  'node_modules': '\uE083',
  'public': '\uE084',
  'assets': '\uE085',
  'config': '\uE086',
  'docs': '\uE087',
}

const FOLDER_NAMES: Record<string, string> = {
  'src': 'src',
  'source': 'src',
  'dist': 'dist',
  'build': 'dist',
  'out': 'dist',
  'test': 'test',
  'tests': 'test',
  '__tests__': 'test',
  'spec': 'test',
  'node_modules': 'node_modules',
  'public': 'public',
  'static': 'public',
  'assets': 'assets',
  'config': 'config',
  'configs': 'config',
  'configuration': 'config',
  'docs': 'docs',
  'documentation': 'docs',
  'doc': 'docs',
}

export interface SetiIconInfo {
  char: string
  color: string
  isFolder: boolean
}

// Get icon info for a file or folder
export function getSetiIconInfo(filename: string, isDirectory: boolean, isOpen?: boolean): SetiIconInfo {
  const name = filename.toLowerCase()
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  
  if (isDirectory) {
    // Check for special folder names
    const folderKey = FOLDER_NAMES[name] || 'default'
    return {
      char: FOLDER_ICON_CHARS[folderKey] || FOLDER_ICON_CHARS['default'],
      color: '#DCAD5A', // Folder color
      isFolder: true,
    }
  }
  
  // Check for special file names first
  for (const [fileName, iconType] of Object.entries(FILENAME_MAP)) {
    if (name === fileName || name.endsWith(`/${fileName}`)) {
      return {
        char: SETI_ICON_CHARS[iconType] || SETI_ICON_CHARS['default'],
        color: SETI_ICON_COLORS[iconType] || SETI_ICON_COLORS['default'],
        isFolder: false,
      }
    }
  }
  
  // Then check by extension
  const iconType = EXTENSION_MAP[ext] || 'default'
  return {
    char: SETI_ICON_CHARS[iconType] || SETI_ICON_CHARS['default'],
    color: SETI_ICON_COLORS[iconType] || SETI_ICON_COLORS['default'],
    isFolder: false,
  }
}

// Generate CSS class name for icon
export function getSetiIconClass(filename: string, isDirectory: boolean, isOpen?: boolean): string {
  const info = getSetiIconInfo(filename, isDirectory, isOpen)
  return `seti-icon seti-${info.isFolder ? 'folder' : 'file'}`
}

// Generate inline styles for icon
export function getSetiIconStyles(filename: string, isDirectory: boolean, isOpen?: boolean): React.CSSProperties {
  const info = getSetiIconInfo(filename, isDirectory, isOpen)
  return {
    fontFamily: 'seti',
    fontSize: '16px',
    color: info.color,
    width: '16px',
    height: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  }
}

// Get icon character for data attribute
export function getSetiIconChar(filename: string, isDirectory: boolean, isOpen?: boolean): string {
  const info = getSetiIconInfo(filename, isDirectory, isOpen)
  // Character is already in Unicode format
  return info.char
}
