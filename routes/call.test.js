'use strict';

/**
 * Tests for routes/call.js — wakeFlow()
 *
 * Unit tests: verify wakeFlow() calls the correct sequence of services and
 * handles errors by posting to Slack and re-throwing.
 *
 * Property-based tests (fast-check):
 *
 *   Property 2: Ready Message Contains Snapshot Summary
 *   **Validates: Requirements 1.7**
 *   For any project snapshot string, the Slack ready message posted at session
 *   start SHALL contain that snapshot text.
 *
 *   Property 3: Error Message References Failing Step
 *   **Validates: Requirements 1.8**
 *   For any Wake Flow failure, the error message posted to Slack SHALL include
 *   the name of the step that failed.
 */

const fc = require('fast-check');

// ─── Mock all dependencies before requiring the module under test ─────────────

jest.mock('../services/computerUse');
jest.mock('../utils/screenshot');
jest.mock('../utils/projectSnapshot');
jest.mock('../services/slackBot');
jest.mock('../services/sessionManager');

const computerUse      = require('../services/computerUse');
const screenshot       = require('../utils/screenshot');
const projectSnapshot  = require('../utils/projectSnapshot');
const slackBot         = require('../services/slackBot');
const sessionManager   = require('../services/sessionManager');
const { wakeFlow }     = require('./call');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Reset all mocks to a default happy-path implementation before each test. */
function setupHappyPath(snapshotText = '*Project Snapshot:* `/project`\n```\nsrc/\n```') {
  computerUse.runLoop.mockResolvedValue({ success: true, iterations: 1, lastScreenshot: Buffer.from('') });
  computerUse.stopLoop.mockImplementation(() => {});
  screenshot.capture.mockResolvedValue(Buffer.from('png-data'));
  projectSnapshot.snapshot.mockResolvedValue(snapshotText);
  slackBot.postMessage.mockResolvedValue(undefined);
  slackBot.postError.mockResolvedValue(undefined);
  sessionManager.startSession.mockImplementation(() => {});
}

beforeEach(() => {
  jest.clearAllMocks();
  // Provide a default PROJECT_DIR so the module can call snapshot()
  process.env.PROJECT_DIR = '/project';
});

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('wakeFlow() — unit tests', () => {
  describe('happy path', () => {
    it('calls computerUse.runLoop twice (wake + open Slack) in the correct order', async () => {
      setupHappyPath();
      await wakeFlow();

      expect(computerUse.runLoop).toHaveBeenCalledTimes(2);
      // First call: wake laptop
      expect(computerUse.runLoop.mock.calls[0][0]).toMatch(/unlock|wake/i);
      // Second call: open Slack
      expect(computerUse.runLoop.mock.calls[1][0]).toMatch(/slack/i);
    });

    it('calls screenshot.capture() once after waking the laptop', async () => {
      setupHappyPath();
      await wakeFlow();
      expect(screenshot.capture).toHaveBeenCalledTimes(1);
    });

    it('calls projectSnapshot.snapshot() with process.env.PROJECT_DIR', async () => {
      setupHappyPath();
      process.env.PROJECT_DIR = '/my/project';
      await wakeFlow();
      expect(projectSnapshot.snapshot).toHaveBeenCalledWith('/my/project');
    });

    it('posts a ready message to Slack that contains the snapshot summary', async () => {
      const snap = '*Project Snapshot:* `/project`\n```\nindex.js\n```';
      setupHappyPath(snap);
      await wakeFlow();

      expect(slackBot.postMessage).toHaveBeenCalledTimes(1);
      const postedText = slackBot.postMessage.mock.calls[0][0];
      expect(postedText).toContain(snap);
    });

    it('posts a ready message that contains "GhostDev session ready"', async () => {
      setupHappyPath();
      await wakeFlow();

      const postedText = slackBot.postMessage.mock.calls[0][0];
      expect(postedText).toContain('GhostDev session ready');
    });

    it('calls sessionManager.startSession() with computerUse.stopLoop', async () => {
      setupHappyPath();
      await wakeFlow();

      expect(sessionManager.startSession).toHaveBeenCalledTimes(1);
      expect(sessionManager.startSession).toHaveBeenCalledWith(computerUse.stopLoop);
    });

    it('does not call slackBot.postError on success', async () => {
      setupHappyPath();
      await wakeFlow();
      expect(slackBot.postError).not.toHaveBeenCalled();
    });
  });

  describe('error handling — each step failure', () => {
    const STEP_ERRORS = [
      {
        label: 'Wake laptop',
        setup: () => {
          computerUse.runLoop
            .mockRejectedValueOnce(new Error('screen locked'))
            .mockResolvedValue({ success: true, iterations: 1, lastScreenshot: Buffer.from('') });
        },
      },
      {
        label: 'Capture screenshot',
        setup: () => {
          computerUse.runLoop.mockResolvedValue({ success: true, iterations: 1, lastScreenshot: Buffer.from('') });
          screenshot.capture.mockRejectedValueOnce(new Error('capture failed'));
        },
      },
      {
        label: 'Project snapshot',
        setup: () => {
          computerUse.runLoop.mockResolvedValue({ success: true, iterations: 1, lastScreenshot: Buffer.from('') });
          screenshot.capture.mockResolvedValue(Buffer.from(''));
          projectSnapshot.snapshot.mockRejectedValueOnce(new Error('dir not found'));
        },
      },
      {
        label: 'Open Slack',
        setup: () => {
          computerUse.runLoop
            .mockResolvedValueOnce({ success: true, iterations: 1, lastScreenshot: Buffer.from('') })
            .mockRejectedValueOnce(new Error('slack not installed'));
          screenshot.capture.mockResolvedValue(Buffer.from(''));
          projectSnapshot.snapshot.mockResolvedValue('snapshot text');
        },
      },
      {
        label: 'Post ready message',
        setup: () => {
          computerUse.runLoop.mockResolvedValue({ success: true, iterations: 1, lastScreenshot: Buffer.from('') });
          screenshot.capture.mockResolvedValue(Buffer.from(''));
          projectSnapshot.snapshot.mockResolvedValue('snapshot text');
          slackBot.postMessage.mockRejectedValueOnce(new Error('slack api error'));
        },
      },
      {
        label: 'Start session',
        setup: () => {
          computerUse.runLoop.mockResolvedValue({ success: true, iterations: 1, lastScreenshot: Buffer.from('') });
          screenshot.capture.mockResolvedValue(Buffer.from(''));
          projectSnapshot.snapshot.mockResolvedValue('snapshot text');
          slackBot.postMessage.mockResolvedValue(undefined);
          sessionManager.startSession.mockImplementationOnce(() => { throw new Error('session error'); });
        },
      },
    ];

    for (const { label, setup } of STEP_ERRORS) {
      it(`calls slackBot.postError with step name "${label}" on failure and re-throws`, async () => {
        slackBot.postError.mockResolvedValue(undefined);
        setup();

        await expect(wakeFlow()).rejects.toThrow();

        expect(slackBot.postError).toHaveBeenCalledTimes(1);
        const [stepArg] = slackBot.postError.mock.calls[0];
        expect(stepArg).toBe(label);
      });
    }
  });
});

// ─── Property-based tests ─────────────────────────────────────────────────────

describe('wakeFlow() — property-based tests', () => {
  /**
   * Property 2: Ready Message Contains Snapshot Summary
   * Validates: Requirements 1.7
   *
   * For any non-empty snapshot string, the Slack ready message SHALL contain
   * that snapshot text verbatim.
   */
  it('P2: ready message always contains the snapshot summary for any snapshot string', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a non-empty snapshot string (representing any possible snapshot output)
        fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
        async (snapshotText) => {
          jest.clearAllMocks();

          // Set up all mocks for happy path
          computerUse.runLoop.mockResolvedValue({
            success: true, iterations: 1, lastScreenshot: Buffer.from(''),
          });
          computerUse.stopLoop.mockImplementation(() => {});
          screenshot.capture.mockResolvedValue(Buffer.from(''));
          projectSnapshot.snapshot.mockResolvedValue(snapshotText);
          slackBot.postMessage.mockResolvedValue(undefined);
          slackBot.postError.mockResolvedValue(undefined);
          sessionManager.startSession.mockImplementation(() => {});

          await wakeFlow();

          // The message passed to slackBot.postMessage must include the snapshot
          const postedMessage = slackBot.postMessage.mock.calls[0][0];
          return postedMessage.includes(snapshotText);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Error Message References Failing Step
   * Validates: Requirements 1.8
   *
   * When Wake Flow fails at any step, slackBot.postError is called with the
   * exact step name used internally for that step.
   */
  it('P3: error step name always matches the canonical step name when a step fails', async () => {
    const STEP_NAMES = [
      'Wake laptop',
      'Capture screenshot',
      'Project snapshot',
      'Open Slack',
      'Post ready message',
      'Start session',
    ];

    await fc.assert(
      fc.asyncProperty(
        // Pick a step index and a random error message
        fc.integer({ min: 0, max: STEP_NAMES.length - 1 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        async (stepIndex, errorMessage) => {
          jest.clearAllMocks();
          slackBot.postError.mockResolvedValue(undefined);

          // Default happy-path mocks
          computerUse.runLoop.mockResolvedValue({
            success: true, iterations: 1, lastScreenshot: Buffer.from(''),
          });
          computerUse.stopLoop.mockImplementation(() => {});
          screenshot.capture.mockResolvedValue(Buffer.from(''));
          projectSnapshot.snapshot.mockResolvedValue('snapshot');
          slackBot.postMessage.mockResolvedValue(undefined);
          sessionManager.startSession.mockImplementation(() => {});

          const injectedError = new Error(errorMessage);

          // Inject failure at the selected step
          if (stepIndex === 0) {
            // Wake laptop — first call to computerUse.runLoop
            computerUse.runLoop.mockRejectedValueOnce(injectedError);
          } else if (stepIndex === 1) {
            // Capture screenshot
            screenshot.capture.mockRejectedValueOnce(injectedError);
          } else if (stepIndex === 2) {
            // Project snapshot
            projectSnapshot.snapshot.mockRejectedValueOnce(injectedError);
          } else if (stepIndex === 3) {
            // Open Slack — second call to computerUse.runLoop
            computerUse.runLoop
              .mockResolvedValueOnce({ success: true, iterations: 1, lastScreenshot: Buffer.from('') })
              .mockRejectedValueOnce(injectedError);
          } else if (stepIndex === 4) {
            // Post ready message
            slackBot.postMessage.mockRejectedValueOnce(injectedError);
          } else {
            // Start session
            sessionManager.startSession.mockImplementationOnce(() => { throw injectedError; });
          }

          try {
            await wakeFlow();
            // Should have thrown — if it didn't, the test setup is wrong
            return false;
          } catch (_) {
            // Verify slackBot.postError was called with the correct step name
            if (slackBot.postError.mock.calls.length !== 1) return false;
            const [stepArg, errArg] = slackBot.postError.mock.calls[0];
            return stepArg === STEP_NAMES[stepIndex] && errArg === injectedError;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
