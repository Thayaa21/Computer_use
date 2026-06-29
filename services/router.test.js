/**
 * services/router.test.js
 *
 * Unit tests for services/router.js handlers.
 *
 * Tasks covered:
 *   16.3 — fetchFile, unknown, endSession (no-session), file-not-found
 *   16.5 — editCode (happy path + max-iteration), handleComputerUse (success + max-iteration)
 *   16.7 — commitCode (happy path, confirmation shape, Robot error)
 *
 * Requirements: 2.3, 3.1, 3.4, 4.3, 4.4, 6.2, 6.3, 6.4, 7.4, 7.5, 8.4
 */

'use strict';

// ─── Mock external dependencies BEFORE requiring router ──────────────────────

jest.mock('./slackBot');
jest.mock('./computerUse');
jest.mock('./uipath');
jest.mock('./sessionManager');
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      readFile: jest.fn(),
      readdir: jest.fn(),
    },
  };
});

const slackBot       = require('./slackBot');
const computerUse    = require('./computerUse');
const uipath         = require('./uipath');
const sessionManager = require('./sessionManager');
const fs             = require('fs');

const { handlers, dispatch, DISPATCH_TABLE } = require('./router');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reset all mocks between tests */
beforeEach(() => {
  jest.clearAllMocks();

  // Default: slackBot methods resolve without value
  slackBot.postMessage.mockResolvedValue(undefined);
  slackBot.postFile.mockResolvedValue(undefined);
  slackBot.postImage.mockResolvedValue(undefined);
  slackBot.postError.mockResolvedValue(undefined);

  // Default: session is not active
  sessionManager.isActive.mockReturnValue(false);

  // Provide a sensible PROJECT_DIR
  process.env.PROJECT_DIR = '/fake/project';
  process.env.UIPATH_COMMIT_PROCESS_KEY = 'commit-key';
  process.env.UIPATH_TEST_PROCESS_KEY   = 'test-key';
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 16.3 — fetchFile, unknown, endSession (no active session),
//              file-not-found → top-level listing
// Requirements: 2.3, 3.1, 3.4, 8.4
// ─────────────────────────────────────────────────────────────────────────────

describe('Task 16.3 — fetchFile handler', () => {
  // Requirement 3.1 — read the specified file and post it to Slack
  it('reads the requested file and calls slackBot.postFile with its contents', async () => {
    fs.promises.readFile.mockResolvedValue('const x = 1;');

    await handlers.fetchFile({ filePath: 'src/index.js' }, {});

    expect(fs.promises.readFile).toHaveBeenCalledWith(
      expect.stringContaining('src/index.js'),
      'utf8'
    );
    expect(slackBot.postFile).toHaveBeenCalledWith('src/index.js', 'const x = 1;');
    expect(slackBot.postMessage).not.toHaveBeenCalled();
  });

  it('resolves the file path relative to PROJECT_DIR', async () => {
    fs.promises.readFile.mockResolvedValue('hello');

    await handlers.fetchFile({ filePath: 'lib/utils.js' }, {});

    const [calledPath] = fs.promises.readFile.mock.calls[0];
    expect(calledPath).toBe('/fake/project/lib/utils.js');
  });

  it('posts a guidance message when no filePath is provided', async () => {
    await handlers.fetchFile({}, {});

    expect(slackBot.postMessage).toHaveBeenCalledWith(
      expect.stringMatching(/specify a file path/i)
    );
    expect(slackBot.postFile).not.toHaveBeenCalled();
  });

  it('posts a guidance message when data is null/undefined', async () => {
    await handlers.fetchFile(null, {});

    expect(slackBot.postMessage).toHaveBeenCalledWith(
      expect.stringMatching(/specify a file path/i)
    );
  });

  // Requirement 3.4 — file not found → post warning + top-level listing
  it('posts a not-found message with top-level listing when file is absent (ENOENT)', async () => {
    const notFoundErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    fs.promises.readFile.mockRejectedValue(notFoundErr);

    // Simulate two top-level entries
    fs.promises.readdir.mockResolvedValue([
      { name: 'src', isDirectory: () => true },
      { name: 'package.json', isDirectory: () => false },
    ]);

    await handlers.fetchFile({ filePath: 'missing/file.js' }, {});

    expect(slackBot.postMessage).toHaveBeenCalledTimes(1);
    const [message] = slackBot.postMessage.mock.calls[0];

    // Should mention the missing file
    expect(message).toContain('missing/file.js');
    // Should include at least one top-level entry (directory should have trailing /)
    expect(message).toContain('src/');
    expect(message).toContain('package.json');
    // Should NOT call postFile
    expect(slackBot.postFile).not.toHaveBeenCalled();
  });

  it('includes "(could not read project directory)" when readdir also fails', async () => {
    const notFoundErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    fs.promises.readFile.mockRejectedValue(notFoundErr);
    fs.promises.readdir.mockRejectedValue(new Error('Permission denied'));

    await handlers.fetchFile({ filePath: 'gone.js' }, {});

    const [message] = slackBot.postMessage.mock.calls[0];
    expect(message).toContain('could not read project directory');
  });

  it('calls postError for non-ENOENT read errors', async () => {
    const permErr = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    fs.promises.readFile.mockRejectedValue(permErr);

    await handlers.fetchFile({ filePath: 'secret.js' }, {});

    expect(slackBot.postError).toHaveBeenCalledWith('fetch_file', permErr);
    expect(slackBot.postMessage).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 16.3 — unknown handler
// Requirement 2.3 — unknown intent → clarification request
// ─────────────────────────────────────────────────────────────────────────────

describe('Task 16.3 — unknown handler (Req 2.3)', () => {
  it('posts a clarification message listing available commands', async () => {
    await handlers.unknown({}, {});

    expect(slackBot.postMessage).toHaveBeenCalledTimes(1);
    const [message] = slackBot.postMessage.mock.calls[0];

    // Must tell the user it didn't understand
    expect(message).toMatch(/didn't understand|Please try again/i);
    // Must list at least one available command
    expect(message).toContain('show me');
  });

  it('does not call postFile, postImage, or postError', async () => {
    await handlers.unknown({}, {});

    expect(slackBot.postFile).not.toHaveBeenCalled();
    expect(slackBot.postImage).not.toHaveBeenCalled();
    expect(slackBot.postError).not.toHaveBeenCalled();
  });

  it('works when data and context are both null', async () => {
    await expect(handlers.unknown(null, null)).resolves.toBeUndefined();
    expect(slackBot.postMessage).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 16.3 — endSession handler — no active session
// Requirement 8.4
// ─────────────────────────────────────────────────────────────────────────────

describe('Task 16.3 — endSession handler — no active session (Req 8.4)', () => {
  it('posts "no active session" message when sessionManager.isActive() is false', async () => {
    sessionManager.isActive.mockReturnValue(false);

    await handlers.endSession({}, {});

    expect(slackBot.postMessage).toHaveBeenCalledTimes(1);
    const [message] = slackBot.postMessage.mock.calls[0];
    expect(message).toMatch(/no active.*session|no.*session to end/i);
  });

  it('does not call sessionManager.endSession() when no session is active', async () => {
    sessionManager.isActive.mockReturnValue(false);

    await handlers.endSession({}, {});

    expect(sessionManager.endSession).not.toHaveBeenCalled();
  });

  it('does not call computerUse.lockScreen() when no session is active', async () => {
    sessionManager.isActive.mockReturnValue(false);

    await handlers.endSession({}, {});

    expect(computerUse.lockScreen).not.toHaveBeenCalled();
  });

  it('ends the session and locks screen when a session IS active', async () => {
    sessionManager.isActive.mockReturnValue(true);
    computerUse.lockScreen = jest.fn().mockResolvedValue(undefined);

    await handlers.endSession({}, {});

    expect(sessionManager.endSession).toHaveBeenCalledTimes(1);
    expect(computerUse.lockScreen).toHaveBeenCalledTimes(1);
    // Confirmation message should mention "session ended" or similar
    expect(slackBot.postMessage).toHaveBeenCalledWith(
      expect.stringMatching(/session ended|screen.*locked/i)
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 16.5 — editCode handler
// Requirements: 4.3, 4.4
// ─────────────────────────────────────────────────────────────────────────────

describe('Task 16.5 — editCode handler', () => {
  // Requirement 4.3 — success: confirmation includes file name and change description
  it('posts confirmation containing the file name on successful edit', async () => {
    computerUse.runLoop.mockResolvedValue({
      success: true,
      iterations: 3,
      lastScreenshot: null,
      finalMessage: 'Added error handling block',
    });

    await handlers.editCode({ filePath: 'src/db.js', instruction: 'add error handling' }, {});

    expect(computerUse.runLoop).toHaveBeenCalledTimes(1);
    expect(slackBot.postMessage).toHaveBeenCalledTimes(1);

    const [message] = slackBot.postMessage.mock.calls[0];
    // Must contain the file base name
    expect(message).toContain('db.js');
    // Must contain the change description (finalMessage)
    expect(message).toContain('Added error handling block');
  });

  it('includes the instruction as description when finalMessage is absent', async () => {
    computerUse.runLoop.mockResolvedValue({
      success: true,
      iterations: 2,
      lastScreenshot: null,
      finalMessage: undefined,
    });

    await handlers.editCode({ filePath: 'utils/helper.js', instruction: 'refactor loop' }, {});

    const [message] = slackBot.postMessage.mock.calls[0];
    expect(message).toContain('helper.js');
    expect(message).toContain('refactor loop');
  });

  // Requirement 4.4 — max-iteration failure: post failure message AND last screenshot
  it('posts failure message and last screenshot when max iterations are reached', async () => {
    const fakeScreenshot = Buffer.from('fake-png-data');

    computerUse.runLoop.mockResolvedValue({
      success: false,
      iterations: 20,
      lastScreenshot: fakeScreenshot,
    });

    await handlers.editCode({ filePath: 'src/auth.js', instruction: 'fix token refresh' }, {});

    // Should NOT call postFile
    expect(slackBot.postFile).not.toHaveBeenCalled();

    // Must post a failure message mentioning the file
    expect(slackBot.postMessage).toHaveBeenCalledTimes(1);
    const [failMessage] = slackBot.postMessage.mock.calls[0];
    expect(failMessage).toContain('auth.js');
    expect(failMessage).toContain('20');

    // Must post the last screenshot
    expect(slackBot.postImage).toHaveBeenCalledWith(
      fakeScreenshot,
      expect.any(String)
    );
  });

  it('posts failure message without postImage when no screenshot is available', async () => {
    computerUse.runLoop.mockResolvedValue({
      success: false,
      iterations: 20,
      lastScreenshot: null,
    });

    await handlers.editCode({ filePath: 'src/missing.js', instruction: 'do something' }, {});

    expect(slackBot.postMessage).toHaveBeenCalledTimes(1);
    expect(slackBot.postImage).not.toHaveBeenCalled();
  });

  it('calls postError when computerUse.runLoop throws', async () => {
    const err = new Error('Claude API unreachable');
    computerUse.runLoop.mockRejectedValue(err);

    await handlers.editCode({ filePath: 'src/foo.js', instruction: 'fix it' }, {});

    expect(slackBot.postError).toHaveBeenCalledWith('edit_code', err);
    expect(slackBot.postMessage).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 16.5 — handleComputerUse handler
// Requirements: 7.4, 7.5
// ─────────────────────────────────────────────────────────────────────────────

describe('Task 16.5 — computer_use handler (handleComputerUse)', () => {
  // Requirement 7.4 — success: post final screenshot + completion message
  it('posts the last screenshot with completion message on success', async () => {
    const fakeScreenshot = Buffer.from('screenshot-bytes');

    computerUse.runLoop.mockResolvedValue({
      success: true,
      iterations: 5,
      lastScreenshot: fakeScreenshot,
      finalMessage: 'Opened Chrome and navigated to localhost:3000',
    });

    await handlers.computerUse({ instruction: 'open Chrome and go to localhost:3000' }, {});

    expect(computerUse.runLoop).toHaveBeenCalledWith('open Chrome and go to localhost:3000');
    expect(slackBot.postImage).toHaveBeenCalledWith(
      fakeScreenshot,
      expect.stringContaining('Opened Chrome')
    );
    expect(slackBot.postMessage).not.toHaveBeenCalled();
  });

  it('posts a text completion message when no screenshot is available on success', async () => {
    computerUse.runLoop.mockResolvedValue({
      success: true,
      iterations: 1,
      lastScreenshot: null,
      finalMessage: 'Done!',
    });

    await handlers.computerUse({ instruction: 'do something' }, {});

    expect(slackBot.postMessage).toHaveBeenCalledWith(
      expect.stringContaining('Done!')
    );
    expect(slackBot.postImage).not.toHaveBeenCalled();
  });

  // Requirement 7.5 — max-iteration failure: post screenshot + failure message
  it('posts failure screenshot and message when max iterations are reached', async () => {
    const fakeScreenshot = Buffer.from('last-screenshot');

    computerUse.runLoop.mockResolvedValue({
      success: false,
      iterations: 20,
      lastScreenshot: fakeScreenshot,
    });

    await handlers.computerUse({ instruction: 'install packages' }, {});

    // Must post the last screenshot with a failure message
    expect(slackBot.postImage).toHaveBeenCalledWith(
      fakeScreenshot,
      expect.stringMatching(/not completed.*20 iterations|20 iterations/i)
    );
    expect(slackBot.postMessage).not.toHaveBeenCalled();
  });

  it('posts text failure message when max iterations reached and no screenshot available', async () => {
    computerUse.runLoop.mockResolvedValue({
      success: false,
      iterations: 20,
      lastScreenshot: null,
    });

    await handlers.computerUse({ instruction: 'do something' }, {});

    expect(slackBot.postMessage).toHaveBeenCalledWith(
      expect.stringMatching(/not completed|20 iterations/i)
    );
    expect(slackBot.postImage).not.toHaveBeenCalled();
  });

  it('posts a guidance message when no instruction is provided', async () => {
    await handlers.computerUse({}, {});

    expect(slackBot.postMessage).toHaveBeenCalledWith(
      expect.stringMatching(/provide a specific instruction/i)
    );
    expect(computerUse.runLoop).not.toHaveBeenCalled();
  });

  it('calls postError when computerUse.runLoop throws', async () => {
    const err = new Error('Screenshot capture failed');
    computerUse.runLoop.mockRejectedValue(err);

    await handlers.computerUse({ instruction: 'open terminal' }, {});

    expect(slackBot.postError).toHaveBeenCalledWith('computer_use', err);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 16.7 — commitCode handler
// Requirements: 6.2, 6.3, 6.4
// ─────────────────────────────────────────────────────────────────────────────

describe('Task 16.7 — commitCode handler', () => {
  // Requirement 6.2 — commit message extracted from intent data and passed unchanged
  it('passes the commit message from data to uipath.triggerAndPoll unchanged', async () => {
    const commitMessage = 'fix: resolve login race condition';

    uipath.triggerAndPoll.mockResolvedValue({
      success: true,
      output: { commitHash: 'abc1234', CommitHash: 'abc1234' },
    });

    await handlers.commitCode({ commitMessage }, {});

    expect(uipath.triggerAndPoll).toHaveBeenCalledWith(
      process.env.UIPATH_COMMIT_PROCESS_KEY,
      { commitMessage }
    );

    // Verify no transformation — the exact string is forwarded
    const [, inputArgs] = uipath.triggerAndPoll.mock.calls[0];
    expect(inputArgs.commitMessage).toBe(commitMessage);
  });

  it('passes special characters in commit message without modification', async () => {
    const specialMessage = 'feat(auth)!: breaking change — update token schema & re-auth all';

    uipath.triggerAndPoll.mockResolvedValue({
      success: true,
      output: { commitHash: 'deadbeef' },
    });

    await handlers.commitCode({ commitMessage: specialMessage }, {});

    const [, inputArgs] = uipath.triggerAndPoll.mock.calls[0];
    expect(inputArgs.commitMessage).toBe(specialMessage);
  });

  it('uses default commit message when none provided', async () => {
    uipath.triggerAndPoll.mockResolvedValue({
      success: true,
      output: { commitHash: 'xyz9999' },
    });

    await handlers.commitCode({}, {});

    const [, inputArgs] = uipath.triggerAndPoll.mock.calls[0];
    expect(typeof inputArgs.commitMessage).toBe('string');
    expect(inputArgs.commitMessage.length).toBeGreaterThan(0);
  });

  // Requirement 6.3 — success: confirmation contains commit hash AND message
  it('posts confirmation containing the commit hash and the original message', async () => {
    const commitMessage = 'chore: bump dependencies';
    const commitHash    = 'fa3b21c';

    uipath.triggerAndPoll.mockResolvedValue({
      success: true,
      output: { commitHash },
    });

    await handlers.commitCode({ commitMessage }, {});

    expect(slackBot.postMessage).toHaveBeenCalledTimes(1);
    const [message] = slackBot.postMessage.mock.calls[0];

    expect(message).toContain(commitHash);
    expect(message).toContain(commitMessage);
  });

  it('reads CommitHash from output when commitHash key is absent', async () => {
    uipath.triggerAndPoll.mockResolvedValue({
      success: true,
      output: { CommitHash: 'UPPER123' },
    });

    await handlers.commitCode({ commitMessage: 'test commit' }, {});

    const [message] = slackBot.postMessage.mock.calls[0];
    expect(message).toContain('UPPER123');
  });

  it('reads hash from "hash" key when neither commitHash nor CommitHash is present', async () => {
    uipath.triggerAndPoll.mockResolvedValue({
      success: true,
      output: { hash: 'shortkey' },
    });

    await handlers.commitCode({ commitMessage: 'another commit' }, {});

    const [message] = slackBot.postMessage.mock.calls[0];
    expect(message).toContain('shortkey');
  });

  it('includes "(hash unavailable)" when no hash key exists in output', async () => {
    uipath.triggerAndPoll.mockResolvedValue({
      success: true,
      output: {},
    });

    await handlers.commitCode({ commitMessage: 'no hash commit' }, {});

    const [message] = slackBot.postMessage.mock.calls[0];
    expect(message).toContain('hash unavailable');
  });

  // Requirement 6.4 — failure: error message from Robot posted to Slack
  it('posts failure message with Robot error reason when commit fails', async () => {
    uipath.triggerAndPoll.mockResolvedValue({
      success: false,
      error: 'Nothing to commit, working tree clean',
    });

    await handlers.commitCode({ commitMessage: 'empty commit' }, {});

    expect(slackBot.postMessage).toHaveBeenCalledTimes(1);
    const [message] = slackBot.postMessage.mock.calls[0];

    expect(message).toMatch(/commit failed|failed/i);
    expect(message).toContain('Nothing to commit, working tree clean');
  });

  it('posts a generic failure message when error field is absent', async () => {
    uipath.triggerAndPoll.mockResolvedValue({
      success: false,
      error: undefined,
    });

    await handlers.commitCode({ commitMessage: 'bad commit' }, {});

    const [message] = slackBot.postMessage.mock.calls[0];
    expect(message).toMatch(/commit failed|unknown error/i);
  });

  it('calls postError when uipath.triggerAndPoll throws', async () => {
    const err = new Error('UiPath Robot offline');
    uipath.triggerAndPoll.mockRejectedValue(err);

    await handlers.commitCode({ commitMessage: 'will throw' }, {});

    expect(slackBot.postError).toHaveBeenCalledWith('commit_code', err);
    expect(slackBot.postMessage).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dispatch() — top-level wiring
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch() — intent routing', () => {
  it('routes fetch_file intent to fetchFile handler', async () => {
    fs.promises.readFile.mockResolvedValue('content');

    await dispatch({ intent: 'fetch_file', data: { filePath: 'README.md' } }, {});

    expect(fs.promises.readFile).toHaveBeenCalled();
  });

  it('routes unknown intent to unknown handler', async () => {
    await dispatch({ intent: 'unknown', data: {} }, {});

    expect(slackBot.postMessage).toHaveBeenCalledWith(
      expect.stringMatching(/didn't understand|Please try again/i)
    );
  });

  it('falls back to unknown handler for unrecognised intents', async () => {
    await dispatch({ intent: 'teleport', data: {} }, {});

    expect(slackBot.postMessage).toHaveBeenCalledWith(
      expect.stringMatching(/didn't understand|Please try again/i)
    );
  });

  it('routes commit_code intent to commitCode handler', async () => {
    uipath.triggerAndPoll.mockResolvedValue({ success: true, output: { commitHash: 'abc' } });

    await dispatch({ intent: 'commit_code', data: { commitMessage: 'test' } }, {});

    expect(uipath.triggerAndPoll).toHaveBeenCalled();
  });

  it('routes end_session with no active session → no-session message', async () => {
    sessionManager.isActive.mockReturnValue(false);

    await dispatch({ intent: 'end_session', data: {} }, {});

    expect(slackBot.postMessage).toHaveBeenCalledWith(
      expect.stringMatching(/no active.*session|no.*session to end/i)
    );
  });

  it('catches unhandled handler errors and posts them to Slack', async () => {
    // Temporarily make slackBot.postMessage throw to exercise the inner try/catch in dispatch
    // for unexpected errors in postError — we just verify postError is attempted on handler crash
    const err = new Error('Handler exploded');
    fs.promises.readFile.mockRejectedValue(err);
    // Make it not an ENOENT so postError is called
    err.code = 'CRASH';

    await dispatch({ intent: 'fetch_file', data: { filePath: 'x.js' } }, {});

    expect(slackBot.postError).toHaveBeenCalledWith('fetch_file', err);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCH_TABLE — completeness check
// ─────────────────────────────────────────────────────────────────────────────

describe('DISPATCH_TABLE — completeness', () => {
  const EXPECTED_INTENTS = [
    'fetch_file',
    'edit_code',
    'run_tests',
    'commit_code',
    'computer_use',
    'end_session',
    'unknown',
  ];

  it('contains exactly 7 intent keys', () => {
    expect(Object.keys(DISPATCH_TABLE)).toHaveLength(7);
  });

  it.each(EXPECTED_INTENTS)('maps "%s" to a function', (intent) => {
    expect(typeof DISPATCH_TABLE[intent]).toBe('function');
  });
});
