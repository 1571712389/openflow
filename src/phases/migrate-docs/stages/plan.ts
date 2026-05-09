import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {
  ClassificationResult,
  MigrationOperation,
  MigrationPlan,
  MigrationState,
  PlanSummary,
  TargetCategory,
} from '../types.js'
import { addPendingQuestion, markStageCompleted } from '../state-machine.js'

export interface PlanStageResult {
  state: MigrationState
  output: string
}

export async function runPlanStage(state: MigrationState): Promise<PlanStageResult> {
  const finalClassifications = compileFinalClassifications(state)
  const overwriteTargets = await detectOverwriteTargets(state, finalClassifications)
  const directoryCreations = computeDirectoryCreationOrder(finalClassifications)
  const operations = buildOperations(finalClassifications, directoryCreations)
  const summary = buildSummary(finalClassifications, overwriteTargets)

  const plan: MigrationPlan = {
    operations,
    directoryCreations,
    conflictResolutions: state.conflicts,
    summary,
  }

  let updatedState: MigrationState = {
    ...state,
    plan,
  }

  if (overwriteTargets.length > 0) {
    updatedState = addPendingQuestion(updatedState, {
      header: 'Plan: Overwrite Confirmation',
      question: `${overwriteTargets.length} planned target file(s) already exist. Choose how apply should handle these paths.`,
      options: [
        {
          label: 'Overwrite',
          description: 'Replace existing files during apply',
          value: 'overwrite',
        },
        {
          label: 'Skip existing',
          description: 'Keep existing files and skip conflicting creates',
          value: 'skip-existing',
        },
      ],
      batchTopic: 'plan-overwrite-confirmation',
      affectedFiles: overwriteTargets,
    })
  }

  if (state.dryRun) {
    const toApply = markStageCompleted(updatedState, 'plan', {
      metadata: {
        dryRun: true,
        totalOperations: plan.operations.length,
        wouldOverwrite: overwriteTargets.length,
      },
    })
    const toCleanup = markStageCompleted(toApply, 'apply', {
      metadata: {
        dryRun: true,
        skippedApplyExecution: true,
      },
    })
    const completed = markStageCompleted(toCleanup, 'cleanup', {
      metadata: {
        dryRun: true,
        completedWithoutMutations: true,
      },
    })

    return {
      state: completed,
      output: formatDryRunSummary(plan),
    }
  }

  updatedState = addPendingQuestion(updatedState, {
    header: 'Apply Confirmation Gate',
    question: 'Review migration plan. Proceed with apply?',
    options: [
      {
        label: 'Apply',
        description: 'Execute plan operations in apply stage',
        value: 'apply',
      },
      {
        label: 'Cancel',
        description: 'Stop migration now without changing files',
        value: 'cancel',
      },
      {
        label: 'Adjust',
        description: 'Return to clarification and adjust routing decisions',
        value: 'adjust',
      },
    ],
    batchTopic: 'apply-confirmation-gate',
    affectedFiles: finalClassifications.map((item) => item.inventoryItem.relativePath),
  })

  const advanced = markStageCompleted(updatedState, 'plan', {
    metadata: {
      totalFiles: summary.totalFiles,
      totalOperations: plan.operations.length,
      wouldOverwrite: overwriteTargets.length,
    },
  })

  return {
    state: advanced,
    output: formatPlanReadySummary(plan),
  }
}

function compileFinalClassifications(state: MigrationState): ClassificationResult[] {
  return state.classifications
}

function buildOperations(
  classifications: ClassificationResult[],
  directoryCreations: string[]
): MigrationOperation[] {
  const directoryOps: MigrationOperation[] = directoryCreations.map((targetPath) => ({
    type: 'create_dir',
    targetPath,
  }))

  const fileOps: MigrationOperation[] = classifications.map((classification) => {
    const sourcePath = classification.inventoryItem.sourcePath

    if (!classification.proposedTargetPath) {
      return {
        type: 'skip',
        sourcePath,
        targetPath: sourcePath,
        reason: 'Skipped by clarification decision',
      }
    }

    return {
      type: 'create',
      sourcePath,
      targetPath: classification.proposedTargetPath,
    }
  })

  return [...directoryOps, ...fileOps]
}

function computeDirectoryCreationOrder(classifications: ClassificationResult[]): string[] {
  const uniqueDirs = new Set<string>()

  for (const classification of classifications) {
    if (!classification.proposedTargetPath) {
      continue
    }
    uniqueDirs.add(path.posix.dirname(classification.proposedTargetPath))
  }

  return Array.from(uniqueDirs).sort((a, b) => {
    const depthA = a.split('/').filter(Boolean).length
    const depthB = b.split('/').filter(Boolean).length
    if (depthA !== depthB) {
      return depthB - depthA
    }
    return a.localeCompare(b)
  })
}

function buildSummary(
  classifications: ClassificationResult[],
  overwriteTargets: string[]
): PlanSummary {
  const byCategory: Partial<Record<TargetCategory, number>> = {}
  const confidenceDistribution = {
    high: 0,
    medium: 0,
    low: 0,
  }

  for (const classification of classifications) {
    if (classification.proposedTargetPath) {
      byCategory[classification.targetType] = (byCategory[classification.targetType] ?? 0) + 1
    }

    if (classification.confidence === 'high') confidenceDistribution.high += 1
    if (classification.confidence === 'medium') confidenceDistribution.medium += 1
    if (classification.confidence === 'low') confidenceDistribution.low += 1
  }

  return {
    totalFiles: classifications.length,
    byCategory,
    confidenceDistribution,
    wouldOverwrite: overwriteTargets,
  }
}

async function detectOverwriteTargets(
  state: MigrationState,
  classifications: ClassificationResult[]
): Promise<string[]> {
  const result: string[] = []

  for (const classification of classifications) {
    const relativeTargetPath = classification.proposedTargetPath
    if (!relativeTargetPath) {
      continue
    }

    const fullTargetPath = path.join(state.targetRoot, relativeTargetPath)
    try {
      const stats = await fs.stat(fullTargetPath)
      if (stats.isFile()) {
        result.push(relativeTargetPath)
      }
    } catch {
      // Not existing yet.
    }
  }

  return result.sort((a, b) => a.localeCompare(b))
}

function formatPlanReadySummary(plan: MigrationPlan): string {
  return [
    '## Migration Plan Ready',
    '',
    `- total files: ${plan.summary.totalFiles}`,
    `- create operations: ${plan.operations.filter((op) => op.type === 'create').length}`,
    `- create_dir operations: ${plan.operations.filter((op) => op.type === 'create_dir').length}`,
    `- skip operations: ${plan.operations.filter((op) => op.type === 'skip').length}`,
    `- would overwrite: ${plan.summary.wouldOverwrite.length}`,
  ].join('\n')
}

function formatDryRunSummary(plan: MigrationPlan): string {
  return [
    '## Migration Dry Run Summary',
    '',
    `- total files: ${plan.summary.totalFiles}`,
    `- create operations: ${plan.operations.filter((op) => op.type === 'create').length}`,
    `- create_dir operations: ${plan.operations.filter((op) => op.type === 'create_dir').length}`,
    `- skip operations: ${plan.operations.filter((op) => op.type === 'skip').length}`,
    `- would overwrite: ${plan.summary.wouldOverwrite.length}`,
    '',
    'Dry-run mode stopped after plan stage. No file mutations were performed.',
  ].join('\n')
}
