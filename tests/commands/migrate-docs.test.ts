import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { handleMigrateDocs } from '../../src/commands/migrate-docs.js'
import { defaultConfig, type OpenFlowContext } from '../../src/types.js'

function createContext(directory: string): OpenFlowContext {
  return {
    directory,
    worktree: directory,
    client: {},
    $: {},
    config: { ...defaultConfig },
    enhancedPlans: new Set<string>(),
  }
}

function sourceFile(name: string): Array<[string, string]> {
  return [
    [name, `# ${name.replace('.md', '')}\n\nSample content for ${name}.\n`],
  ]
}

/**
 * Set up a minimal source directory with Markdown files and an adapter-detectable
 * structure (OpenSpec-style).
 */
async function setupSourceDir(base: string, files: Array<[string, string]>): Promise<string> {
  const srcDir = join(base, 'test-source')
  await mkdir(srcDir, { recursive: true })

  for (const [relativePath, content] of files) {
    const fullPath = join(srcDir, relativePath)
    const parent = join(fullPath, '..')
    await mkdir(parent, { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
  }

  return srcDir
}

describe('migrate-docs command', () => {
  test('throws when sourceDir is missing and no active session exists', async () => {
    const root = join(process.cwd(), '.test-migrate-docs-missing-source')
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })

    await expect(
      handleMigrateDocs(createContext(root), {})
    ).rejects.toThrow('No active migration session')

    await rm(root, { recursive: true, force: true })
  })

  test('new migration with sourceDir creates session and runs detect stage', async () => {
    const root = join(process.cwd(), '.test-migrate-docs-new-session')
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })

    const sourceDir = await setupSourceDir(root, sourceFile('readme.md'))

    const result = await handleMigrateDocs(createContext(root), { sourceDir })

    expect(result).toContain('Migration: Detect Complete')
    expect(result).toContain('Advancing to scan stage')

    // Verify session was persisted
    const migrationDir = join(root, '.sisyphus', 'docs-migration')
    const entries = await import('node:fs/promises').then((fs) => fs.readdir(migrationDir))
    const sessionFiles = entries.filter((e) => e.endsWith('.json') && e !== 'active.json')
    expect(sessionFiles.length).toBeGreaterThan(0)

    const sessionPath = join(migrationDir, sessionFiles[0]!)
    const session = JSON.parse(await readFile(sessionPath, 'utf-8')) as {
      stage: string
      sourcePath: string
      dryRun: boolean
      sourceType: string | null
      detectedAdapters: Array<{ type: string }>
    }

    expect(session.stage).toBe('scan')
    expect(session.sourcePath).toBe(sourceDir)
    expect(session.dryRun).toBe(false)

    await rm(root, { recursive: true, force: true })
  })

  test('resume from interrupted session continues at correct stage', async () => {
    const root = join(process.cwd(), '.test-migrate-docs-resume')
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })

    const sourceDir = await setupSourceDir(root, [
      ...sourceFile('README.md'),
      ...sourceFile('docs/guide.md'),
      ...sourceFile('docs/api.md'),
    ])

    // Run detect + scan stages
    await handleMigrateDocs(createContext(root), { sourceDir })

    // Run scan stage
    let result = await handleMigrateDocs(createContext(root), {})
    expect(result).toContain('Migration: Scan Complete')

    // Run classify stage
    result = await handleMigrateDocs(createContext(root), {})
    expect(result).toContain('Migration: Classify Complete')

    // Verify we're at the clarify stage
    const migrationDir = join(root, '.sisyphus', 'docs-migration')
    const entries = await import('node:fs/promises').then((fs) => fs.readdir(migrationDir))
    const sessionFiles = entries.filter((e) => e.endsWith('.json') && e !== 'active.json')

    const sessionPath = join(migrationDir, sessionFiles[0]!)
    const session = JSON.parse(await readFile(sessionPath, 'utf-8')) as {
      stage: string
    }
    // Should be at clarify (after classify advances)
    expect(session.stage).toBe('clarify')

    await rm(root, { recursive: true, force: true })
  })

  test('dryRun=true completes plan without file mutations', async () => {
    const root = join(process.cwd(), '.test-migrate-docs-dryrun')
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })

    const sourceDir = await setupSourceDir(root, [
      ...sourceFile('README.md'),
      ...sourceFile('docs/design.md'),
      ...sourceFile('openspec/project.md'),
    ])

    // Run with dryRun
    let result = await handleMigrateDocs(createContext(root), { sourceDir, dryRun: true })
    expect(result).toContain('Detect Complete')

    result = await handleMigrateDocs(createContext(root), {})
    expect(result).toContain('Scan Complete')

    result = await handleMigrateDocs(createContext(root), {})
    expect(result).toContain('Classify Complete')

    // Clarify — answer all pending questions automatically
    const migrationDir = join(root, '.sisyphus', 'docs-migration')
    let entries = await import('node:fs/promises').then((fs) => fs.readdir(migrationDir))
    let sessionFiles = entries.filter((e) => e.endsWith('.json') && e !== 'active.json')
    let sessionPath = join(migrationDir, sessionFiles[0]!)
    let session = JSON.parse(await readFile(sessionPath, 'utf-8')) as {
      stage: string
      pendingQuestions: Array<{ id: string }>
    }

    // Answer all pending questions with 'accept'
    while (session.pendingQuestions && session.pendingQuestions.length > 0) {
      result = await handleMigrateDocs(createContext(root), { answer: 'accept' })
      session = JSON.parse(await readFile(sessionPath, 'utf-8')) as {
        stage: string
        pendingQuestions: Array<{ id: string }>
      }
    }

    // Plan stage — should produce dry-run summary
    result = await handleMigrateDocs(createContext(root), {})
    expect(result).toContain('Migration Dry Run Summary')
    expect(result).toContain('No file mutations')

    // Verify session completed
    session = JSON.parse(await readFile(sessionPath, 'utf-8')) as {
      stage: string
    }
    expect(session.stage).toBe('completed')

    // Verify no docs were actually created in target
    entries = await import('node:fs/promises').then((fs) => {
      // docs/ may not exist at all
      return fs.readdir(root).catch(() => [])
    })
    expect(entries.includes('docs')).toBe(false)

    await rm(root, { recursive: true, force: true })
  })
})
