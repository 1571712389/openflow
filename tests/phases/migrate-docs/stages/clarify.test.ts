import { describe, it, expect } from 'vitest'
import { runClarifyStage } from '../../../../src/phases/migrate-docs/stages/clarify'
import { createInitialMigrationState, addPendingQuestion } from '../../../../src/phases/migrate-docs/state-machine'
import type {
  ClassificationResult,
  FileInventory,
  MigrationState,
  TargetCategory,
} from '../../../../src/phases/migrate-docs/types'

function makeInventory(relativePath: string): FileInventory {
  return {
    sourcePath: `/tmp/source/${relativePath}`,
    relativePath,
    size: 100,
    modifiedAt: new Date().toISOString(),
    extension: '.md',
    directoryContext: '',
  }
}

function makeClassification(
  relativePath: string,
  targetType: TargetCategory,
  confidenceScore = 0.6
): ClassificationResult {
  const inventoryItem = makeInventory(relativePath)
  return {
    inventoryItem,
    targetType,
    confidence: confidenceScore >= 0.7 ? 'high' : confidenceScore >= 0.4 ? 'medium' : 'low',
    confidenceScore,
    adapterUsed: 'generic',
    reasoning: `Classification for ${relativePath}`,
    proposedTargetPath: `docs/${targetType}/${relativePath}`,
  }
}

function makeClarifyState(classifications: ClassificationResult[] = []): MigrationState {
  return {
    ...createInitialMigrationState('/tmp/source', '/tmp/target', 'generic'),
    stage: 'clarify',
    classifications,
  }
}

describe('runClarifyStage', () => {
  it('skips directly to plan when no pending questions exist', async () => {
    const state = makeClarifyState([makeClassification('spec.md', 'current/spec', 0.85)])

    const result = await runClarifyStage(state)

    expect(result.awaitingUserInput).toBe(false)
    expect(result.state.stage).toBe('plan')
    expect(result.output.toLowerCase()).toContain('skipping to plan')
  })

  it('formats manual fallback prompt when askQuestion is unavailable', async () => {
    const classification = makeClassification('design.md', 'current/design', 0.5)
    const withQuestion = addPendingQuestion(makeClarifyState([classification]), {
      header: 'Clarification: current / design',
      question: 'How should this batch be routed?',
      options: [],
      batchTopic: 'current/design',
      affectedFiles: ['design.md'],
      classificationProposal: [classification],
    })

    const result = await runClarifyStage(withQuestion)

    expect(result.awaitingUserInput).toBe(true)
    expect(result.state.stage).toBe('clarify')
    expect(result.output).toContain('Migration Clarification Question')
    expect(result.output).toContain('Accept classification')
    expect(result.output).toContain('Route to alternative category')
    expect(result.output).toContain('Skip file')
  })

  it('processes pending questions one batch at a time', async () => {
    const first = makeClassification('a.md', 'current/spec', 0.6)
    const second = makeClassification('b.md', 'current/design', 0.6)

    let state = makeClarifyState([first, second])
    state = addPendingQuestion(state, {
      header: 'First batch',
      question: 'First question?',
      options: [],
      batchTopic: 'current/spec',
      affectedFiles: ['a.md'],
      classificationProposal: [first],
    })
    state = addPendingQuestion(state, {
      header: 'Second batch',
      question: 'Second question?',
      options: [],
      batchTopic: 'current/design',
      affectedFiles: ['b.md'],
      classificationProposal: [second],
    })

    const capturedHeaders: string[] = []
    const result = await runClarifyStage(state, {
      askQuestion: async ({ questions }) => {
        capturedHeaders.push(questions[0]!.header)
        return [['Accept classification']]
      },
    })

    expect(capturedHeaders).toEqual(['First batch'])
    expect(result.state.pendingQuestions).toHaveLength(1)
    expect(result.state.pendingQuestions[0]!.header).toBe('Second batch')
    expect(result.state.resolvedQuestions).toHaveLength(1)
    expect(result.state.stage).toBe('clarify')
    expect(result.awaitingUserInput).toBe(true)
    expect(result.output).toContain('Second batch')
  })

  it('ADR candidate prompt includes confirm and route-to-notes options', async () => {
    const adrCandidate = makeClassification('adr-candidate.md', 'decisions', 0.6)
    const withQuestion = addPendingQuestion(makeClarifyState([adrCandidate]), {
      header: 'Clarification: ADR Candidates',
      question: 'Confirm ADR routing?',
      options: [],
      batchTopic: 'adr-candidates',
      affectedFiles: ['adr-candidate.md'],
      classificationProposal: [adrCandidate],
    })

    const asked: Array<{ label: string; description: string }> = []
    await runClarifyStage(withQuestion, {
      askQuestion: async ({ questions }) => {
        for (const option of questions[0]!.options) {
          asked.push({ label: option.label, description: option.description })
        }
        return [['Confirm as ADR']]
      },
    })

    expect(asked.map((o) => o.label)).toContain('Confirm as ADR')
    expect(asked.map((o) => o.label)).toContain('Route to references/notes')
  })

  it('advances to plan after resolving the final pending question', async () => {
    const classification = makeClassification('design.md', 'current/design', 0.5)
    const withQuestion = addPendingQuestion(makeClarifyState([classification]), {
      header: 'Only batch',
      question: 'Resolve?',
      options: [],
      batchTopic: 'current/design',
      affectedFiles: ['design.md'],
      classificationProposal: [classification],
    })

    const result = await runClarifyStage(withQuestion, {
      askQuestion: async () => [['accept']],
    })

    expect(result.awaitingUserInput).toBe(false)
    expect(result.state.pendingQuestions).toHaveLength(0)
    expect(result.state.resolvedQuestions).toHaveLength(1)
    expect(result.state.stage).toBe('plan')
  })
})
