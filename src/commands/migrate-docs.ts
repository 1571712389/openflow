/**
 * Migrate-Docs Command Handler
 *
 * Routes migration execution through the stage lifecycle:
 * detect → scan → classify → clarify → plan → apply → cleanup
 *
 * Persists state after each stage for resumability.
 */

import type { OpenFlowContext } from '../types.js'
import type { MigrationState } from '../phases/migrate-docs/types.js'
import {
  createInitialMigrationState,
  getNextPendingQuestion,
  resolvePendingQuestion,
  removePendingQuestion,
} from '../phases/migrate-docs/state-machine.js'
import {
  saveMigrationSession,
  loadMigrationSession,
  updateMigrationSessionIndex,
  getActiveMigrationId,
  acquireMigrationLock,
} from '../phases/migrate-docs/persistence.js'
import { adapterRegistry } from '../phases/migrate-docs/adapters/index.js'
import { runDetectStage } from '../phases/migrate-docs/stages/detect.js'
import { runScanStage } from '../phases/migrate-docs/stages/scan.js'
import { runClassifyStage } from '../phases/migrate-docs/stages/classify.js'
import { runClarifyStage } from '../phases/migrate-docs/stages/clarify.js'
import { runPlanStage } from '../phases/migrate-docs/stages/plan.js'
import { runApplyStage } from '../phases/migrate-docs/stages/apply.js'
import { runCleanupStage } from '../phases/migrate-docs/stages/cleanup.js'
import { OpenFlowError, ErrorCode } from '../utils/errors.js'

export interface MigrateDocsArgs {
  sourceDir?: string
  targetDir?: string
  dryRun?: boolean
  answer?: string
}

/**
 * Main entry point for the migrate-docs command.
 */
export async function handleMigrateDocs(
  ctx: OpenFlowContext,
  args: MigrateDocsArgs
): Promise<string> {
  const state = await resolveSession(ctx.directory, args)

  switch (state.stage) {
    case 'detect':
      return runStage(state, ctx, args, runDetectStageFn)
    case 'scan':
      return runStage(state, ctx, args, runScanStageFn)
    case 'classify':
      return runStage(state, ctx, args, runClassifyStageFn)
    case 'clarify':
      return runClarifyWithAnswer(state, ctx, args)
    case 'plan':
      return runPlanStageFn(state, ctx)
    case 'apply':
      return runApplyStageFn(state, ctx)
    case 'cleanup':
      return runCleanupWithConfirmation(state, ctx, args)
    case 'completed':
      return formatCompleted(state)
    case 'failed':
      return formatFailed(state)
    default:
      throw new OpenFlowError(
        ErrorCode.INVALID_INPUT,
        `Unknown migration stage: ${state.stage}`
      )
  }
}

// ============================================================================
// Session Resolution
// ============================================================================

async function resolveSession(
  projectDir: string,
  args: MigrateDocsArgs
): Promise<MigrationState> {
  if (args.sourceDir) {
    // Explicit source directory — create new or load existing session
    const state = createInitialMigrationState(
      args.sourceDir,
      args.targetDir ?? '',
      null,
      { dryRun: args.dryRun ?? false }
    )

    // Check if a session already exists for this migration ID
    const existing = await loadMigrationSession(projectDir, state.migrationId)

    if (existing) {
      return existing
    }

    // Acquire lock and save new session
    await acquireMigrationLock(projectDir, state.migrationId)
    await saveMigrationSession(projectDir, state)
    await updateMigrationSessionIndex(projectDir, state)
    return state
  }

  // No sourceDir — try to resume active migration
  const activeId = await getActiveMigrationId(projectDir)
  if (!activeId) {
    throw new OpenFlowError(
      ErrorCode.INVALID_INPUT,
      'No active migration session. Provide --sourceDir to start a new migration, or resume an existing one.'
    )
  }

  const session = await loadMigrationSession(projectDir, activeId)
  if (!session) {
    throw new OpenFlowError(
      ErrorCode.OPERATION_FAILED,
      `Active migration session '${activeId}' not found on disk.`
    )
  }

  return session
}

// ============================================================================
// Stage Runners
// ============================================================================

async function runDetectStageFn(
  state: MigrationState,
  ctx: OpenFlowContext
): Promise<{ state: MigrationState; output: string }> {
  const updated = await runDetectStage(state, adapterRegistry)
  await saveMigrationSession(ctx.directory, updated)
  await updateMigrationSessionIndex(ctx.directory, updated)

  const output = [
    '## Migration: Detect Complete',
    '',
    `**Source:** ${updated.sourcePath}`,
    `**Target:** ${updated.targetRoot}`,
    `**Detected Adapter:** ${updated.sourceType ?? 'unknown'}`,
  ]

  if (updated.needsOpenFlowInit) {
    output.push('', '⚠ Target directory does not have OpenFlow initialized.')
  }

  if (updated.pendingQuestions.length > 0) {
    const firstQ = updated.pendingQuestions[0]
    if (firstQ) {
      output.push('', `**Next:** ${firstQ.header} — ${firstQ.question}`)
    }
  }

  output.push('', 'Advancing to scan stage.')
  return { state: updated, output: output.join('\n') }
}

async function runScanStageFn(
  state: MigrationState,
  ctx: OpenFlowContext
): Promise<{ state: MigrationState; output: string }> {
  const adapter = adapterRegistry.getAdapter(state.sourceType!)
  const updated = await runScanStage(state, adapter)
  await saveMigrationSession(ctx.directory, updated)
  await updateMigrationSessionIndex(ctx.directory, updated)

  const output = [
    '## Migration: Scan Complete',
    '',
    `**Files found:** ${updated.inventory.length}`,
    '',
    'Advancing to classify stage.',
  ]
  return { state: updated, output: output.join('\n') }
}

async function runClassifyStageFn(
  state: MigrationState,
  ctx: OpenFlowContext
): Promise<{ state: MigrationState; output: string }> {
  const adapter = adapterRegistry.getAdapter(state.sourceType!)
  const updated = await runClassifyStage(state, adapter)
  await saveMigrationSession(ctx.directory, updated)
  await updateMigrationSessionIndex(ctx.directory, updated)

  const output = [
    '## Migration: Classify Complete',
    '',
    `**Files classified:** ${updated.classifications.length}`,
    `**Pending questions:** ${updated.pendingQuestions.length}`,
    `**Conflicts detected:** ${updated.conflicts.length}`,
  ]

  if (updated.pendingQuestions.length > 0) {
    const firstQ = updated.pendingQuestions[0]
    if (firstQ) {
      output.push('', 'Advancing to clarify stage.')
    }
  } else {
    output.push('', 'No clarification needed. Advancing to plan stage.')
  }

  return { state: updated, output: output.join('\n') }
}

async function runClarifyWithAnswer(
  state: MigrationState,
  ctx: OpenFlowContext,
  args: MigrateDocsArgs
): Promise<string> {
  let updated = state

  // If an answer was provided, resolve the current pending question first
  if (args.answer?.trim()) {
    const nextQuestion = getNextPendingQuestion(updated)
    if (nextQuestion) {
      updated = resolvePendingQuestion(updated, nextQuestion.id, args.answer.trim())
      updated = removePendingQuestion(updated, nextQuestion.id)
      updated = { ...updated, updatedAt: new Date().toISOString() }
      await saveMigrationSession(ctx.directory, updated)
      await updateMigrationSessionIndex(ctx.directory, updated)
    }
  }

  const result = await runClarifyStage(updated)
  await saveMigrationSession(ctx.directory, result.state)
  await updateMigrationSessionIndex(ctx.directory, result.state)

  if (result.awaitingUserInput) {
    return result.output
  }

  return result.output
}

async function runPlanStageFn(
  state: MigrationState,
  ctx: OpenFlowContext
): Promise<string> {
  const result = await runPlanStage(state)
  await saveMigrationSession(ctx.directory, result.state)
  await updateMigrationSessionIndex(ctx.directory, result.state)

  return result.output
}

async function runApplyStageFn(
  state: MigrationState,
  ctx: OpenFlowContext
): Promise<string> {
  const result = await runApplyStage(state, ctx.directory)
  await saveMigrationSession(ctx.directory, result.state)
  await updateMigrationSessionIndex(ctx.directory, result.state)

  const applyResult = result.state.applyResult
  const output = [
    '## Migration: Apply Complete',
    '',
    applyResult ? `**Created:** ${applyResult.createdFiles.length}` : '',
    applyResult ? `**Modified:** ${applyResult.modifiedFiles.length}` : '',
    applyResult ? `**Skipped:** ${applyResult.skippedFiles.length}` : '',
    applyResult ? `**Failed:** ${applyResult.failedOps.length}` : '',
    '',
    'Advancing to cleanup stage.',
  ].filter(Boolean).join('\n')

  return output
}

async function runCleanupWithConfirmation(
  state: MigrationState,
  ctx: OpenFlowContext,
  args: MigrateDocsArgs
): Promise<string> {
  const confirmation = args.answer ?? ''
  const result = await runCleanupStage(state, confirmation, ctx.directory)
  await saveMigrationSession(ctx.directory, result.state)
  await updateMigrationSessionIndex(ctx.directory, result.state)

  return result.output
}

// ============================================================================
// Stage Runner Helper
// ============================================================================

async function runStage(
  state: MigrationState,
  ctx: OpenFlowContext,
  _args: MigrateDocsArgs,
  handler: (
    state: MigrationState,
    ctx: OpenFlowContext
  ) => Promise<{ state: MigrationState; output: string }>
): Promise<string> {
  const result = await handler(state, ctx)
  return result.output
}

// ============================================================================
// Output Formatters
// ============================================================================

function formatCompleted(state: MigrationState): string {
  const result = state.applyResult
  return [
    '## Migration Complete',
    '',
    `**Migration ID:** ${state.migrationId}`,
    `**Source:** ${state.sourcePath}`,
    `**Target:** ${state.targetRoot}`,
    `**Adapter:** ${state.sourceType ?? 'unknown'}`,
    result ? `**Files created:** ${result.createdFiles.length}` : '',
    result ? `**Files modified:** ${result.modifiedFiles.length}` : '',
    '',
    'Migration has been completed. Check the target directory for your migrated docs.',
  ].filter(Boolean).join('\n')
}

function formatFailed(state: MigrationState): string {
  return [
    '## Migration Failed',
    '',
    `**Migration ID:** ${state.migrationId}`,
    `**Source:** ${state.sourcePath}`,
    `**Target:** ${state.targetRoot}`,
    `**Error:** ${state.lastError ?? 'Unknown error'}`,
    '',
    'Restart the migration to retry.',
  ].join('\n')
}
