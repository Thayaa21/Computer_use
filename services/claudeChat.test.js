/**
 * Unit tests for services/claudeChat.js — Intent Classifier
 * Requirements: 2.1, 2.4, 2.5
 */

'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// We mock @anthropic-ai/sdk so no real API calls are made.
jest.mock('@anthropic-ai/sdk');

const Anthropic = require('@anthropic-ai/sdk');
const { classify, VALID_INTENTS } = require('./claudeChat');

/**
 * Helper: configure the mock to return a given JSON payload as the model response.
 */
function mockResponse(payload) {
  Anthropic.Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      }),
    },
  }));
}

/**
 * Helper: configure the mock to throw on messages.create.
 */
function mockApiError(message = 'Network error') {
  Anthropic.Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockRejectedValue(new Error(message)),
    },
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('claudeChat.classify()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  // ── Return shape ──────────────────────────────────────────────────────────

  describe('return shape', () => {
    it('always returns an object with "intent" and "data" keys', async () => {
      mockResponse({ intent: 'run_tests', data: {} });
      const result = await classify('run the tests');
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('data');
    });

    it('"intent" is always one of the 7 valid values on success', async () => {
      for (const intent of VALID_INTENTS) {
        mockResponse({ intent, data: {} });
        const result = await classify('some text');
        expect(VALID_INTENTS).toContain(result.intent);
      }
    });

    it('"data" is always a plain object', async () => {
      mockResponse({ intent: 'run_tests', data: {} });
      const result = await classify('run tests');
      expect(typeof result.data).toBe('object');
      expect(result.data).not.toBeNull();
    });
  });

  // ── Intent extraction ─────────────────────────────────────────────────────

  describe('intent extraction', () => {
    it('returns fetch_file intent with filePath', async () => {
      mockResponse({ intent: 'fetch_file', data: { filePath: 'src/index.js' } });
      const result = await classify('show me src/index.js');
      expect(result.intent).toBe('fetch_file');
      expect(result.data.filePath).toBe('src/index.js');
    });

    it('returns edit_code intent with filePath and instruction', async () => {
      mockResponse({
        intent: 'edit_code',
        data: { filePath: 'server.js', instruction: 'add error handling' },
      });
      const result = await classify('edit server.js to add error handling');
      expect(result.intent).toBe('edit_code');
      expect(result.data.filePath).toBe('server.js');
      expect(result.data.instruction).toBe('add error handling');
    });

    it('returns run_tests intent', async () => {
      mockResponse({ intent: 'run_tests', data: {} });
      const result = await classify('run the tests');
      expect(result.intent).toBe('run_tests');
    });

    it('returns commit_code intent with commitMessage', async () => {
      mockResponse({ intent: 'commit_code', data: { commitMessage: 'fix: login bug' } });
      const result = await classify('commit with message fix: login bug');
      expect(result.intent).toBe('commit_code');
      expect(result.data.commitMessage).toBe('fix: login bug');
    });

    it('returns computer_use intent with instruction', async () => {
      mockResponse({ intent: 'computer_use', data: { instruction: 'open the browser' } });
      const result = await classify('open the browser for me');
      expect(result.intent).toBe('computer_use');
      expect(result.data.instruction).toBe('open the browser');
    });

    it('returns end_session intent', async () => {
      mockResponse({ intent: 'end_session', data: {} });
      const result = await classify('end the session');
      expect(result.intent).toBe('end_session');
    });

    it('returns unknown intent for unrecognised messages', async () => {
      mockResponse({ intent: 'unknown', data: {} });
      const result = await classify('blah blah blah');
      expect(result.intent).toBe('unknown');
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns { intent: "unknown", data: {} } when the API throws', async () => {
      mockApiError('Service unavailable');
      const result = await classify('run tests');
      expect(result).toEqual({ intent: 'unknown', data: {} });
    });

    it('returns fallback when response contains invalid JSON', async () => {
      Anthropic.Anthropic.mockImplementation(() => ({
        messages: {
          create: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'NOT JSON' }],
          }),
        },
      }));
      const result = await classify('run tests');
      expect(result).toEqual({ intent: 'unknown', data: {} });
    });

    it('returns fallback when API key is missing and client throws', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      // Simulate constructor throwing for missing key
      Anthropic.Anthropic.mockImplementation(() => {
        throw new Error('Missing API key');
      });
      const result = await classify('run tests');
      expect(result).toEqual({ intent: 'unknown', data: {} });
    });

    it('coerces an unrecognised intent string to "unknown"', async () => {
      mockResponse({ intent: 'teleport', data: {} });
      const result = await classify('teleport me somewhere');
      expect(result.intent).toBe('unknown');
    });

    it('coerces a null data field to an empty object', async () => {
      mockResponse({ intent: 'run_tests', data: null });
      const result = await classify('run tests please');
      expect(result.data).toEqual({});
    });
  });

  // ── VALID_INTENTS export ──────────────────────────────────────────────────

  describe('VALID_INTENTS', () => {
    it('exports exactly 7 intent strings', () => {
      expect(VALID_INTENTS).toHaveLength(7);
    });

    it('contains all required intent values', () => {
      const expected = [
        'fetch_file',
        'edit_code',
        'run_tests',
        'commit_code',
        'computer_use',
        'end_session',
        'unknown',
      ];
      for (const intent of expected) {
        expect(VALID_INTENTS).toContain(intent);
      }
    });
  });
});
