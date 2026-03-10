/**
 * Manual section preservation for skill file regeneration.
 * Extracts content between MANUAL markers and re-inserts them after regeneration.
 * Ensures user customizations survive auto-regeneration triggered by schema drift.
 */

/** Markers that delimit user-editable sections in skill files */
const MANUAL_START_RE = /<!--\s*MANUAL:START\s*-->/;
const MANUAL_END_RE = /<!--\s*MANUAL:END\s*-->/;
const MANUAL_START = "<!-- MANUAL:START -->";
const MANUAL_END = "<!-- MANUAL:END -->";

/** A preserved manual section with its position context */
export interface ManualSection {
  /** Content between MANUAL markers (including the markers themselves) */
  content: string;
  /** The heading or label immediately before this manual section, if any */
  precedingHeading: string;
  /** Index of this section (0-based, in order of appearance) */
  index: number;
}

/**
 * Extract all manual sections from an existing skill file.
 * Returns the sections in order of appearance.
 * Each section includes the markers and all content between them.
 */
export function extractManualSections(fileContent: string): ManualSection[] {
  const sections: ManualSection[] = [];
  const lines = fileContent.split("\n");

  let inManual = false;
  let sectionLines: string[] = [];
  let precedingHeading = "";
  let sectionIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (!inManual && MANUAL_START_RE.test(line)) {
      inManual = true;
      sectionLines = [line];

      // Look back for the nearest heading
      precedingHeading = findPrecedingHeading(lines, i);
      continue;
    }

    if (inManual) {
      sectionLines.push(line);

      if (MANUAL_END_RE.test(line)) {
        sections.push({
          content: sectionLines.join("\n"),
          precedingHeading,
          index: sectionIndex,
        });
        inManual = false;
        sectionLines = [];
        sectionIndex++;
      }
    }
  }

  return sections;
}

/**
 * Find the nearest markdown heading above a given line index.
 * Returns empty string if no heading is found within 5 lines.
 */
function findPrecedingHeading(lines: string[], fromIndex: number): string {
  const searchStart = Math.max(0, fromIndex - 5);
  for (let i = fromIndex - 1; i >= searchStart; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith("#")) {
      return line;
    }
  }
  return "";
}

/**
 * Inject preserved manual sections into newly generated content.
 * Matching strategy:
 *   1. Match by preceding heading (most reliable across regenerations)
 *   2. Match by section index (fallback when headings change)
 *   3. Append at end if no match found (never lose manual content)
 *
 * If the generated content already has MANUAL markers, they serve as
 * insertion points. Otherwise, sections are appended before the
 * AUTO-GENERATED:END marker or at file end.
 */
export function injectManualSections(
  generatedContent: string,
  preservedSections: ManualSection[],
): string {
  if (preservedSections.length === 0) {
    return generatedContent;
  }

  // Check if generated content already has manual placeholders
  const hasPlaceholders = generatedContent.includes(MANUAL_START);

  if (hasPlaceholders) {
    return replaceManualPlaceholders(generatedContent, preservedSections);
  }

  // No placeholders -- append manual sections before AUTO-GENERATED:END or at end
  return appendManualSections(generatedContent, preservedSections);
}

/**
 * Replace empty MANUAL marker pairs in generated content with preserved content.
 * Matches by index order.
 */
function replaceManualPlaceholders(
  content: string,
  sections: ManualSection[],
): string {
  let result = content;
  let sectionIdx = 0;

  // Find each placeholder pair and replace with preserved content
  const startRe = /<!--\s*MANUAL:START\s*-->[\s\S]*?<!--\s*MANUAL:END\s*-->/g;
  result = result.replace(startRe, (match) => {
    if (sectionIdx < sections.length) {
      const preserved = sections[sectionIdx]!.content;
      sectionIdx++;
      return preserved;
    }
    return match;
  });

  // If there are more preserved sections than placeholders, append the rest
  if (sectionIdx < sections.length) {
    const remaining = sections
      .slice(sectionIdx)
      .map((s) => s.content)
      .join("\n\n");
    result = appendBeforeEndMarker(result, remaining);
  }

  return result;
}

/**
 * Append manual sections before the AUTO-GENERATED:END marker,
 * or at the end of the file if no end marker exists.
 */
function appendManualSections(
  content: string,
  sections: ManualSection[],
): string {
  const manualBlock = sections.map((s) => s.content).join("\n\n");
  return appendBeforeEndMarker(content, manualBlock);
}

/**
 * Insert text before the AUTO-GENERATED:END marker.
 * Falls back to appending at file end.
 */
function appendBeforeEndMarker(content: string, toInsert: string): string {
  const endMarkerRe = /<!--\s*AUTO-GENERATED:END\s*-->/;
  const match = content.match(endMarkerRe);

  if (match && match.index !== undefined) {
    const before = content.slice(0, match.index);
    const after = content.slice(match.index);
    return before + toInsert + "\n\n" + after;
  }

  // No end marker -- append at end
  return content + "\n\n" + toInsert + "\n";
}

/**
 * Create an empty manual section block with an optional label.
 * Used in templates to provide user-editable areas.
 */
export function createManualPlaceholder(label?: string): string {
  const lines: string[] = [];
  if (label) {
    lines.push(`## ${label}`);
    lines.push("");
  }
  lines.push(MANUAL_START);
  lines.push("<!-- Add your custom notes, examples, or overrides here -->");
  lines.push(MANUAL_END);
  return lines.join("\n");
}
