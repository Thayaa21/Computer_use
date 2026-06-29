'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * Directories and file prefixes to exclude from the snapshot.
 */
const EXCLUDED_DIRS = new Set(['node_modules', '.git']);

/**
 * Returns true if the entry should be excluded from the snapshot.
 * Excludes node_modules/, .git/, and any hidden files/dirs (starting with '.').
 *
 * @param {string} name - Basename of the directory entry
 * @returns {boolean}
 */
function isExcluded(name) {
  if (name.startsWith('.')) return true;
  if (EXCLUDED_DIRS.has(name)) return true;
  return false;
}

/**
 * Recursively collect directory entries up to `maxDepth` levels deep.
 *
 * @param {string} dir      - Absolute path to the directory to scan
 * @param {number} depth    - Current depth (0 = top level)
 * @param {number} maxDepth - Maximum depth to recurse into (inclusive)
 * @returns {Promise<string[]>} Lines representing the tree structure
 */
async function collectEntries(dir, depth, maxDepth) {
  let lines = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // If a directory cannot be read, skip it silently
    return lines;
  }

  // Sort: directories first, then files, both alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (isExcluded(entry.name)) continue;

    const indent = '  '.repeat(depth);
    const isDir = entry.isDirectory();
    const label = isDir ? `${entry.name}/` : entry.name;
    lines.push(`${indent}${label}`);

    // Recurse into subdirectories up to maxDepth
    if (isDir && depth < maxDepth) {
      const subPath = path.join(dir, entry.name);
      const subLines = await collectEntries(subPath, depth + 1, maxDepth);
      lines = lines.concat(subLines);
    }
  }

  return lines;
}

/**
 * Capture a structured summary of the project directory suitable for posting to Slack.
 * Lists up to 2 levels deep, excluding node_modules/, .git/, and hidden files/dirs.
 *
 * @param {string} dir - Absolute path to the project root directory
 * @returns {Promise<string>} A formatted, human-readable directory tree string
 */
async function snapshot(dir) {
  const MAX_DEPTH = 1; // depth 0 = top level, depth 1 = one level in (2 levels total)

  const lines = await collectEntries(dir, 0, MAX_DEPTH);

  if (lines.length === 0) {
    return `*Project Snapshot:* \`${dir}\`\n_(empty or all entries excluded)_`;
  }

  const tree = lines.join('\n');
  return `*Project Snapshot:* \`${dir}\`\n\`\`\`\n${tree}\n\`\`\``;
}

module.exports = { snapshot };
