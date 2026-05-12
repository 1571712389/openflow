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
  const lines = ['## Behavior Scenarios', '']

  if (model.acceptanceCriteria.length === 0) {
    lines.push(NOT_SPECIFIED)
    return lines.join('\n')
  }

  for (const criterion of model.acceptanceCriteria) {
    lines.push(`- ${escapeInline(criterion.description)}`)
  }

  return lines.join('\n')
}

function renderMustNotBehaviors(model: RequirementModel): string {
  return renderBulletSection('## Must Not Behaviors', model.nonGoals)
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
    lines.push(`- [${constraint.severity}] ${escapeInline(constraint.description)}`)
  }

  return lines.join('\n')
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
      `| ${escapeInline(criterion.description)} | ${escapeInline(model.testingStrategy ?? 'manual')} | ${NOT_SPECIFIED} | pending |`,
    )
  }

  return lines.join('\n')
}

function renderBulletSection(heading: string, items: string[]): string {
  const lines = [heading, '']

  if (items.length === 0) {
    lines.push(NOT_SPECIFIED)
    return lines.join('\n')
  }

  for (const item of items) {
    lines.push(`- ${escapeInline(item)}`)
  }

  return lines.join('\n')
}

function escapeInline(value: string): string {
  return normalizeWhitespace(value).replace(/([\\`*_{}\[\]()#+>|])/g, '\\$1')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim()
}
