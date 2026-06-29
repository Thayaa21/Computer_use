/**
 * Unit tests for services/sessionManager.js
 * Requirements: 8.1, 8.2
 */

const { startSession, endSession, isActive } = require('./sessionManager');

// Reset module state between tests by re-requiring the module
// Since state is module-level, we need to manipulate it via the public API.
// We call endSession() in beforeEach to guarantee a clean slate.
beforeEach(() => {
  endSession();
});

describe('sessionManager', () => {
  describe('isActive()', () => {
    it('returns false initially (no active session)', () => {
      expect(isActive()).toBe(false);
    });

    it('returns true after startSession()', () => {
      startSession(null);
      expect(isActive()).toBe(true);
    });

    it('returns false after endSession()', () => {
      startSession(null);
      endSession();
      expect(isActive()).toBe(false);
    });
  });

  describe('startSession()', () => {
    it('marks session as active', () => {
      startSession();
      expect(isActive()).toBe(true);
    });

    it('stores a provided stopToken without calling it', () => {
      const stopToken = jest.fn();
      startSession(stopToken);
      expect(stopToken).not.toHaveBeenCalled();
      expect(isActive()).toBe(true);
    });

    it('accepts null as stopToken', () => {
      expect(() => startSession(null)).not.toThrow();
      expect(isActive()).toBe(true);
    });

    it('accepts no arguments (default null stopToken)', () => {
      expect(() => startSession()).not.toThrow();
      expect(isActive()).toBe(true);
    });
  });

  describe('endSession()', () => {
    it('sets active to false', () => {
      startSession(null);
      endSession();
      expect(isActive()).toBe(false);
    });

    it('calls stopToken() if one was stored', () => {
      const stopToken = jest.fn();
      startSession(stopToken);
      endSession();
      expect(stopToken).toHaveBeenCalledTimes(1);
    });

    it('does not throw when called with no active session (stopToken is null)', () => {
      expect(isActive()).toBe(false);
      expect(() => endSession()).not.toThrow();
    });

    it('clears the stopToken after calling it', () => {
      const stopToken = jest.fn();
      startSession(stopToken);
      endSession();
      // calling endSession again should not re-invoke the token
      endSession();
      expect(stopToken).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — repeated calls keep session inactive', () => {
      startSession(null);
      endSession();
      endSession();
      expect(isActive()).toBe(false);
    });
  });

  describe('session lifecycle', () => {
    it('supports start → end → start → end cycle', () => {
      startSession(null);
      expect(isActive()).toBe(true);
      endSession();
      expect(isActive()).toBe(false);

      const stopToken2 = jest.fn();
      startSession(stopToken2);
      expect(isActive()).toBe(true);
      endSession();
      expect(isActive()).toBe(false);
      expect(stopToken2).toHaveBeenCalledTimes(1);
    });

    it('replaces old stopToken when startSession is called again', () => {
      const first = jest.fn();
      const second = jest.fn();

      startSession(first);
      startSession(second); // overwrite without ending — re-start scenario
      endSession();

      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
    });
  });
});
