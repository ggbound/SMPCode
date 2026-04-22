import { useState, useEffect, useCallback } from 'react'
import { Search, ArrowLeftRight, File } from 'lucide-react'
import { t } from '../i18n'

interface SearchResult {
  file: string
  line: number
  content: string
  match: string
}

interface SearchPanelProps {
  projectPath: string | null
}

const API_BASE = 'http://localhost:3847/api'

function SearchPanel({ projectPath }: SearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [includePattern, setIncludePattern] = useState('')
  const [excludePattern, setExcludePattern] = useState('')

  // Keyboard shortcut: Ctrl+Shift+F to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        // Focus is already handled in parent
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Perform search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !projectPath) return

    setIsSearching(true)
    try {
      const params = new URLSearchParams({
        path: projectPath,
        query: searchQuery,
        ...(includePattern && { include: includePattern }),
        ...(excludePattern && { exclude: excludePattern }),
      })

      const res = await fetch(`${API_BASE}/search?${params}`)
      if (res.ok) {
        const data = await res.json()
        setResults(data.results || [])
      }
    } catch (error) {
      console.error('Search failed:', error)
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [searchQuery, projectPath, includePattern, excludePattern])

  // Search on Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  // Handle result click
  const handleResultClick = (result: SearchResult) => {
    // Dispatch event to open file at specific line
    window.dispatchEvent(new CustomEvent('open-file-at-line', {
      detail: { path: result.file, line: result.line }
    }))
  }

  // Group results by file
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.file]) {
      acc[result.file] = []
    }
    acc[result.file].push(result)
    return acc
  }, {} as Record<string, SearchResult[]>)

  return (
    <div className="search-panel">
      {/* Search input */}
      <div className="search-input-container">
        <div className="search-input-wrapper">
          <span className="search-icon"><Search size={14} /></span>
          <input
            type="text"
            className="search-input"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {isSearching && <span className="search-loading">⟳</span>}
        </div>
      </div>

      {/* Replace input (optional) */}
      {showReplace && (
        <div className="replace-input-container">
          <div className="search-input-wrapper">
            <span className="search-icon"><ArrowLeftRight size={14} /></span>
            <input
              type="text"
              className="search-input"
              placeholder="Replace"
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Options */}
      <div className="search-options">
        <button
          className="search-option-btn"
          onClick={() => setShowReplace(!showReplace)}
          title="Toggle Replace"
        >
          {showReplace ? 'Hide Replace' : 'Replace'}
        </button>
        <input
          type="text"
          className="search-pattern-input"
          placeholder="files to include"
          value={includePattern}
          onChange={(e) => setIncludePattern(e.target.value)}
          title="Files to include (e.g., *.ts,src/**)"
        />
        <input
          type="text"
          className="search-pattern-input"
          placeholder="files to exclude"
          value={excludePattern}
          onChange={(e) => setExcludePattern(e.target.value)}
          title="Files to exclude (e.g., node_modules,**/*.test.ts)"
        />
      </div>

      {/* Search button */}
      <div className="search-actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSearch}
          disabled={!searchQuery.trim() || isSearching || !projectPath}
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
        <span className="search-result-count">
          {results.length > 0 && `${results.length} results in ${Object.keys(groupedResults).length} files`}
        </span>
      </div>

      {/* Results */}
      <div className="search-results">
        {Object.entries(groupedResults).map(([file, fileResults]) => (
          <div key={file} className="search-result-file">
            <div className="search-result-file-header">
              <span className="search-file-icon"><File size={14} /></span>
              <span className="search-file-path" title={file}>
                {file.replace(projectPath || '', '.')}
              </span>
              <span className="search-file-count">
                {fileResults.length} match{fileResults.length > 1 ? 'es' : ''}
              </span>
            </div>
            <div className="search-result-lines">
              {fileResults.map((result, idx) => (
                <div
                  key={idx}
                  className="search-result-line"
                  onClick={() => handleResultClick(result)}
                >
                  <span className="search-line-number">{result.line}</span>
                  <span className="search-line-content">
                    {result.content.split(result.match).map((part, i, arr) => (
                      <span key={i}>
                        {part}
                        {i < arr.length - 1 && (
                          <mark className="search-match">{result.match}</mark>
                        )}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {results.length === 0 && searchQuery && !isSearching && (
          <div className="search-no-results">
            No results found for "{searchQuery}"
          </div>
        )}

        {!searchQuery && (
          <div className="search-placeholder">
            <div className="search-placeholder-icon"><Search size={48} /></div>
            <p>Search in workspace</p>
            <p className="search-placeholder-hint">
              {projectPath ? `Searching in: ${projectPath.split('/').pop()}` : 'Open a folder to search'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default SearchPanel
