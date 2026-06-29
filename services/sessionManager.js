/**
 * services/sessionManager.js
 *
 * Tracks the active GhostDev session state.
 * Maintains a single shared state object:
 *   { active: boolean, stopToken: (() => void) | null }
 *
 * Requirements: 8.1, 8.2
 */

const state = {
  active: false,
  stopToken: null,
};

/**
 * Start a new session and store the cancellation token for any running loop.
 * @param {(() => void) | null} stopToken - Callback to cancel the active Computer Use loop.
 */
function startSession(stopToken = null) {
  state.active = true;
  state.stopToken = stopToken;
}

/**
 * End the current session.
 * Calls stopToken() if one is stored, then resets state.
 */
function endSession() {
  if (state.stopToken) {
    state.stopToken();
  }
  state.active = false;
  state.stopToken = null;
}

/**
 * Returns whether a session is currently active.
 * @returns {boolean}
 */
function isActive() {
  return state.active;
}

module.exports = { startSession, endSession, isActive };
