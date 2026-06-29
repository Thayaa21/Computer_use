'use strict';

/**
 * Unit tests for utils/mouseKeyboard.js
 *
 * nut-js calls real OS APIs, so we mock the library to avoid
 * needing display access in CI.
 */

jest.mock('@nut-tree-fork/nut-js', () => {
  const Button = { LEFT: 0 };
  const Key = {
    LeftCmd: 107, LeftControl: 104, LeftAlt: 108, LeftShift: 87,
    LeftMeta: 109, Fn: 118,
    Return: 83, Enter: 103, Space: 116, Tab: 50,
    Backspace: 41, Delete: 64, Escape: 0, Home: 43, End: 65,
    PageUp: 44, PageDown: 66,
    Up: 99, Down: 120, Left: 119, Right: 121,
    A: 72, B: 92, C: 90, D: 74, E: 53, F: 75, G: 76, H: 77,
    I: 58, J: 78, K: 79, L: 80, M: 94, N: 93, O: 59, P: 60,
    Q: 51, R: 54, S: 73, T: 55, U: 57, V: 91, W: 52, X: 89,
    Y: 56, Z: 88,
    Num0: 38, Num1: 29, Num2: 30, Num3: 31, Num4: 32,
    Num5: 33, Num6: 34, Num7: 35, Num8: 36, Num9: 37,
    F1: 1, F2: 2, F3: 3, F4: 4, F5: 5, F6: 6,
    F7: 7, F8: 8, F9: 9, F10: 10, F11: 11, F12: 12,
  };

  const mouse = {
    setPosition: jest.fn().mockResolvedValue(undefined),
    leftClick:   jest.fn().mockResolvedValue(undefined),
    doubleClick: jest.fn().mockResolvedValue(undefined),
  };

  const keyboard = {
    type:        jest.fn().mockResolvedValue(undefined),
    pressKey:    jest.fn().mockResolvedValue(undefined),
    releaseKey:  jest.fn().mockResolvedValue(undefined),
  };

  return { mouse, keyboard, Button, Key, straightTo: jest.fn() };
});

const { mouse, keyboard, Button, Key } = require('@nut-tree-fork/nut-js');
const { execute } = require('./mouseKeyboard');

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// mouse_move
// ---------------------------------------------------------------------------
describe('mouse_move', () => {
  it('calls setPosition with the given coordinates', async () => {
    await execute({ type: 'mouse_move', coordinate: [100, 200] });
    expect(mouse.setPosition).toHaveBeenCalledWith({ x: 100, y: 200 });
    expect(mouse.leftClick).not.toHaveBeenCalled();
  });

  it('throws if coordinate is missing', async () => {
    await expect(execute({ type: 'mouse_move' })).rejects.toThrow('coordinate');
  });
});

// ---------------------------------------------------------------------------
// left_click
// ---------------------------------------------------------------------------
describe('left_click', () => {
  it('moves to the coordinate then left-clicks', async () => {
    await execute({ type: 'left_click', coordinate: [50, 75] });
    expect(mouse.setPosition).toHaveBeenCalledWith({ x: 50, y: 75 });
    expect(mouse.leftClick).toHaveBeenCalledTimes(1);
  });

  it('throws if coordinate is missing', async () => {
    await expect(execute({ type: 'left_click' })).rejects.toThrow('coordinate');
  });
});

// ---------------------------------------------------------------------------
// double_click
// ---------------------------------------------------------------------------
describe('double_click', () => {
  it('moves to the coordinate then double-clicks with LEFT button', async () => {
    await execute({ type: 'double_click', coordinate: [300, 400] });
    expect(mouse.setPosition).toHaveBeenCalledWith({ x: 300, y: 400 });
    expect(mouse.doubleClick).toHaveBeenCalledWith(Button.LEFT);
  });

  it('throws if coordinate is missing', async () => {
    await expect(execute({ type: 'double_click' })).rejects.toThrow('coordinate');
  });
});

// ---------------------------------------------------------------------------
// type
// ---------------------------------------------------------------------------
describe('type', () => {
  it('calls keyboard.type with the provided text', async () => {
    await execute({ type: 'type', text: 'Hello, world!' });
    expect(keyboard.type).toHaveBeenCalledWith('Hello, world!');
  });

  it('handles empty string', async () => {
    await execute({ type: 'type', text: '' });
    expect(keyboard.type).toHaveBeenCalledWith('');
  });

  it('throws if text is not a string', async () => {
    await expect(execute({ type: 'type', text: 42 })).rejects.toThrow('text string');
  });
});

// ---------------------------------------------------------------------------
// key — single key
// ---------------------------------------------------------------------------
describe('key — single key', () => {
  it('presses and releases "return"', async () => {
    await execute({ type: 'key', text: 'return' });
    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.Return);
    expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.Return);
  });

  it('presses and releases "space"', async () => {
    await execute({ type: 'key', text: 'space' });
    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.Space);
    expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.Space);
  });

  it('presses and releases a single letter "a"', async () => {
    await execute({ type: 'key', text: 'a' });
    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.A);
    expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.A);
  });
});

// ---------------------------------------------------------------------------
// key — combos
// ---------------------------------------------------------------------------
describe('key — combos', () => {
  it('handles "cmd+space"', async () => {
    await execute({ type: 'key', text: 'cmd+space' });
    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftCmd, Key.Space);
    expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftCmd, Key.Space);
  });

  it('handles "ctrl+s"', async () => {
    await execute({ type: 'key', text: 'ctrl+s' });
    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftControl, Key.S);
    expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftControl, Key.S);
  });

  it('handles "ctrl+shift+s" (three-key combo)', async () => {
    await execute({ type: 'key', text: 'ctrl+shift+s' });
    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftControl, Key.LeftShift, Key.S);
    expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftControl, Key.LeftShift, Key.S);
  });

  it('is case-insensitive for key names', async () => {
    await execute({ type: 'key', text: 'CMD+Space' });
    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftCmd, Key.Space);
  });
});

// ---------------------------------------------------------------------------
// error cases
// ---------------------------------------------------------------------------
describe('error handling', () => {
  it('throws for an unknown action type', async () => {
    await expect(execute({ type: 'scroll', coordinate: [0, 0] })).rejects.toThrow('Unknown action type');
  });

  it('throws for an unknown key token', async () => {
    await expect(execute({ type: 'key', text: 'superunknownkey' })).rejects.toThrow('Unknown key token');
  });

  it('throws when action is null', async () => {
    await expect(execute(null)).rejects.toThrow();
  });

  it('throws when action is not an object', async () => {
    await expect(execute('mouse_move')).rejects.toThrow();
  });

  it('throws for key action with missing text field', async () => {
    await expect(execute({ type: 'key' })).rejects.toThrow('text string');
  });
});
