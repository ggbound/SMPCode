import { describe, it, expect } from 'vitest'
import { getLanguageFromPath, getMonacoLanguage, SUPPORTED_LANGUAGES } from '../languageMap'

describe('languageMap', () => {
  describe('getLanguageFromPath', () => {
    it('should detect TypeScript files', () => {
      expect(getLanguageFromPath('/test/file.ts')).toBe('typescript')
      expect(getLanguageFromPath('/test/file.tsx')).toBe('typescript')
      expect(getLanguageFromPath('/test/file.mts')).toBe('typescript')
    })

    it('should detect JavaScript files', () => {
      expect(getLanguageFromPath('/test/file.js')).toBe('javascript')
      expect(getLanguageFromPath('/test/file.jsx')).toBe('javascript')
      expect(getLanguageFromPath('/test/file.mjs')).toBe('javascript')
    })

    it('should detect Python files', () => {
      expect(getLanguageFromPath('/test/file.py')).toBe('python')
      expect(getLanguageFromPath('/test/file.pyw')).toBe('python')
    })

    it('should detect JSON files', () => {
      expect(getLanguageFromPath('/test/file.json')).toBe('json')
      expect(getLanguageFromPath('/test/file.jsonc')).toBe('json')
    })

    it('should detect CSS files', () => {
      expect(getLanguageFromPath('/test/file.css')).toBe('css')
      expect(getLanguageFromPath('/test/file.scss')).toBe('scss')
      expect(getLanguageFromPath('/test/file.less')).toBe('less')
    })

    it('should detect HTML files', () => {
      expect(getLanguageFromPath('/test/file.html')).toBe('html')
      expect(getLanguageFromPath('/test/file.htm')).toBe('html')
    })

    it('should detect Markdown files', () => {
      expect(getLanguageFromPath('/test/file.md')).toBe('markdown')
      expect(getLanguageFromPath('/test/file.markdown')).toBe('markdown')
    })

    it('should detect YAML files', () => {
      expect(getLanguageFromPath('/test/file.yaml')).toBe('yaml')
      expect(getLanguageFromPath('/test/file.yml')).toBe('yaml')
    })

    it('should detect Docker files', () => {
      expect(getLanguageFromPath('/test/Dockerfile')).toBe('dockerfile')
      expect(getLanguageFromPath('/test/dockerfile')).toBe('dockerfile')
    })

    it('should return plaintext for unknown extensions', () => {
      expect(getLanguageFromPath('/test/file.unknown')).toBe('plaintext')
      expect(getLanguageFromPath('/test/file')).toBe('plaintext')
    })

    it('should handle paths with dots in directory names', () => {
      expect(getLanguageFromPath('/test.dir/file.ts')).toBe('typescript')
      expect(getLanguageFromPath('/test.dir/file.name.ts')).toBe('typescript')
    })

    it('should be case insensitive', () => {
      expect(getLanguageFromPath('/test/file.TS')).toBe('typescript')
      expect(getLanguageFromPath('/test/file.JS')).toBe('javascript')
      expect(getLanguageFromPath('/test/file.PY')).toBe('python')
    })
  })

  describe('getMonacoLanguage', () => {
    it('should map typescript to Monaco language', () => {
      expect(getMonacoLanguage('typescript')).toBe('typescript')
    })

    it('should map javascript to Monaco language', () => {
      expect(getMonacoLanguage('javascript')).toBe('javascript')
    })

    it('should map python to Monaco language', () => {
      expect(getMonacoLanguage('python')).toBe('python')
    })

    it('should return the same language if no mapping needed', () => {
      expect(getMonacoLanguage('json')).toBe('json')
      expect(getMonacoLanguage('css')).toBe('css')
      expect(getMonacoLanguage('html')).toBe('html')
    })

    it('should return plaintext for unknown languages', () => {
      expect(getMonacoLanguage('unknown')).toBe('plaintext')
      expect(getMonacoLanguage('')).toBe('plaintext')
    })
  })

  describe('SUPPORTED_LANGUAGES', () => {
    it('should contain expected languages', () => {
      expect(SUPPORTED_LANGUAGES).toContain('typescript')
      expect(SUPPORTED_LANGUAGES).toContain('javascript')
      expect(SUPPORTED_LANGUAGES).toContain('python')
      expect(SUPPORTED_LANGUAGES).toContain('json')
      expect(SUPPORTED_LANGUAGES).toContain('css')
      expect(SUPPORTED_LANGUAGES).toContain('html')
      expect(SUPPORTED_LANGUAGES).toContain('markdown')
    })

    it('should not contain duplicates', () => {
      const unique = [...new Set(SUPPORTED_LANGUAGES)]
      expect(unique).toEqual(SUPPORTED_LANGUAGES)
    })
  })
})
