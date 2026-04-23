// VSCode-style file icon theme system with performance optimization
export interface FileIconTheme {
  name: string
  icons: Map<string, string>
  folderIcons: Map<string, string>
}

// Icon cache for performance optimization
const iconCache = new Map<string, string>()

// Default VSCode-like icon theme
export const defaultIconTheme: FileIconTheme = {
  name: 'vscode-default',
  icons: new Map([
    // JavaScript
    ['js', 'javascript'],
    ['mjs', 'javascript'],
    ['cjs', 'javascript'],
    ['jsx', 'react'],
    
    // TypeScript
    ['ts', 'typescript'],
    ['tsx', 'react-ts'],
    ['d.ts', 'typescript-def'],
    
    // Python
    ['py', 'python'],
    ['pyc', 'python'],
    ['pyo', 'python'],
    ['pyd', 'python'],
    
    // Web
    ['html', 'html'],
    ['htm', 'html'],
    ['css', 'css'],
    ['scss', 'sass'],
    ['sass', 'sass'],
    ['less', 'less'],
    
    // Config files
    ['json', 'json'],
    ['yaml', 'yaml'],
    ['yml', 'yaml'],
    ['toml', 'toml'],
    ['ini', 'config'],
    ['conf', 'config'],
    ['cfg', 'config'],
    ['config', 'config'],
    
    // Markdown
    ['md', 'markdown'],
    ['markdown', 'markdown'],
    
    // Images
    ['png', 'image'],
    ['jpg', 'image'],
    ['jpeg', 'image'],
    ['gif', 'image'],
    ['svg', 'svg'],
    ['webp', 'image'],
    ['ico', 'image'],
    
    // PHP & Laravel
    ['php', 'php'],
    ['blade.php', 'laravel'],
    ['blade', 'laravel'],
    
    // Vue
    ['vue', 'vue'],
    
    // Package files
    ['package.json', 'npm'],
    ['package-lock.json', 'npm'],
    ['composer.json', 'composer'],
    ['composer.lock', 'composer'],
    
    // Docker
    ['dockerfile', 'docker'],
    ['docker-compose.yml', 'docker'],
    ['docker-compose.yaml', 'docker'],
    
    // Git
    ['.gitignore', 'git'],
    ['.gitattributes', 'git'],
    
    // Environment
    ['.env', 'config'],
    ['.env.local', 'config'],
    ['.env.example', 'config'],
    
    // Database
    ['sql', 'database'],
    ['db', 'database'],
    ['sqlite', 'database'],
    ['sqlite3', 'database'],
    
    // Documents
    ['pdf', 'pdf'],
    ['doc', 'document'],
    ['docx', 'document'],
    ['xls', 'spreadsheet'],
    ['xlsx', 'spreadsheet'],
    ['csv', 'spreadsheet'],
    
    // Archives
    ['zip', 'archive'],
    ['rar', 'archive'],
    ['7z', 'archive'],
    ['tar', 'archive'],
    ['gz', 'archive'],
    
    // Fonts
    ['ttf', 'font'],
    ['otf', 'font'],
    ['woff', 'font'],
    ['woff2', 'font'],
    ['eot', 'font'],
    
    // Code languages
    ['java', 'java'],
    ['class', 'java'],
    ['jar', 'java'],
    ['c', 'c'],
    ['cpp', 'cpp'],
    ['cc', 'cpp'],
    ['cxx', 'cpp'],
    ['h', 'header'],
    ['hpp', 'header'],
    ['hh', 'header'],
    ['cs', 'csharp'],
    ['go', 'go'],
    ['rs', 'rust'],
    ['rb', 'ruby'],
    ['swift', 'swift'],
    ['kt', 'kotlin'],
    ['kts', 'kotlin'],
    ['scala', 'scala'],
    ['r', 'r'],
    ['R', 'r'],
    ['sql', 'database'],
    ['dart', 'dart'],
    ['lua', 'lua'],
    ['ex', 'elixir'],
    ['exs', 'elixir'],
    ['hs', 'haskell'],
    ['pl', 'perl'],
    ['pm', 'perl'],
    ['graphql', 'graphql'],
    ['gql', 'graphql'],
    
    // Mobile & Cross-platform
    ['dart', 'dart'],
    ['kt', 'kotlin'],
    ['kts', 'kotlin'],
    
    // System & DevOps
    ['sh', 'shell'],
    ['bash', 'shell'],
    ['zsh', 'shell'],
    ['fish', 'shell'],
    ['ps1', 'powershell'],
    ['bat', 'shell'],
    ['cmd', 'shell'],
    
    // Misc
    ['log', 'text'],
    ['txt', 'text'],
    ['xml', 'xml'],
    ['lock', 'lock'],
    
    // Build tools
    ['gradle', 'gradle'],
    ['gradle.kts', 'gradle'],
    ['pom.xml', 'maven'],
  ]),
  folderIcons: new Map([
    ['src', 'folder-src'],
    ['dist', 'folder-dist'],
    ['build', 'folder-build'],
    ['out', 'folder-dist'],
    ['public', 'folder-public'],
    ['static', 'folder-public'],
    ['assets', 'folder-assets'],
    ['images', 'folder-images'],
    ['img', 'folder-images'],
    ['icons', 'folder-icons'],
    ['components', 'folder-components'],
    ['views', 'folder-views'],
    ['pages', 'folder-pages'],
    ['routes', 'folder-routes'],
    ['router', 'folder-routes'],
    ['store', 'folder-store'],
    ['stores', 'folder-store'],
    ['models', 'folder-models'],
    ['model', 'folder-models'],
    ['services', 'folder-services'],
    ['service', 'folder-services'],
    ['utils', 'folder-utils'],
    ['helpers', 'folder-utils'],
    ['lib', 'folder-lib'],
    ['libs', 'folder-lib'],
    ['modules', 'folder-modules'],
    ['controllers', 'folder-controllers'],
    ['controller', 'folder-controllers'],
    ['middleware', 'folder-middleware'],
    ['middlewares', 'folder-middleware'],
    ['config', 'folder-config'],
    ['configs', 'folder-config'],
    ['configuration', 'folder-config'],
    ['env', 'folder-env'],
    ['types', 'folder-types'],
    ['type', 'folder-types'],
    ['typings', 'folder-types'],
    ['test', 'folder-test'],
    ['tests', 'folder-test'],
    ['__tests__', 'folder-test'],
    ['spec', 'folder-test'],
    ['specs', 'folder-test'],
    ['docs', 'folder-docs'],
    ['documentation', 'folder-docs'],
    ['doc', 'folder-docs'],
    ['node_modules', 'folder-node'],
    ['vendor', 'folder-vendor'],
    ['database', 'folder-database'],
    ['databases', 'folder-database'],
    ['db', 'folder-database'],
    ['migrations', 'folder-migrations'],
    ['seed', 'folder-seed'],
    ['seeds', 'folder-seed'],
    ['templates', 'folder-templates'],
    ['template', 'folder-templates'],
    ['layouts', 'folder-layouts'],
    ['layout', 'folder-layouts'],
    ['theme', 'folder-theme'],
    ['themes', 'folder-theme'],
    ['styles', 'folder-styles'],
    ['style', 'folder-styles'],
    ['css', 'folder-styles'],
    ['sass', 'folder-styles'],
    ['scss', 'folder-styles'],
    ['less', 'folder-styles'],
    ['scripts', 'folder-scripts'],
    ['script', 'folder-scripts'],
    ['api', 'folder-api'],
    ['apis', 'folder-api'],
    ['core', 'folder-core'],
    ['shared', 'folder-shared'],
    ['common', 'folder-shared'],
    ['hooks', 'folder-hooks'],
    ['providers', 'folder-providers'],
    ['context', 'folder-context'],
    ['contexts', 'folder-context'],
  ])
}

// Get icon class for a file or folder
export function getFileIconClass(filename: string, isDirectory: boolean): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const name = filename.toLowerCase()
  
  if (isDirectory) {
    // Check for special folder names
    for (const [folderName, iconClass] of defaultIconTheme.folderIcons) {
      if (name === folderName || name.endsWith(`/${folderName}`)) {
        return iconClass
      }
    }
    return 'folder-default'
  }
  
  // Check for special file names first
  for (const [fileName, iconClass] of defaultIconTheme.icons) {
    if (name === fileName || name.endsWith(`/${fileName}`)) {
      return iconClass
    }
  }
  
  // Then check by extension
  return defaultIconTheme.icons.get(ext) || 'file-default'
}

// Get icon SVG for a file with caching for performance
// 使用 16x16 viewBox 直接匹配容器尺寸，避免缩放导致的文字截断
export function getFileIconSVG(filename: string, isDirectory: boolean, isOpen?: boolean): string {
  // Create cache key
  const cacheKey = `${filename}-${isDirectory}-${isOpen}`
  
  // Return cached icon if available
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!
  }
  
  const iconClass = getFileIconClass(filename, isDirectory)
  let svg: string
  
  // Return appropriate SVG based on icon class
  switch (iconClass) {
    case 'javascript':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#F7DF1E"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="#333" fontSize="5" fontWeight="bold">JS</text></svg>`
      break
    case 'typescript':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#3178C6"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="5" fontWeight="bold">TS</text></svg>`
      break
    case 'react':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#61DAFB"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="#333" fontSize="4.5" fontWeight="bold">JSX</text></svg>`
      break
    case 'react-ts':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#3178C6"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">TSX</text></svg>`
      break
    case 'python':
      svg = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#3776AB"/><path d="M6 6H10M6 10H10" stroke="#FFD43B" strokeWidth="1.5"/></svg>`
      break
    case 'html':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#E34F26"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4" fontWeight="bold">HTML</text></svg>`
      break
    case 'css':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#264DE4"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="5" fontWeight="bold">CSS</text></svg>`
      break
    case 'json':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#6B8E23"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="3.5" fontWeight="bold">JSON</text></svg>`
      break
    case 'markdown':
      svg = `<svg viewBox="0 0 16 16"><rect x="2.5" y="1" width="11" height="14" rx="1.5" fill="#42A5F5"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">MD</text></svg>`
      break
    case 'image':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#26A69A"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">IMG</text></svg>`
      break
    case 'php':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#777BB4"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">PHP</text></svg>`
      break
    case 'vue':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#41B883"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">VUE</text></svg>`
      break
    case 'laravel':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#FF2D20"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="5" fontWeight="bold">L</text></svg>`
      break
    case 'composer':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#5382A1"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="5" fontWeight="bold">C</text></svg>`
      break
    case 'npm':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#CB3837"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">NPM</text></svg>`
      break
    case 'go':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#00ADD8"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="5" fontWeight="bold">GO</text></svg>`
      break
    case 'rust':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#DEA584"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="#333" fontSize="4.5" fontWeight="bold">RS</text></svg>`
      break
    case 'ruby':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#CC342D"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">RB</text></svg>`
      break
    case 'swift':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#FA7343"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">SW</text></svg>`
      break
    case 'kotlin':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#7F52FF"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">KT</text></svg>`
      break
    case 'scala':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#DC322F"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">SC</text></svg>`
      break
    case 'r':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#276DC3"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="5" fontWeight="bold">R</text></svg>`
      break
    case 'dart':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#0175C2"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">DT</text></svg>`
      break
    case 'csharp':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#68217A"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">C#</text></svg>`
      break
    case 'java':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#007396"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="3.5" fontWeight="bold">JAVA</text></svg>`
      break
    case 'c':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#00599C"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="5" fontWeight="bold">C</text></svg>`
      break
    case 'cpp':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#004482"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">C++</text></svg>`
      break
    case 'header':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#00599C"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="5" fontWeight="bold">H</text></svg>`
      break
    case 'shell':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#4EAA25"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">SH</text></svg>`
      break
    case 'docker':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#2496ED"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">DKR</text></svg>`
      break
    case 'git':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#F05032"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">GIT</text></svg>`
      break
    case 'yaml':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#CB171E"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">YML</text></svg>`
      break
    case 'toml':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#9C4121"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4" fontWeight="bold">TOML</text></svg>`
      break
    case 'graphql':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#E10098"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">GQL</text></svg>`
      break
    case 'sass':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#CC6699"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">SCSS</text></svg>`
      break
    case 'lua':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#000080"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">LUA</text></svg>`
      break
    case 'elixir':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#6e4a7e"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">EX</text></svg>`
      break
    case 'haskell':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#5D4F85"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">HS</text></svg>`
      break
    case 'perl':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#39457E"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">PL</text></svg>`
      break
    case 'database':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#336791"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">DB</text></svg>`
      break
    case 'pdf':
      svg = `<svg viewBox="0 0 16 16"><rect x="2.5" y="1" width="11" height="14" rx="1.5" fill="#E53935"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">PDF</text></svg>`
      break
    case 'archive':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#795548"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">ZIP</text></svg>`
      break
    case 'font':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#5C6BC0"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">TTF</text></svg>`
      break
    case 'svg':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#FFB13B"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">SVG</text></svg>`
      break
    case 'svelte':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#FF3E00"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">SVT</text></svg>`
      break
    case 'config':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#FFCA28"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="#333" fontSize="4.5" fontWeight="bold">CFG</text></svg>`
      break
    case 'xml':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#F06292"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">XML</text></svg>`
      break
    case 'lock':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#9E9E9E"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="3.5" fontWeight="bold">LOCK</text></svg>`
      break
    case 'text':
      svg = `<svg viewBox="0 0 16 16"><rect x="2.5" y="1" width="11" height="14" rx="1.5" fill="#78909C"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="3.5" fontWeight="bold">TXT</text></svg>`
      break
    case 'document':
      svg = `<svg viewBox="0 0 16 16"><rect x="2.5" y="1" width="11" height="14" rx="1.5" fill="#42A5F5"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">DOC</text></svg>`
      break
    case 'spreadsheet':
      svg = `<svg viewBox="0 0 16 16"><rect x="2.5" y="1" width="11" height="14" rx="1.5" fill="#66BB6A"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="3.5" fontWeight="bold">XLS</text></svg>`
      break
    case 'typescript-def':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#3178C6"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">DTS</text></svg>`
      break
    case 'gradle':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#02303A"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">GDL</text></svg>`
      break
    case 'maven':
      svg = `<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#CB171E"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="4.5" fontWeight="bold">MVN</text></svg>`
      break
    case 'folder-default':
      svg = isOpen 
        ? `<svg viewBox="0 0 16 16"><path d="M2.5 13.5C2.5 13.5 2.5 4 2.5 4C2.5 3.6 2.8 3.3 3.2 3.3H7.3L8.7 4.7H12.8C13.2 4.7 13.5 5 13.5 5.4V13.5C13.5 13.9 13.2 14.2 12.8 14.2H3.2C2.8 14.2 2.5 13.9 2.5 13.5Z" fill="#DCAD5A"/></svg>`
        : `<svg viewBox="0 0 16 16"><path d="M13.5 5.3H9.3L8 4H2.5C2.1 4 1.8 4.3 1.8 4.7V13.3C1.8 13.7 2.1 14 2.5 14H13.5C13.9 14 14.2 13.7 14.2 13.3V6C14.2 5.6 13.9 5.3 13.5 5.3Z" fill="#DCAD5A"/></svg>`
      break
    // 文件夹特殊图标
    case 'folder-src':
    case 'folder-dist':
    case 'folder-build':
    case 'folder-public':
    case 'folder-assets':
    case 'folder-images':
    case 'folder-icons':
    case 'folder-components':
    case 'folder-views':
    case 'folder-pages':
    case 'folder-routes':
    case 'folder-store':
    case 'folder-models':
    case 'folder-services':
    case 'folder-utils':
    case 'folder-lib':
    case 'folder-modules':
    case 'folder-controllers':
    case 'folder-middleware':
    case 'folder-config':
    case 'folder-env':
    case 'folder-types':
    case 'folder-test':
    case 'folder-docs':
    case 'folder-node':
    case 'folder-vendor':
    case 'folder-database':
    case 'folder-migrations':
    case 'folder-seed':
    case 'folder-templates':
    case 'folder-layouts':
    case 'folder-theme':
    case 'folder-styles':
    case 'folder-scripts':
    case 'folder-api':
    case 'folder-core':
    case 'folder-shared':
    case 'folder-hooks':
    case 'folder-providers':
    case 'folder-context':
      // 所有特殊文件夹使用黄色文件夹图标
      svg = isOpen 
        ? `<svg viewBox="0 0 16 16"><path d="M2.5 13.5C2.5 13.5 2.5 4 2.5 4C2.5 3.6 2.8 3.3 3.2 3.3H7.3L8.7 4.7H12.8C13.2 4.7 13.5 5 13.5 5.4V13.5C13.5 13.9 13.2 14.2 12.8 14.2H3.2C2.8 14.2 2.5 13.9 2.5 13.5Z" fill="#FFCA28"/></svg>`
        : `<svg viewBox="0 0 16 16"><path d="M13.5 5.3H9.3L8 4H2.5C2.1 4 1.8 4.3 1.8 4.7V13.3C1.8 13.7 2.1 14 2.5 14H13.5C13.9 14 14.2 13.7 14.2 13.3V6C14.2 5.6 13.9 5.3 13.5 5.3Z" fill="#FFCA28"/></svg>`
      break
    default:
      // 默认文件图标
      svg = `<svg viewBox="0 0 16 16"><rect x="2.5" y="1" width="11" height="14" rx="1.5" fill="#9E9E9E"/><text x="8" y="8" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="3.5" fontWeight="bold">FILE</text></svg>`
  }
  
  // Cache the result
  iconCache.set(cacheKey, svg)
  
  return svg
}

// Clear icon cache (useful for memory management)
export function clearIconCache(): void {
  iconCache.clear()
}

// Get cache size for debugging
export function getCacheSize(): number {
  return iconCache.size
}
