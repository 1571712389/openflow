import type { SkillInfo } from './types.js'

export function getFeatureSkill(): SkillInfo {
  return {
    name: 'openflow-feature',
    description: 'Manual command reference for /openflow-feature when the user wants to start or continue feature design clarification. The command advances one feature question at a time and generates design.md and behavior.md in docs/changes when answers are complete.',
    content: `# OpenFlow Feature Command Reference

## Overview

This help text documents the manual \`/openflow-feature\` command for new feature design clarification.
When the user runs that command, OpenFlow should drive the internal \`openflow-feature\` tool and keep the workflow one question at a time.

## Public Entry

Start with:

\`/openflow-feature <feature>\`

## Required Behavior

1. Treat the user's message as the feature name or the next feature-design answer when a feature session is already active in the same chat.
2. Use the internal OpenFlow \`openflow-feature\` tool to execute the workflow.
3. Ask or advance exactly one feature-design question at a time.
4. Reuse the existing feature session when the same chat already has an active feature workflow.
5. When all required answers are collected, let OpenFlow generate the design document and return the generated path.
6. After feature design is complete, do not keep the user trapped in feature design. They may continue to implementation, verification, or archive.

## Notes

- Feature design is a soft workflow entrypoint, not a hard gate.
- OpenFlow may suggest this command, but it should not be auto-executed just because feature work was mentioned.
- Research, reading, and implementation tasks should remain non-blocking.
- Design outputs belong in a dated workspace such as \`docs/changes/2026-04-17-{feature}/\`.
`,
  }
}
