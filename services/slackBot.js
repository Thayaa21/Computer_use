/**
 * services/slackBot.js
 *
 * Slack Web API client for the GhostDev bot.
 * Sends messages, posts file contents, uploads images, and reports errors
 * to the configured Slack channel.
 *
 * Requirements: 3.2, 3.3, 7.4
 */

'use strict';

const path = require('path');
const { WebClient } = require('@slack/web-api');

// Initialise lazily so the module can be imported in tests without crashing
// when env vars are absent. The client is created on first use.
let _client = null;

/**
 * Returns the singleton WebClient, creating it on first access.
 * @returns {WebClient}
 */
function getClient() {
  if (!_client) {
    _client = new WebClient(process.env.SLACK_BOT_TOKEN);
  }
  return _client;
}

/** Channel all messages are sent to. */
function getChannel() {
  return process.env.SLACK_CHANNEL_ID;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Post a plain-text message to the Slack channel.
 *
 * @param {string} text - The message text.
 * @returns {Promise<void>}
 */
async function postMessage(text) {
  await getClient().chat.postMessage({
    channel: getChannel(),
    text,
  });
}

/**
 * Post file contents as a fenced code block.
 *
 * If the content exceeds 3000 characters the message will show only the first
 * 3000 characters followed by a metadata line:
 *   _Showing X of Y lines (truncated at 3000 chars)_
 *
 * The language hint for the fenced block is derived from the file extension.
 *
 * @param {string} filePath - Path (or name) of the file — used only to derive the extension.
 * @param {string} content  - The full file contents.
 * @returns {Promise<void>}
 *
 * Requirements: 3.2, 3.3
 */
async function postFile(filePath, content) {
  const ext = path.extname(filePath).slice(1) || 'text';
  const MAX_CHARS = 3000;

  let messageText;

  if (content.length > MAX_CHARS) {
    const totalLines = content.split('\n').length;
    const truncated = content.slice(0, MAX_CHARS);
    const shownLines = truncated.split('\n').length;

    messageText =
      `\`\`\`${ext}\n${truncated}\n\`\`\`` +
      `\n_Showing ${shownLines} of ${totalLines} lines (truncated at 3000 chars)_`;
  } else {
    messageText = `\`\`\`${ext}\n${content}\n\`\`\``;
  }

  await getClient().chat.postMessage({
    channel: getChannel(),
    text: messageText,
  });
}

/**
 * Upload a PNG image buffer as a file attachment to the Slack channel.
 *
 * @param {Buffer} buffer   - PNG image data.
 * @param {string} message  - Caption / initial comment for the uploaded file.
 * @returns {Promise<void>}
 *
 * Requirement: 7.4
 */
async function postImage(buffer, message) {
  await getClient().files.uploadV2({
    channel_id: getChannel(),
    file: buffer,
    filename: `screenshot-${Date.now()}.png`,
    title: message || 'Screenshot',
    initial_comment: message || '',
  });
}

/**
 * Upload any file (PDF, image, zip, etc.) to Slack by its path on disk.
 *
 * @param {string} filePath - Absolute path to the file on disk.
 * @param {string} [comment] - Optional message to accompany the file.
 * @returns {Promise<void>}
 */
async function postAnyFile(filePath, comment) {
  const fsSync = require('fs');
  const filename = require('path').basename(filePath);
  const fileBuffer = fsSync.readFileSync(filePath);

  await getClient().files.uploadV2({
    channel_id: getChannel(),
    file: fileBuffer,
    filename,
    title: filename,
    initial_comment: comment || `📎 ${filename}`,
  });
}

/**
 * Post an error message referencing the failing step and the error details.
 *
 * @param {string} step  - Name of the step/stage that failed (e.g. "Wake Flow").
 * @param {Error|string} err - The error that was caught.
 * @returns {Promise<void>}
 *
 * Requirement: 1.8 (via 7.4)
 */
async function postError(step, err) {
  const errMessage = err instanceof Error ? err.message : String(err);
  const text = `:x: *${step}* failed: ${errMessage}`;

  await getClient().chat.postMessage({
    channel: getChannel(),
    text,
  });
}

// ─── Test helpers (not part of public API) ───────────────────────────────────

/**
 * Replace the internal WebClient with a test double.
 * Call with no argument (or null) to clear the override.
 * @param {WebClient|null} client
 */
function _setClient(client) {
  _client = client;
}

module.exports = { postMessage, postFile, postImage, postAnyFile, postError, _setClient };
