/**
 * OpenSpec Adapter Tests
 *
 * Tests for OpenSpec DocAdapter including:
 * - Detection with full, partial, and missing structures
 * - Scanning with markdown filtering and non-markdown skipping
 * - Classification mapping to correct target categories
 * - YYYY-MM-DD-feature naming preservation
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { openspecAdapter } from '../../../../src/phases/migrate-docs/adapters/openspec.js'
import type { FileInventory } from '../../../../src/phases/migrate-docs/types.js'

describe('OpenSpec Adapter', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // ==========================================================================
  // Detection Tests
  // ==========================================================================

  describe('detect', () => {
    it('should detect full OpenSpec structure with confidence >= 0.95', async () => {
      await fs.mkdir(path.join(tempDir, 'openspec', 'specs'), { recursive: true })
      await fs.mkdir(path.join(tempDir, 'openspec', 'changes'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'project.md'), '# Project')

      const result = await openspecAdapter.detect(tempDir)

      expect(result.detected).toBe(true)
      expect(result.confidence).toBeGreaterThanOrEqual(0.95)
      expect(result.adapter).toBe('openspec')
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.hasSpecs).toBe('true')
      expect(result.metadata?.hasChanges).toBe('true')
    })

    it('should detect full structure with archive and root files', async () => {
      await fs.mkdir(path.join(tempDir, 'openspec', 'specs'), { recursive: true })
      await fs.mkdir(path.join(tempDir, 'openspec', 'changes', 'archive'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'project.md'), '# Project')
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), '# Agents')

      const result = await openspecAdapter.detect(tempDir)

      expect(result.detected).toBe(true)
      expect(result.confidence).toBeGreaterThanOrEqual(0.95)
      expect(result.metadata?.hasArchive).toBe('true')
      expect(result.metadata?.hasProjectMd).toBe('true')
      expect(result.metadata?.hasAgentsMd).toBe('true')
    })

    it('should detect partial structure with confidence 0.8 when only specs exists', async () => {
      await fs.mkdir(path.join(tempDir, 'openspec', 'specs'), { recursive: true })

      const result = await openspecAdapter.detect(tempDir)

      expect(result.detected).toBe(true)
      expect(result.confidence).toBe(0.8)
    })

    it('should detect partial structure with confidence 0.8 when only changes exists', async () => {
      await fs.mkdir(path.join(tempDir, 'openspec', 'changes'), { recursive: true })

      const result = await openspecAdapter.detect(tempDir)

      expect(result.detected).toBe(true)
      expect(result.confidence).toBe(0.8)
    })

    it('should detect openspec-only with confidence 0.5', async () => {
      await fs.mkdir(path.join(tempDir, 'openspec'), { recursive: true })

      const result = await openspecAdapter.detect(tempDir)

      expect(result.detected).toBe(true)
      expect(result.confidence).toBe(0.5)
    })

    it('should not detect non-OpenSpec directory with confidence 0', async () => {
      await fs.writeFile(path.join(tempDir, 'readme.md'), '# Readme')

      const result = await openspecAdapter.detect(tempDir)

      expect(result.detected).toBe(false)
      expect(result.confidence).toBe(0)
    })

    it('should return empty metadata when nothing detected', async () => {
      const result = await openspecAdapter.detect(tempDir)

      expect(result.detected).toBe(false)
      expect(result.confidence).toBe(0)
      expect(result.metadata).toBeUndefined()
    })
  })

  // ==========================================================================
  // Scan Tests
  // ==========================================================================

  describe('scan', () => {
    it('should scan all markdown files in full OpenSpec structure', async () => {
      await fs.mkdir(path.join(tempDir, 'openspec', 'specs'), { recursive: true })
      await fs.mkdir(path.join(tempDir, 'openspec', 'changes', '2026-04-17-feature'), { recursive: true })
      await fs.mkdir(path.join(tempDir, 'openspec', 'changes', 'archive'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'openspec', 'specs', 'api.md'), '# API')
      await fs.writeFile(path.join(tempDir, 'openspec', 'changes', '2026-04-17-feature', 'design.md'), '# Design')
      await fs.writeFile(path.join(tempDir, 'openspec', 'changes', 'archive', 'old.md'), '# Old')
      await fs.writeFile(path.join(tempDir, 'project.md'), '# Project')
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), '# Agents')

      const results = await openspecAdapter.scan(tempDir)

      expect(results).toHaveLength(5)
      const relPaths = results.map(r => r.relativePath.replace(/\\/g, '/'))
      expect(relPaths).toContain('openspec/specs/api.md')
      expect(relPaths).toContain('openspec/changes/2026-04-17-feature/design.md')
      expect(relPaths).toContain('openspec/changes/archive/old.md')
      expect(relPaths).toContain('project.md')
      expect(relPaths).toContain('AGENTS.md')
    })

    it('should skip non-markdown files and log warning', async () => {
      await fs.mkdir(path.join(tempDir, 'openspec', 'specs'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'openspec', 'specs', 'api.md'), '# API')
      await fs.writeFile(path.join(tempDir, 'openspec', 'specs', 'config.json'), '{}')
      await fs.writeFile(path.join(tempDir, 'openspec', 'specs', 'notes.txt'), 'notes')

      const warnings: string[] = []
      const originalWarn = console.warn
      console.warn = (...args: unknown[]) => {
        warnings.push(args.join(' '))
      }

      try {
        const results = await openspecAdapter.scan(tempDir)

        expect(results).toHaveLength(1)
        expect(results[0]!.relativePath.replace(/\\/g, '/')).toBe('openspec/specs/api.md')
        expect(warnings.length).toBeGreaterThanOrEqual(2)
        expect(warnings.some(w => w.includes('config.json'))).toBe(true)
        expect(warnings.some(w => w.includes('notes.txt'))).toBe(true)
      } finally {
        console.warn = originalWarn
      }
    })

    it('should return empty array when openspec directory does not exist', async () => {
      await fs.writeFile(path.join(tempDir, 'readme.md'), '# Readme')

      const results = await openspecAdapter.scan(tempDir)

      expect(results).toEqual([])
    })

    it('should not follow symbolic links', async () => {
      // Skip on Windows if no symlink permission
      if (process.platform === 'win32') {
        try {
          await fs.mkdir(path.join(tempDir, 'openspec'), { recursive: true })
          await fs.mkdir(path.join(tempDir, 'real-target'), { recursive: true })
          await fs.writeFile(path.join(tempDir, 'real-target', 'file.md'), '# Real')
          await fs.symlink(
            path.join(tempDir, 'real-target'),
            path.join(tempDir, 'openspec', 'link'),
            'dir'
          )
        } catch (err: any) {
          if (err.code === 'EPERM') {
            return // Skip this test on Windows without symlink permission
          }
          throw err
        }
      } else {
        await fs.mkdir(path.join(tempDir, 'openspec'), { recursive: true })
        await fs.mkdir(path.join(tempDir, 'real-target'), { recursive: true })
        await fs.writeFile(path.join(tempDir, 'real-target', 'file.md'), '# Real')
        await fs.symlink(
          path.join(tempDir, 'real-target'),
          path.join(tempDir, 'openspec', 'link'),
          'dir'
        )
      }

      const results = await openspecAdapter.scan(tempDir)

      expect(results).toHaveLength(0)
    })

    it('should record correct file metadata', async () => {
      await fs.mkdir(path.join(tempDir, 'openspec', 'specs'), { recursive: true })
      const content = '# API Spec\n\nDetails here.'
      await fs.writeFile(path.join(tempDir, 'openspec', 'specs', 'api.md'), content)

      const results = await openspecAdapter.scan(tempDir)

      expect(results).toHaveLength(1)
      const item = results[0]!
      expect(item.sourcePath).toBe(path.join(tempDir, 'openspec', 'specs', 'api.md'))
      expect(item.relativePath.replace(/\\/g, '/')).toBe('openspec/specs/api.md')
      expect(item.size).toBe(Buffer.byteLength(content))
      expect(item.extension).toBe('.md')
      expect(item.directoryContext).toBe('specs')
      expect(item.modifiedAt).toBeDefined()
    })
  })

  // ==========================================================================
  // Classification Tests
  // ==========================================================================

  describe('classify', () => {
    function makeInventory(relativePath: string, dirContext = 'openspec'): FileInventory {
      return {
        sourcePath: path.join(tempDir, relativePath),
        relativePath: relativePath.replace(/\//g, path.sep),
        size: 100,
        modifiedAt: new Date().toISOString(),
        extension: '.md',
        directoryContext: dirContext,
      }
    }

    it('should classify specs files to current/spec with high confidence', async () => {
      const inventory = [makeInventory('openspec/specs/api.md', 'specs')]

      const results = await openspecAdapter.classify(inventory)

      expect(results).toHaveLength(1)
      expect(results[0]!.targetType).toBe('current/spec')
      expect(results[0]!.confidence).toBe('high')
      expect(results[0]!.confidenceScore).toBe(0.85)
      expect(results[0]!.proposedTargetPath).toBe('docs/current/spec/api.md')
    })

    it('should classify changes files to changes with high confidence', async () => {
      const inventory = [makeInventory('openspec/changes/design.md', 'changes')]

      const results = await openspecAdapter.classify(inventory)

      expect(results).toHaveLength(1)
      expect(results[0]!.targetType).toBe('changes')
      expect(results[0]!.confidence).toBe('high')
      expect(results[0]!.confidenceScore).toBe(0.8)
      expect(results[0]!.proposedTargetPath).toBe('docs/changes/design.md')
    })

    it('should preserve YYYY-MM-DD-feature directory naming for changes', async () => {
      const inventory = [makeInventory('openspec/changes/2026-04-17-feature/design.md', '2026-04-17-feature')]

      const results = await openspecAdapter.classify(inventory)

      expect(results[0]!.targetType).toBe('changes')
      expect(results[0]!.proposedTargetPath).toBe('docs/changes/2026-04-17-feature/design.md')
    })

    it('should classify archive files to archive with high confidence', async () => {
      const inventory = [makeInventory('openspec/changes/archive/old.md', 'archive')]

      const results = await openspecAdapter.classify(inventory)

      expect(results).toHaveLength(1)
      expect(results[0]!.targetType).toBe('archive')
      expect(results[0]!.confidence).toBe('high')
      expect(results[0]!.confidenceScore).toBe(0.85)
      expect(results[0]!.proposedTargetPath).toBe('docs/archive/old.md')
    })

    it('should classify archive before general changes', async () => {
      const inventory = [
        makeInventory('openspec/changes/archive/old.md', 'archive'),
        makeInventory('openspec/changes/active.md', 'changes'),
      ]

      const results = await openspecAdapter.classify(inventory)

      expect(results).toHaveLength(2)
      const archiveResult = results.find(r => r.inventoryItem.relativePath.includes('archive'))
      const changesResult = results.find(r => r.inventoryItem.relativePath.includes('active'))
      expect(archiveResult!.targetType).toBe('archive')
      expect(changesResult!.targetType).toBe('changes')
    })

    it('should classify project.md to decisions with medium confidence', async () => {
      const inventory = [makeInventory('project.md', tempDir)]

      const results = await openspecAdapter.classify(inventory)

      expect(results).toHaveLength(1)
      expect(results[0]!.targetType).toBe('decisions')
      expect(results[0]!.confidence).toBe('medium')
      expect(results[0]!.confidenceScore).toBe(0.5)
      expect(results[0]!.proposedTargetPath).toBe('docs/decisions/project.md')
    })

    it('should classify AGENTS.md to references/raw with medium confidence', async () => {
      const inventory = [makeInventory('AGENTS.md', tempDir)]

      const results = await openspecAdapter.classify(inventory)

      expect(results).toHaveLength(1)
      expect(results[0]!.targetType).toBe('references/raw')
      expect(results[0]!.confidence).toBe('medium')
      expect(results[0]!.confidenceScore).toBe(0.4)
      expect(results[0]!.proposedTargetPath).toBe('docs/references/raw/AGENTS.md')
    })

    it('should classify full structure correctly', async () => {
      const inventory = [
        makeInventory('openspec/specs/api.md', 'specs'),
        makeInventory('openspec/changes/2026-04-17-feature/design.md', '2026-04-17-feature'),
        makeInventory('openspec/changes/archive/old.md', 'archive'),
        makeInventory('project.md', tempDir),
        makeInventory('AGENTS.md', tempDir),
      ]

      const results = await openspecAdapter.classify(inventory)

      expect(results).toHaveLength(5)

      const specResult = results.find(r => r.inventoryItem.relativePath.includes('api.md'))
      const changeResult = results.find(r => r.inventoryItem.relativePath.includes('2026-04-17-feature'))
      const archiveResult = results.find(r => r.inventoryItem.relativePath.includes('archive'))
      const projectResult = results.find(r => r.inventoryItem.relativePath === 'project.md')
      const agentsResult = results.find(r => r.inventoryItem.relativePath === 'AGENTS.md')

      expect(specResult!.targetType).toBe('current/spec')
      expect(changeResult!.targetType).toBe('changes')
      expect(archiveResult!.targetType).toBe('archive')
      expect(projectResult!.targetType).toBe('decisions')
      expect(agentsResult!.targetType).toBe('references/raw')
    })

    it('should fallback unrecognized openspec files to references/raw', async () => {
      const inventory = [makeInventory('openspec/unexpected/file.md', 'unexpected')]

      const results = await openspecAdapter.classify(inventory)

      expect(results).toHaveLength(1)
      expect(results[0]!.targetType).toBe('references/raw')
      expect(results[0]!.confidence).toBe('low')
      expect(results[0]!.confidenceScore).toBe(0.3)
      expect(results[0]!.proposedTargetPath).toBe('docs/references/raw/unexpected/file.md')
    })

    it('should include adapterUsed and reasoning in all results', async () => {
      const inventory = [
        makeInventory('openspec/specs/api.md', 'specs'),
        makeInventory('project.md', tempDir),
      ]

      const results = await openspecAdapter.classify(inventory)

      for (const result of results) {
        expect(result.adapterUsed).toBe('openspec')
        expect(result.reasoning).toBeDefined()
        expect(result.reasoning.length).toBeGreaterThan(0)
      }
    })

    it('should handle empty inventory', async () => {
      const results = await openspecAdapter.classify([])
      expect(results).toEqual([])
    })
  })
})
