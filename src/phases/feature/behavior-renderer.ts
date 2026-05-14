import type { RequirementModel } from './requirement-model.js'

const NOT_SPECIFIED = 'Not specified.'

export function renderBehaviorDocument(model: RequirementModel): string {
  const sections = [
    `# ${escapeInline(model.feature)} - Behavior`,
    '',
    renderScope(model),
    renderBehaviorScenarios(model),
    renderMustNotBehaviors(model),
    renderBoundaryScenarios(model),
    renderVerificationMapping(model),
  ]

  return sections.join('\n').trimEnd() + '\n'
}

function renderScope(model: RequirementModel): string {
  const lines = ['## Scope', '']

  const inScope = model.scopeBoundary.inScope
  const outOfScope = model.scopeBoundary.outOfScope

  if (inScope.length === 0 && outOfScope.length === 0) {
    lines.push(NOT_SPECIFIED)
    return lines.join('\n')
  }

  if (inScope.length > 0) {
    lines.push('**In scope:**')
    lines.push('')
    for (const item of inScope) {
      lines.push(`- ${escapeInline(item)}`)
    }
  }

  if (outOfScope.length > 0) {
    if (inScope.length > 0) {
      lines.push('')
    }
    lines.push('**Out of scope:**')
    lines.push('')
    for (const item of outOfScope) {
      lines.push(`- ${escapeInline(item)}`)
    }
  }

  return lines.join('\n')
}

function renderBehaviorScenarios(model: RequirementModel): string {
  const lines = [
    '## Behavior Scenarios',
    '',
    'These scenarios describe externally observable behavior. Implementation choices, internal state, and file-level mechanics belong in `design.md`.',
    '',
  ]

  if (model.acceptanceCriteria.length === 0) {
    lines.push(NOT_SPECIFIED)
    return lines.join('\n')
  }

  for (const criterion of model.acceptanceCriteria) {
    lines.push(`### Scenario: ${escapeInline(criterion.description)}`)
    lines.push('')
    lines.push('Given:')
    for (const condition of buildScenarioGiven(model, criterion.category)) {
      lines.push(`- ${escapeInline(condition)}`)
    }
    lines.push('')
    lines.push('When:')
    lines.push(`- A user or caller exercises the behavior covered by this scenario`)
    lines.push('')
    lines.push('Then:')
    lines.push(`- The observable outcome satisfies: ${escapeInline(criterion.description)}`)
    lines.push('- The result can be confirmed without inspecting implementation details')
    lines.push('')
  }

  return trimTrailingBlank(lines).join('\n')
}

function renderMustNotBehaviors(model: RequirementModel): string {
  const lines = ['## Must Not Behaviors', '']

  if (model.nonGoals.length === 0) {
    lines.push(NOT_SPECIFIED)
    return lines.join('\n')
  }

  lines.push('The following outcomes must not become user-visible behavior:')
  lines.push('')

  for (const item of model.nonGoals) {
    lines.push(`- ${escapeInline(item)}`)
  }

  return lines.join('\n')
}

function renderBoundaryScenarios(model: RequirementModel): string {
  const lines = ['## Boundary Scenarios', '']

  const boundaryConstraints = model.constraints.filter(
    (c) => c.category === 'scope' || c.category === 'security',
  )

  if (boundaryConstraints.length === 0) {
    lines.push(NOT_SPECIFIED)
    return lines.join('\n')
  }

  for (const constraint of boundaryConstraints) {
    lines.push(`### Boundary: ${escapeInline(constraint.description)}`)
    lines.push('')
    lines.push('Given:')
    lines.push(`- The behavior is near this boundary: ${escapeInline(constraint.rationale)}`)
    lines.push('')
    lines.push('When:')
    lines.push('- A request, workflow, or implementation choice would cross that boundary')
    lines.push('')
    lines.push('Then:')
    lines.push(`- The boundary remains enforced as a ${constraint.severity} requirement`)
    lines.push(`- Evidence: ${escapeInline(constraint.verificationMethod)}`)
    lines.push('')
  }

  return trimTrailingBlank(lines).join('\n')
}

function renderVerificationMapping(model: RequirementModel): string {
  const lines = ['## Verification Mapping', '']

  if (model.acceptanceCriteria.length === 0) {
    lines.push(NOT_SPECIFIED)
    return lines.join('\n')
  }

  lines.push('| Behavior | Evidence Type | Expected Evidence | Status |')
  lines.push('|----------|--------------|-------------------|--------|')

  for (const criterion of model.acceptanceCriteria) {
    lines.push(
      `| ${escapeInline(criterion.description)} | ${escapeInline(model.testingStrategy ?? 'manual')} | Observable evidence that this behavior occurs for the intended user or caller | pending |`,
    )
  }

  return lines.join('\n')
}

function buildScenarioGiven(model: RequirementModel, category: string | undefined): string[] {
  const conditions = []

  if (model.targetUsers) {
    conditions.push(`The target user is ${model.targetUsers}`)
  }

  if (model.problemStatement) {
    conditions.push(`The user need or problem is: ${model.problemStatement}`)
  }

  if (category === 'constraints') {
    conditions.push('A stated product or engineering constraint applies to this behavior')
  }

  if (category === 'priority') {
    conditions.push('The selected delivery priority is part of the expected outcome')
  }

  if (conditions.length === 0) {
    conditions.push(`${model.feature} is in scope for the documented change`)
  }

  return conditions
}

function escapeInline(value: string): string {
  return normalizeWhitespace(value).replace(/([\\`*_{}\[\]()#+>|])/g, '\\$1')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim()
}

function trimTrailingBlank(lines: string[]): string[] {
  while (lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}
