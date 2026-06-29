'use strict';

/**
 * utils/screenshot.js
 *
 * Screenshot capture utility.
 * Wraps `screenshot-desktop` to capture the primary display as PNG
 * and return the image data as a Node.js Buffer.
 *
 * Requirements: 1.4, 7.2
 */

const screenshot = require('screenshot-desktop');

/**
 * Capture a PNG screenshot of the primary display.
 *
 * @returns {Promise<Buffer>} PNG image data as a Buffer
 */
async function capture() {
  return screenshot({ format: 'png' });
}

module.exports = { capture };
