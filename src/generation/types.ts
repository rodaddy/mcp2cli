/**
 * Types for skill generation module.
 * Used by grouping, templates, and file-manager to structure generation data.
 */
import type { SchemaOutput, ToolSummary } from "../schema/types.ts";

/** Input data for generating a SKILL.md file */
export interface SkillTemplateInput {
  serviceName: string;
  description: string;
  tools: ToolSummary[];
  triggerKeywords: string[];
}

/** A group of related tools clustered by noun prefix */
export interface ToolGroup {
  prefix: string;
  label: string;
  tools: SchemaOutput[];
  filename: string;
}

/** How to handle existing files during generation */
export type ConflictMode = "skip" | "force" | "merge";

/** A planned file write operation with resolved content and action */
export interface FileWritePlan {
  path: string;
  content: string;
  action: "create" | "overwrite" | "merge" | "skip";
  existingContent?: string;
}

/** Result summary from a skill generation run */
export interface SkillGenerationResult {
  service: string;
  skillFile: string;
  referenceFiles: string[];
  tokenCount: number;
  conflicts: string[];
}
