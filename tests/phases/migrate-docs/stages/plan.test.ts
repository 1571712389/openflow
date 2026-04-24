import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { runPlanStage } from '../../../../src/phases/migrate-docs/stages/plan'
import { createInitialMigrationState } from '../../../../src/phases/migrate-docs/state-machine'
import type {
  ClassificationResult,
  FileInventory,
  MigrationState,
  TargetCategory,
} from '../../../../src/phases/migrate-docs/types'

function makeInventory(baseDir: string, relativePath: string): FileInventory {
  return {
    sourcePath: path.join(baseDir, relativePath),
    relativePath,
    size: 123,
    modifiedAt: new Date().toISOString(),
    extension: '.md',
    directoryContext: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath),
  }
}

function makeClassification(
  baseDir: string,
  relativePath: string,
  targetType: TargetCategory,
  targetPath: string | undefined,
  confidenceScore = 0.8
): ClassificationResult {
  const inventoryItem = makeInventory(baseDir, relativePath)
  return {
    inventoryItem,
    targetType,
    confidence: confidenceScore >= 0.7 ? 'high' : confidenceScore >= 0.4 ? 'medium' : 'low',
    confidenceScore,
    adapterUsed: 'generic',
    reasoning: `classification for ${relativePath}`,
    proposedTargetPath: targetPath,
  }
}

describe('runPlanStage', () => {
  let tempDir: string
  let sourceDir: string
  let targetDir: string

  beforeEach(async () => {
    tempDir = path.join(process.cwd(), 'tests', 'fixtures', `plan-stage-${Date.now()}`)
    sourceDir = path.join(tempDir, 'source')
    targetDir = path.join(tempDir, 'target')
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(targetDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  function makePlanState(classifications: ClassificationResult[], dryRun = false): MigrationState {
    return {
      ...createInitialMigrationState(sourceDir, targetDir, 'generic', { dryRun }),
      stage: 'plan',
      classifications,
    }
  }

  it('generates migration plan with all create/skip operations and summary', async () => {
    const classifications = [
      makeClassification(sourceDir, 'a.md', 'current/spec', 'docs/current/spec/a.md', 0.9),
      makeClassification(
        sourceDir,
        'feature/design.md',
        'changes',
        'docs/changes/2026-04-24-feature/design.md',
        0.55
      ),
      makeClassification(sourceDir, 'skip-me.md', 'references/raw', undefined, 0.3),
    ]
    const state = makePlanState(classifications)

    const result = await runPlanStage(state)

    expect(result.state.stage).toBe('apply')
    expect(result.state.plan).toBeDefined()

    const operations = result.state.plan!.operations
    expect(operations.filter((op) => op.type === 'create')).toHaveLength(2)
    expect(operations.filter((op) => op.type === 'skip')).toHaveLength(1)
    expect(operations.filter((op) => op.type === 'create_dir').length).toBeGreaterThanOrEqual(1)

    expect(result.state.plan!.summary.totalFiles).toBe(3)
    expect(result.state.plan!.summary.byCategory['current/spec']).toBe(1)
    expect(result.state.plan!.summary.byCategory['changes']).toBe(1)
    expect(result.state.plan!.summary.confidenceDistribution).toEqual({
      high: 1,
      medium: 1,
      low: 1,
    })
  })

  it('computes directory creation order deepest first', async () => {
    const classifications = [
      makeClassification(
        sourceDir,
        'one.md',
        'changes',
        'docs/changes/2026-04-24-feature/sub/topic/one.md',
        0.8
      ),
      makeClassification(sourceDir, 'two.md', 'current/spec', 'docs/current/spec/two.md', 0.8),
    ]

    const result = await runPlanStage(makePlanState(classifications))
    const dirs = result.state.plan!.directoryCreations

    expect(dirs[0]).toBe('docs/changes/2026-04-24-feature/sub/topic')
    expect(dirs[dirs.length - 1]).toBe('docs/current/spec')
  })

  it('adds apply confirmation gate question', async () => {
    const classifications = [
      makeClassification(sourceDir, 'a.md', 'current/spec', 'docs/current/spec/a.md', 0.85),
    ]

    const result = await runPlanStage(makePlanState(classifications))
    const gate = result.state.pendingQuestions.find((q) => q.batchTopic === 'apply-confirmation-gate')

    expect(gate).toBeDefined()
    expect(gate!.question).toContain('Review migration plan. Proceed with apply?')
    expect(gate!.options.map((o) => o.label)).toEqual(['Apply', 'Cancel', 'Adjust'])
  })

  it('detects overwrite targets and adds overwrite confirmation batch', async () => {
    const existingTarget = path.join(targetDir, 'docs', 'current', 'spec')
    await fs.mkdir(existingTarget, { recursive: true })
    await fs.writeFile(path.join(existingTarget, 'existing.md'), '# existing', 'utf-8')

    const classifications = [
      makeClassification(sourceDir, 'existing.md', 'current/spec', 'docs/current/spec/existing.md', 0.8),
    ]

    const result = await runPlanStage(makePlanState(classifications))

    expect(result.state.plan!.summary.wouldOverwrite).toEqual(['docs/current/spec/existing.md'])
    const overwriteQuestion = result.state.pendingQuestions.find(
      (q) => q.batchTopic === 'plan-overwrite-confirmation'
    )
    expect(overwriteQuestion).toBeDefined()
    expect(overwriteQuestion!.affectedFiles).toEqual(['docs/current/spec/existing.md'])
  })

  it('dry-run preview stops after plan and marks state completed', async () => {
    const classifications = [
      makeClassification(sourceDir, 'preview.md', 'current/design', 'docs/current/design/preview.md', 0.7),
    ]

    const result = await runPlanStage(makePlanState(classifications, true))

    expect(result.state.plan).toBeDefined()
    expect(result.state.stage).toBe('completed')
    expect(result.output).toContain('Migration Dry Run Summary')
    expect(result.output.toLowerCase()).toContain('no file mutations')

    // Dry-run should not queue apply gate because workflow is already completed
    const gate = result.state.pendingQuestions.find((q) => q.batchTopic === 'apply-confirmation-gate')
    expect(gate).toBeUndefined()
  })
})
