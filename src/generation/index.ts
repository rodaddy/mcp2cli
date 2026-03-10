/**
 * Barrel exports for skill generation module.
 */

// Types
export type {
  SkillTemplateInput,
  ToolGroup,
  ConflictMode,
  FileWritePlan,
  SkillGenerationResult,
} from "./types.ts";

// Grouping
export { detectPrefixGroups, stripServicePrefix } from "./grouping.ts";

// Templates
export {
  estimateTokens,
  generateReferenceMd,
  generateSkillMd,
} from "./templates.ts";

// File manager
export {
  resolveOutputDir,
  mergeContent,
  planFileWrites,
  executeFileWrites,
} from "./file-manager.ts";

// Preservation
export {
  extractManualSections,
  injectManualSections,
  createManualPlaceholder,
} from "./preserve.ts";
export type { ManualSection } from "./preserve.ts";

// Diff
export {
  parseExistingTools,
  computeSkillDiff,
  formatDiffPreview,
} from "./diff.ts";
export type { ToolChange, SkillDiffResult } from "./diff.ts";

// Auto-regeneration
export { autoRegenerateSkills } from "./auto-regen.ts";
export type { AutoRegenResult } from "./auto-regen.ts";
