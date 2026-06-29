'use strict';

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { snapshot } = require('./projectSnapshot');

/**
 * Helper: create a temporary directory tree for testing.
 * Returns the root temp dir path.
 */
async function makeTempTree(structure, root) {
  for (const [name, value] of Object.entries(structure)) {
    const fullPath = path.join(root, name);
    if (typeof value === 'string') {
      await fs.writeFile(fullPath, value);
    } else if (typeof value === 'object' && value !== null) {
      await fs.mkdir(fullPath, { recursive: true });
      await makeTempTree(value, fullPath);
    }
  }
}

describe('utils/projectSnapshot', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghostdev-snap-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Basic output format ─────────────────────────────────────────────────────

  test('returns a string', async () => {
    const result = await snapshot(tmpDir);
    expect(typeof result).toBe('string');
  });

  test('includes the directory path in the header', async () => {
    await makeTempTree({ 'index.js': 'console.log("hi")' }, tmpDir);
    const result = await snapshot(tmpDir);
    expect(result).toContain(tmpDir);
  });

  test('wraps the tree in a Slack code block', async () => {
    await makeTempTree({ 'README.md': '# hi' }, tmpDir);
    const result = await snapshot(tmpDir);
    expect(result).toContain('```');
  });

  // ── Exclusion rules ─────────────────────────────────────────────────────────

  test('excludes node_modules/', async () => {
    await makeTempTree(
      { 'node_modules': { 'lodash': { 'index.js': '' } }, 'index.js': '' },
      tmpDir
    );
    const result = await snapshot(tmpDir);
    expect(result).not.toContain('node_modules');
  });

  test('excludes .git/', async () => {
    await makeTempTree(
      { '.git': { HEAD: 'ref: refs/heads/main' }, 'index.js': '' },
      tmpDir
    );
    const result = await snapshot(tmpDir);
    expect(result).not.toContain('.git');
  });

  test('excludes hidden files (starting with .)', async () => {
    await makeTempTree({ '.env': 'SECRET=yes', 'app.js': '' }, tmpDir);
    const result = await snapshot(tmpDir);
    expect(result).not.toContain('.env');
  });

  test('excludes hidden directories (starting with .)', async () => {
    await makeTempTree({ '.kiro': { 'config.json': '{}' }, 'app.js': '' }, tmpDir);
    const result = await snapshot(tmpDir);
    expect(result).not.toContain('.kiro');
  });

  // ── Depth limit ──────────────────────────────────────────────────────────────

  test('includes top-level files and directories', async () => {
    await makeTempTree(
      { 'server.js': '', 'routes': { 'call.js': '' } },
      tmpDir
    );
    const result = await snapshot(tmpDir);
    expect(result).toContain('server.js');
    expect(result).toContain('routes/');
  });

  test('includes second-level entries (2 levels deep)', async () => {
    await makeTempTree(
      { 'routes': { 'call.js': '' } },
      tmpDir
    );
    const result = await snapshot(tmpDir);
    expect(result).toContain('call.js');
  });

  test('does NOT include third-level entries (beyond 2 levels)', async () => {
    await makeTempTree(
      { 'a': { 'b': { 'deep.js': '' } } },
      tmpDir
    );
    const result = await snapshot(tmpDir);
    // 'a/' and 'b/' should appear, but 'deep.js' is 3 levels deep and must be excluded
    expect(result).toContain('a/');
    expect(result).toContain('b/');
    expect(result).not.toContain('deep.js');
  });

  // ── Empty directory ─────────────────────────────────────────────────────────

  test('handles empty directory gracefully', async () => {
    const result = await snapshot(tmpDir);
    expect(result).toContain('empty or all entries excluded');
  });

  test('handles directory where all entries are excluded', async () => {
    await makeTempTree(
      { 'node_modules': { 'x': '' }, '.git': { HEAD: '' }, '.env': '' },
      tmpDir
    );
    const result = await snapshot(tmpDir);
    expect(result).toContain('empty or all entries excluded');
  });

  // ── Sorting ─────────────────────────────────────────────────────────────────

  test('lists directories before files', async () => {
    await makeTempTree(
      { 'zebra.js': '', 'alpha': { 'inner.js': '' } },
      tmpDir
    );
    const result = await snapshot(tmpDir);
    const dirIndex = result.indexOf('alpha/');
    const fileIndex = result.indexOf('zebra.js');
    expect(dirIndex).toBeLessThan(fileIndex);
  });

  // ── Indentation ──────────────────────────────────────────────────────────────

  test('indents second-level entries with two spaces', async () => {
    await makeTempTree({ 'utils': { 'helper.js': '' } }, tmpDir);
    const result = await snapshot(tmpDir);
    expect(result).toContain('  helper.js');
  });
});
