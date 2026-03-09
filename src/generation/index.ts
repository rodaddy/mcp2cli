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
