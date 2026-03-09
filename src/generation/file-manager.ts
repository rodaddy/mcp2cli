/**
 * Output path resolution, conflict handling, and section-marker merge.
 * Handles all file I/O for skill generation.
 */
import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { ConflictMode, FileWritePlan } from "./types.ts";

/**
 * Resolve the output directory for skill generation.
 * Priority: outputFlag > PAI_SKILLS_DIR env > default (~/.config/mcp2cli/skills/<service>).
 */
export function resolveOutputDir(
  serviceName: string,
  outputFlag?: string,
): string {
  if (outputFlag) {
    return outputFlag;
  }

  const envDir = process.env.PAI_SKILLS_DIR;
  if (envDir) {
    return join(envDir, serviceName);
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return join(home, ".config", "mcp2cli", "skills", serviceName);
}

/** Tolerant regex for AUTO-GENERATED markers */
const MARKER_START_RE = /<!--\s*AUTO-GENERATED:START\s*-->/;
const MARKER_END_RE = /<!--\s*AUTO-GENERATED:END\s*-->/;

/**
 * Merge generated content into existing file content.
 * Replaces content between AUTO-GENERATED markers, preserving user sections outside.
 * If no markers in existing content, appends generated content at the end.
 */
export function mergeContent(existing: string, generated: string): string {
  const startMatch = existing.match(MARKER_START_RE);
  const endMatch = existing.match(MARKER_END_RE);

  // Extract auto-generated content from the generated string
  const genStartMatch = generated.match(MARKER_START_RE);
  const genEndMatch = generated.match(MARKER_END_RE);

  let autoContent: string;
  if (genStartMatch && genEndMatch) {
    const genStartIdx = genStartMatch.index!;
    const genEndIdx = genEndMatch.index! + genEndMatch[0]!.length;
    autoContent = generated.slice(genStartIdx, genEndIdx);
  } else {
    autoContent = generated;
  }

  // If no markers in existing, append at end
  if (!startMatch || !endMatch) {
    return existing + "\n" + autoContent;
  }

  // Replace between markers, preserving user content before and after
  const beforeMarker = existing.slice(0, startMatch.index!);
  const afterMarker = existing.slice(endMatch.index! + endMatch[0]!.length);

  return beforeMarker + autoContent + afterMarker;
}

/**
 * Plan file writes based on conflict mode.
 * Checks each target file for existence and determines the appropriate action.
 */
export async function planFileWrites(
  outputDir: string,
  generated: Map<string, string>,
  conflictMode: ConflictMode,
): Promise<FileWritePlan[]> {
  const plans: FileWritePlan[] = [];

  for (const [filename, content] of generated) {
    const filePath = join(outputDir, filename);
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      plans.push({ path: filePath, content, action: "create" });
      continue;
    }

    switch (conflictMode) {
      case "force":
        plans.push({
          path: filePath,
          content,
          action: "overwrite",
          existingContent: await file.text(),
        });
        break;

      case "skip":
        plans.push({
          path: filePath,
          content,
          action: "skip",
          existingContent: await file.text(),
        });
        break;

      case "merge": {
        const existingContent = await file.text();
        const merged = mergeContent(existingContent, content);
        plans.push({
          path: filePath,
          content: merged,
          action: "merge",
          existingContent,
        });
        break;
      }
    }
  }

  return plans;
}

/**
 * Execute planned file writes.
 * Creates parent directories, writes files, skips "skip" actions.
 * Returns list of written file paths.
 */
export async function executeFileWrites(
  plans: FileWritePlan[],
): Promise<string[]> {
  const written: string[] = [];

  for (const plan of plans) {
    if (plan.action === "skip") {
      continue;
    }

    // Ensure parent directory exists
    await mkdir(dirname(plan.path), { recursive: true });

    // Write file
    await Bun.write(plan.path, plan.content);
    written.push(plan.path);
  }

  return written;
}
