'use strict';

/**
 * utils/mouseKeyboard.js
 *
 * Mouse and keyboard simulation utility using @nut-tree-fork/nut-js.
 * Executes actions returned by the Claude Computer Use (Sonnet 4.6) agent.
 *
 * Supported action types:
 *   { type: 'mouse_move',   coordinate: [x, y] }
 *   { type: 'left_click',   coordinate: [x, y] }
 *   { type: 'double_click', coordinate: [x, y] }
 *   { type: 'type',         text: string }
 *   { type: 'key',          text: string }   // e.g. 'cmd+space', 'ctrl+s'
 *
 * Requirements: 4.2, 7.3
 */

const { mouse, keyboard, straightTo, Button, Key } = require('@nut-tree-fork/nut-js');

// ---------------------------------------------------------------------------
// Key name → Key enum mapping
// Supports common shorthand names used in the Anthropic Computer Use tool
// output (e.g. "cmd", "ctrl", "alt", "shift", "return", "space", "tab", …)
// ---------------------------------------------------------------------------
const KEY_MAP = {
  // Modifier aliases
  cmd:         Key.LeftCmd,
  command:     Key.LeftCmd,
  meta:        Key.LeftMeta,
  ctrl:        Key.LeftControl,
  control:     Key.LeftControl,
  alt:         Key.LeftAlt,
  option:      Key.LeftAlt,
  shift:       Key.LeftShift,
  fn:          Key.Fn,

  // Navigation / special
  return:      Key.Return,
  enter:       Key.Enter,
  space:       Key.Space,
  tab:         Key.Tab,
  backspace:   Key.Backspace,
  delete:      Key.Delete,
  escape:      Key.Escape,
  esc:         Key.Escape,
  home:        Key.Home,
  end:         Key.End,
  pageup:      Key.PageUp,
  pagedown:    Key.PageDown,
  up:          Key.Up,
  down:        Key.Down,
  left:        Key.Left,
  right:       Key.Right,
  insert:      Key.Insert,
  capslock:    Key.CapsLock,
  numlock:     Key.NumLock,
  scrolllock:  Key.ScrollLock,
  print:       Key.Print,
  pause:       Key.Pause,
  menu:        Key.Menu,
  clear:       Key.Clear,

  // Function keys
  f1:  Key.F1,  f2:  Key.F2,  f3:  Key.F3,  f4:  Key.F4,
  f5:  Key.F5,  f6:  Key.F6,  f7:  Key.F7,  f8:  Key.F8,
  f9:  Key.F9,  f10: Key.F10, f11: Key.F11, f12: Key.F12,

  // Audio
  audiomute:    Key.AudioMute,
  audiovoldown: Key.AudioVolDown,
  audiovolup:   Key.AudioVolUp,
  audioplay:    Key.AudioPlay,
  audiostop:    Key.AudioStop,
  audioprev:    Key.AudioPrev,
  audionext:    Key.AudioNext,

  // Alphanumeric (a–z)
  a: Key.A, b: Key.B, c: Key.C, d: Key.D, e: Key.E,
  f: Key.F, g: Key.G, h: Key.H, i: Key.I, j: Key.J,
  k: Key.K, l: Key.L, m: Key.M, n: Key.N, o: Key.O,
  p: Key.P, q: Key.Q, r: Key.R, s: Key.S, t: Key.T,
  u: Key.U, v: Key.V, w: Key.W, x: Key.X, y: Key.Y,
  z: Key.Z,

  // Digits
  '0': Key.Num0, '1': Key.Num1, '2': Key.Num2,
  '3': Key.Num3, '4': Key.Num4, '5': Key.Num5,
  '6': Key.Num6, '7': Key.Num7, '8': Key.Num8,
  '9': Key.Num9,

  // Punctuation / symbol keys
  grave:        Key.Grave,
  minus:        Key.Minus,
  equal:        Key.Equal,
  leftbracket:  Key.LeftBracket,
  rightbracket: Key.RightBracket,
  backslash:    Key.Backslash,
  semicolon:    Key.Semicolon,
  quote:        Key.Quote,
  comma:        Key.Comma,
  period:       Key.Period,
  slash:        Key.Slash,
};

/**
 * Resolve a single key token string to a Key enum value.
 * @param {string} token  e.g. "cmd", "s", "space", "f5"
 * @returns {Key}
 * @throws {Error} if the token cannot be resolved
 */
function resolveKey(token) {
  const normalised = token.trim().toLowerCase();
  const key = KEY_MAP[normalised];
  if (key === undefined) {
    throw new Error(`Unknown key token: "${token}". Add it to KEY_MAP in utils/mouseKeyboard.js`);
  }
  return key;
}

/**
 * Parse a key combo string like "cmd+space", "ctrl+shift+s", or just "return".
 * @param {string} combo  A '+'-separated list of key names
 * @returns {Key[]}  Ordered array of Key enum values (modifiers first)
 */
function parseKeyCombo(combo) {
  return combo.split('+').map(resolveKey);
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Move the mouse cursor to (x, y) instantly.
 * @param {[number, number]} coordinate
 */
async function mouseMoveAction([x, y]) {
  await mouse.setPosition({ x, y });
}

/**
 * Move the cursor to (x, y) then perform a left click.
 * @param {[number, number]} coordinate
 */
async function leftClickAction([x, y]) {
  await mouse.setPosition({ x, y });
  await mouse.leftClick();
}

/**
 * Move the cursor to (x, y) then perform a double click with the left button.
 * @param {[number, number]} coordinate
 */
async function doubleClickAction([x, y]) {
  await mouse.setPosition({ x, y });
  await mouse.doubleClick(Button.LEFT);
}

/**
 * Type a plain text string via the system keyboard.
 * @param {string} text
 */
async function typeAction(text) {
  await keyboard.type(text);
}

/**
 * Press (and release) a key or key combination such as "cmd+space" or "ctrl+s".
 * @param {string} combo  '+'-separated key names
 */
async function keyAction(combo) {
  const keys = parseKeyCombo(combo);
  await keyboard.pressKey(...keys);
  await keyboard.releaseKey(...keys);
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Execute a single Computer Use action.
 *
 * @param {object} action  Action object from Claude Computer Use tool output
 * @param {'mouse_move'|'left_click'|'double_click'|'type'|'key'} action.type
 * @param {[number, number]} [action.coordinate]  Required for mouse_move, left_click, double_click
 * @param {string}           [action.text]        Required for type and key actions
 * @returns {Promise<void>}
 * @throws {Error} for unknown action types or missing required fields
 */
async function execute(action) {
  if (!action || typeof action !== 'object') {
    throw new Error('execute() requires an action object');
  }

  switch (action.type) {
    case 'screenshot':
      // No-op — caller will capture a fresh screenshot after this
      break;

    case 'mouse_move':
      if (!Array.isArray(action.coordinate) || action.coordinate.length < 2) {
        throw new Error('mouse_move action requires a coordinate [x, y]');
      }
      await mouseMoveAction(action.coordinate);
      break;

    case 'left_click':
      if (!Array.isArray(action.coordinate) || action.coordinate.length < 2) {
        throw new Error('left_click action requires a coordinate [x, y]');
      }
      await leftClickAction(action.coordinate);
      break;

    case 'right_click':
      if (!Array.isArray(action.coordinate) || action.coordinate.length < 2) {
        throw new Error('right_click action requires a coordinate [x, y]');
      }
      await mouse.setPosition({ x: action.coordinate[0], y: action.coordinate[1] });
      await mouse.rightClick();
      break;

    case 'middle_click':
      if (!Array.isArray(action.coordinate) || action.coordinate.length < 2) {
        throw new Error('middle_click action requires a coordinate [x, y]');
      }
      await mouse.setPosition({ x: action.coordinate[0], y: action.coordinate[1] });
      await mouse.click(Button.MIDDLE);
      break;

    case 'double_click':
      if (!Array.isArray(action.coordinate) || action.coordinate.length < 2) {
        throw new Error('double_click action requires a coordinate [x, y]');
      }
      await doubleClickAction(action.coordinate);
      break;

    case 'type':
      if (typeof action.text !== 'string') {
        throw new Error('type action requires a text string');
      }
      await typeAction(action.text);
      break;

    case 'key':
      if (typeof action.text !== 'string') {
        throw new Error('key action requires a text string');
      }
      await keyAction(action.text);
      break;

    default:
      throw new Error(`Unknown action type: "${action.type}"`);
  }
}

module.exports = { execute };
