import { describe, expect, test } from 'bun:test'
import { createMinimalRequirementModel, resetIdCounter, type RequirementModel } from '../../src/phases/brainstorm/requirement-model.js'
import { renderBehaviorDocument } from '../../src/phases/brainstorm/behavior-renderer.js'

const REQUIRED_HEADINGS = [
  '## Scope',
  '## Behavior Scenarios',
  '## Must Not Behaviors',
  '## Boundary Scenarios',
  '## Verification Mapping',
] as const

describe('renderBehaviorDocument', () => {
  test('renders a full model with all required sections', () => {
    const model: RequirementModel = {
      feature: 'behavior-renderer',
      constraints: [
        {
          id: 'c-001',
          category: 'scope',
          severity: 'must',
          description: 'Keep within defined scope boundary',
          rationale: 'Prevent scope creep',
          verificationMethod: 'Review generated output',
          sourceQuestionId: 'constraints',
        },
        {
          id: 'c-002',
          category: 'security',
          severity: 'must',
          description: 'No sensitive data in output',
          rationale: 'Output may be logged',
          verificationMethod: 'Scan output for secrets',
          sourceQuestionId: 'constraints',
        },
      ],
      scopeBoundary: {
        inScope: ['Render behavior.md from a requirement model'],
        outOfScope: ['Wiring into brainstorm command'],
      },
      acceptanceCriteria: [
        {
          id: 'ac-001',
          description: 'Renderer emits all required sections in order',
        },
        {
          id: 'ac-002',
          description: 'Verification mapping table is correct',
        },
      ],
      goals: ['Produce stable behavior markdown'],
      nonGoals: ['Modify the brainstorm command'],
      testingStrategy: 'unit',
    }

    const markdown = renderBehaviorDocument(model)

    expectHeadingsExactlyOnce(markdown)
    expect(markdown).toContain('**In scope:**')
    expect(markdown).toContain('- Render behavior.md from a requirement model')
    expect(markdown).toContain('**Out of scope:**')
    expect(markdown).toContain('- Wiring into brainstorm command')
    expect(markdown).toContain('- [must] Keep within defined scope boundary')
    expect(markdown).toContain('- [must] No sensitive data in output')
    expect(markdown).toContain('| Renderer emits all required sections in order | unit | Not specified. | pending |')
    expect(markdown).toContain('| Verification mapping table is correct | unit | Not specified. | pending |')
  })

  test('renders a minimal model while preserving all required headings', () => {
    resetIdCounter()
    const model = createMinimalRequirementModel('minimal-feature')

    const markdown = renderBehaviorDocument(model)

    expectHeadingsExactlyOnce(markdown)
    expect(markdown).toContain('**In scope:**')
    expect(markdown).toContain('- minimal-feature core logic')
  })

  test('renders empty optional fields with Not specified', () => {
    const model: RequirementModel = {
      feature: 'empty-optional-fields',
      constraints: [],
      scopeBoundary: {
        inScope: [],
        outOfScope: [],
      },
      acceptanceCriteria: [],
      goals: [],
      nonGoals: [],
    }

    const markdown = renderBehaviorDocument(model)

    expectHeadingsExactlyOnce(markdown)
    expect(markdown).toContain('## Scope\n\nNot specified.')
    expect(markdown).toContain('## Behavior Scenarios\n\nNot specified.')
    expect(markdown).toContain('## Must Not Behaviors\n\nNot specified.')
    expect(markdown).toContain('## Boundary Scenarios\n\nNot specified.')
    expect(markdown).toContain('## Verification Mapping\n\nNot specified.')
  })

  test('keeps section headings in the required order', () => {
    resetIdCounter()
    const markdown = renderBehaviorDocument(createMinimalRequirementModel('ordered-feature'))

    let previousIndex = -1
    for (const heading of REQUIRED_HEADINGS) {
      const index = markdown.indexOf(heading)
      expect(index).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
  })

  test('renders verification mapping table with correct columns', () => {
    const model: RequirementModel = {
      feature: 'table-test',
      constraints: [],
      scopeBoundary: { inScope: [], outOfScope: [] },
      acceptanceCriteria: [
        { id: 'ac-001', description: 'First behavior' },
        { id: 'ac-002', description: 'Second behavior' },
      ],
      goals: [],
      nonGoals: [],
      testingStrategy: 'automated',
    }

    const markdown = renderBehaviorDocument(model)

    const tableHeader = '| Behavior | Evidence Type | Expected Evidence | Status |'
    const tableSeparator = '|----------|--------------|-------------------|--------|'
    expect(markdown).toContain(tableHeader)
    expect(markdown).toContain(tableSeparator)
    expect(markdown).toContain('| First behavior | automated | Not specified. | pending |')
    expect(markdown).toContain('| Second behavior | automated | Not specified. | pending |')
  })

  test('uses manual as default evidence type when testingStrategy is absent', () => {
    const model: RequirementModel = {
      feature: 'no-strategy',
      constraints: [],
      scopeBoundary: { inScope: [], outOfScope: [] },
      acceptanceCriteria: [
        { id: 'ac-001', description: 'Some behavior' },
      ],
      goals: [],
      nonGoals: [],
    }

    const markdown = renderBehaviorDocument(model)

    expect(markdown).toContain('| Some behavior | manual | Not specified. | pending |')
  })

  test('only shows scope and security constraints in boundary scenarios', () => {
    const model: RequirementModel = {
      feature: 'filter-test',
      constraints: [
        {
          id: 'c-001',
          category: 'scope',
          severity: 'must',
          description: 'Scope constraint',
          rationale: 'reason',
          verificationMethod: 'review',
          sourceQuestionId: 'constraints',
        },
        {
          id: 'c-002',
          category: 'security',
          severity: 'should',
          description: 'Security constraint',
          rationale: 'reason',
          verificationMethod: 'review',
          sourceQuestionId: 'constraints',
        },
        {
          id: 'c-003',
          category: 'performance',
          severity: 'may',
          description: 'Performance constraint',
          rationale: 'reason',
          verificationMethod: 'review',
          sourceQuestionId: 'constraints',
        },
      ],
      scopeBoundary: { inScope: [], outOfScope: [] },
      acceptanceCriteria: [],
      goals: [],
      nonGoals: [],
    }

    const markdown = renderBehaviorDocument(model)

    expect(markdown).toContain('- [must] Scope constraint')
    expect(markdown).toContain('- [should] Security constraint')
    expect(markdown).not.toContain('Performance constraint')
  })
})

function expectHeadingsExactlyOnce(markdown: string): void {
  for (const heading of REQUIRED_HEADINGS) {
    expect(markdown.match(new RegExp(`^${escapeRegExp(heading)}$`, 'gm'))).toHaveLength(1)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
