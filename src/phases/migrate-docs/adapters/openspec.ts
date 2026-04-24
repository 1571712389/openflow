/**
 * OpenSpec DocAdapter
 *
 * Detects, scans, and classifies OpenSpec source document structures.
 * Uses heuristic rules (filename patterns, directory context) only.
 */

import { readdir, stat } from 'node:fs/promises'
import { join, relative, basename, extname } from 'node:path'
import type { DocAdapter } from './types.js'
import type {
  AdapterDetectResult,
  ClassificationResult,
  FileInventory,
} from '../types.js'
import {
  ALLOWED_EXTENSIONS,
  MAX_SCAN_DEPTH,
  MAX_SCAN_FILES,
} from '../types.js'

export const openspecAdapter: DocAdapter = {
  name: 'openspec',

  async detect(sourceDir: string): Promise<AdapterDetectResult> {
    const hasDir = async (p: string) => {
      try {
        const s = await stat(join(sourceDir, p))
        return s.isDirectory()
      } catch {
        return false
      }
    }

    const hasFile = async (p: string) => {
      try {
        const s = await stat(join(sourceDir, p))
        return s.isFile()
      } catch {
        return false
      }
    }

    const hasOpenspec = await hasDir('openspec')
    const hasSpecs = await hasDir('openspec/specs')
    const hasChanges = await hasDir('openspec/changes')
    const hasArchive = await hasDir('openspec/changes/archive')
    const hasProjectMd = await hasFile('project.md')
    const hasAgentsMd = await hasFile('AGENTS.md')

    let confidence = 0
    if (hasOpenspec && hasSpecs && hasChanges) {
      confidence = 0.95
    } else if (hasOpenspec && (hasSpecs || hasChanges)) {
      confidence = 0.8
    } else if (hasOpenspec) {
      confidence = 0.5
    }

    const metadata: Record<string, string> = {}
    if (hasSpecs) metadata.hasSpecs = 'true'
    if (hasChanges) metadata.hasChanges = 'true'
    if (hasArchive) metadata.hasArchive = 'true'
    if (hasProjectMd) metadata.hasProjectMd = 'true'
    if (hasAgentsMd) metadata.hasAgentsMd = 'true'

    return {
      adapter: 'openspec',
      detected: confidence > 0,
      confidence,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    }
  },

  async scan(sourceDir: string): Promise<FileInventory[]> {
    const results: FileInventory[] = []
    const openspecDir = join(sourceDir, 'openspec')

    try {
      const s = await stat(openspecDir)
      if (!s.isDirectory()) return []
    } catch {
      return []
    }

    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > MAX_SCAN_DEPTH) return
      if (results.length >= MAX_SCAN_FILES) return

      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isSymbolicLink()) continue

        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1)
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase()
          if (!ALLOWED_EXTENSIONS.includes(ext as '.md' | '.markdown')) {
            console.warn(`[openspec] Skipping non-Markdown file: ${relative(sourceDir, fullPath)}`)
            continue
          }

          const s = await stat(fullPath)
          results.push({
            sourcePath: fullPath,
            relativePath: relative(sourceDir, fullPath),
            size: s.size,
            modifiedAt: s.mtime.toISOString(),
            extension: ext,
            directoryContext: basename(dir),
          })
        }
      }
    }

    await walk(openspecDir, 0)

    // Also scan project.md and AGENTS.md at source root
    for (const fileName of ['project.md', 'AGENTS.md']) {
      const fullPath = join(sourceDir, fileName)
      try {
        const s = await stat(fullPath)
        if (s.isFile()) {
          const ext = extname(fileName).toLowerCase()
          if (ALLOWED_EXTENSIONS.includes(ext as '.md' | '.markdown')) {
            results.push({
              sourcePath: fullPath,
              relativePath: fileName,
              size: s.size,
              modifiedAt: s.mtime.toISOString(),
              extension: ext,
              directoryContext: basename(sourceDir),
            })
          }
        }
      } catch {
        // file not found, skip
      }
    }

    return results
  },

  async classify(inventory: FileInventory[]): Promise<ClassificationResult[]> {
    return inventory.map((item): ClassificationResult => {
      const rel = item.relativePath.replace(/\\/g, '/')

      // openspec/specs/* -> current/spec/
      if (rel.startsWith('openspec/specs/')) {
        const targetFile = rel.replace('openspec/specs/', '')
        return {
          inventoryItem: item,
          targetType: 'current/spec',
          confidence: 'high',
          confidenceScore: 0.85,
          adapterUsed: 'openspec',
          reasoning: `OpenSpec spec file mapped to current/spec/`,
          proposedTargetPath: `docs/current/spec/${targetFile}`,
        }
      }

      // openspec/changes/archive/* -> archive/
      if (rel.startsWith('openspec/changes/archive/')) {
        const targetFile = rel.replace('openspec/changes/archive/', '')
        return {
          inventoryItem: item,
          targetType: 'archive',
          confidence: 'high',
          confidenceScore: 0.85,
          adapterUsed: 'openspec',
          reasoning: `OpenSpec archived change mapped to archive/`,
          proposedTargetPath: `docs/archive/${targetFile}`,
        }
      }

      // openspec/changes/* -> changes/
      if (rel.startsWith('openspec/changes/')) {
        const targetFile = rel.replace('openspec/changes/', '')
        return {
          inventoryItem: item,
          targetType: 'changes',
          confidence: 'high',
          confidenceScore: 0.8,
          adapterUsed: 'openspec',
          reasoning: `OpenSpec change file mapped to changes/`,
          proposedTargetPath: `docs/changes/${targetFile}`,
        }
      }

      // project.md -> decisions/ candidate
      if (rel === 'project.md') {
        return {
          inventoryItem: item,
          targetType: 'decisions',
          confidence: 'medium',
          confidenceScore: 0.5,
          adapterUsed: 'openspec',
          reasoning: `project.md is a governance file; candidate for decisions/`,
          proposedTargetPath: `docs/decisions/project.md`,
        }
      }

      // AGENTS.md -> references/raw/
      if (rel === 'AGENTS.md') {
        return {
          inventoryItem: item,
          targetType: 'references/raw',
          confidence: 'medium',
          confidenceScore: 0.4,
          adapterUsed: 'openspec',
          reasoning: `AGENTS.md is a reference/governance file mapped to references/raw/`,
          proposedTargetPath: `docs/references/raw/AGENTS.md`,
        }
      }

      // Fallback for any other markdown under openspec/
      return {
        inventoryItem: item,
        targetType: 'references/raw',
        confidence: 'low',
        confidenceScore: 0.3,
        adapterUsed: 'openspec',
        reasoning: `Unrecognized OpenSpec file; defaulting to references/raw/`,
        proposedTargetPath: `docs/references/raw/${rel.replace('openspec/', '')}`,
      }
    })
  },
}
