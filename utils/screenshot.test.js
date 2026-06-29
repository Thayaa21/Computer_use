'use strict';

/**
 * Unit tests for utils/screenshot.js
 *
 * Tests mock `screenshot-desktop` to avoid requiring a real display.
 */

jest.mock('screenshot-desktop');

const screenshotDesktop = require('screenshot-desktop');
const { capture } = require('./screenshot');

describe('utils/screenshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return a Buffer containing PNG data', async () => {
    const fakeBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    screenshotDesktop.mockResolvedValue(fakeBuffer);

    const result = await capture();

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result).toBe(fakeBuffer);
  });

  it('should call screenshot-desktop with format "png"', async () => {
    screenshotDesktop.mockResolvedValue(Buffer.alloc(10));

    await capture();

    expect(screenshotDesktop).toHaveBeenCalledTimes(1);
    expect(screenshotDesktop).toHaveBeenCalledWith({ format: 'png' });
  });

  it('should propagate errors thrown by screenshot-desktop', async () => {
    const captureError = new Error('Display not available');
    screenshotDesktop.mockRejectedValue(captureError);

    await expect(capture()).rejects.toThrow('Display not available');
  });
});
