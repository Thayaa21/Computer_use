'use strict';

/**
 * services/computerUse.js
 *
 * Computer Use Agent — Claude Sonnet 4.6 agentic loop.
 *
 * Implements a screenshot → Claude Sonnet 4.6 → action → execute loop
 * with a hard cap of MAX_ITERATIONS (20) per run. Exposes:
 *   - runLoop(instruction)  — start the agentic loop
 *   - stopLoop()            — request early termination
 *   - lockScreen()          — lock the OS screen via keyboard shortcut
 *
 * Requirements: 4.1, 4.2, 4.5, 7.1, 7.2, 7.3, 8.1, 8.2
 */

require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const screenshot = require('../utils/screenshot');
const mouseKeyboard = require('../utils/mouseKeyboard');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 10; // Balanced between cost and task completion

/** Claude Sonnet 4.6 model ID */
const MODEL_ID = 'claude-sonnet-4-5';

const SCREEN_WIDTH  = parseInt(process.env.SCREEN_WIDTH,  10) || 1920;
const SCREEN_HEIGHT = parseInt(process.env.SCREEN_HEIGHT, 10) || 1080;

// ---------------------------------------------------------------------------
// Module-level stop flag
// ---------------------------------------------------------------------------

let stopRequested = false;

/**
 * Request the currently-running loop to stop after the current iteration.
 * Idempotent — safe to call multiple times.
 */
function stopLoop() {
  stopRequested = true;
}

// ---------------------------------------------------------------------------
// Claude API helpers
// ---------------------------------------------------------------------------

/**
 * Build the initial user message for the first loop iteration.
 *
 * @param {string} instruction       Natural-language task instruction
 * @param {Buffer} screenshotBuffer  PNG screenshot buffer
 * @returns {object[]}  Array of message objects for the Anthropic API
 */
function buildInitialMessages(instruction, screenshotBuffer) {
  const screenshotBase64 = screenshotBuffer.toString('base64');
  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: instruction,
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: screenshotBase64,
          },
        },
      ],
    },
  ];
}

/**
 * Append a tool_result turn to the ongoing conversation so Claude can see
 * the result of the previous computer-use action (i.e. the new screenshot).
 *
 * @param {object[]} messages         Existing conversation array (mutated in place)
 * @param {string}   lastAssistantId  The tool_use block id from the assistant turn
 * @param {Buffer}   screenshotBuffer New PNG screenshot after executing the action
 */
function appendToolResult(messages, lastAssistantId, screenshotBuffer) {
  const screenshotBase64 = screenshotBuffer.toString('base64');
  messages.push({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: lastAssistantId,
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: screenshotBase64,
            },
          },
        ],
      },
    ],
  });
}

/**
 * Call Claude Sonnet 4.6 with the Computer Use tool enabled.
 *
 * @param {object[]} messages  Current conversation messages
 * @returns {Promise<object>}  Raw Anthropic API response
 */
async function callClaude(messages) {
  const client = new Anthropic.Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  return client.beta.messages.create({
    model: MODEL_ID,
    max_tokens: 4096,
    tools: [
      {
        type: 'computer_20250124',
        name: 'computer',
        display_width_px: SCREEN_WIDTH,
        display_height_px: SCREEN_HEIGHT,
      },
    ],
    messages,
    betas: ['computer-use-2025-01-24'],
  });
}

/**
 * Extract the first computer-use tool_use block from a Claude response.
 * Returns null if no tool_use block is present.
 *
 * @param {object} response  Anthropic API response object
 * @returns {{ id: string, action: object } | null}
 */
function extractToolUse(response) {
  for (const block of response.content) {
    if (block.type === 'tool_use') {
      return { id: block.id, action: block.input };
    }
  }
  return null;
}

/**
 * Extract the final text message from a Claude end_turn response.
 *
 * @param {object} response  Anthropic API response object
 * @returns {string | undefined}
 */
function extractFinalMessage(response) {
  for (const block of response.content) {
    if (block.type === 'text') {
      return block.text;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main agentic loop
// ---------------------------------------------------------------------------

/**
 * Run the Computer Use agentic loop for the given instruction.
 *
 * Loop flow (each iteration):
 *   1. Capture screenshot
 *   2. Send to Claude Sonnet 4.6 with the computer-use tool
 *   3a. If stop_reason === 'end_turn'  → task complete, return success
 *   3b. If stop_reason === 'tool_use'  → extract action, execute it, append tool_result, continue
 *   4. If iterations reach MAX_ITERATIONS (20) → return failure
 *
 * @param {string} instruction  Natural-language task description
 * @returns {Promise<AgentLoopResult>}
 *
 * @typedef {object} AgentLoopResult
 * @property {boolean}       success         True if Claude reported end_turn before iteration cap
 * @property {Buffer}        lastScreenshot  PNG screenshot from the final iteration
 * @property {number}        iterations      Total number of iterations executed (0–20)
 * @property {string}        [finalMessage]  Claude's final text message on success
 */
async function runLoop(instruction) {
  // Reset stop flag for a fresh run
  stopRequested = false;

  let iterations = 0;
  let lastScreenshot = null;
  let messages = null;

  while (iterations < MAX_ITERATIONS && !stopRequested) {
    // Step 1 — capture current screen state
    lastScreenshot = await screenshot.capture();

    if (iterations === 0) {
      // First iteration: build the initial message with instruction + screenshot
      messages = buildInitialMessages(instruction, lastScreenshot);
    } else {
      // Subsequent iterations: the tool_result was already appended at the end
      // of the previous iteration with the latest screenshot; nothing to add here.
    }

    // Step 2 — ask Claude what to do next
    const response = await callClaude(messages);

    // Always append the assistant turn to maintain conversation continuity
    messages.push({ role: 'assistant', content: response.content });

    // Step 3a — Claude is done
    if (response.stop_reason === 'end_turn') {
      return {
        success: true,
        lastScreenshot,
        iterations,
        finalMessage: extractFinalMessage(response),
      };
    }

    // Step 3b — Claude wants to use the computer tool
    if (response.stop_reason === 'tool_use') {
      const toolUse = extractToolUse(response);

      if (toolUse) {
        // Log action for debugging
        console.log('[CU] action:', JSON.stringify(toolUse.action));

        // The computer_20250124 tool uses { action: "...", ... } not { type: "...", ... }
        // Normalise to the format mouseKeyboard.execute expects
        const rawAction = toolUse.action;
        const normalised = {
          type: rawAction.action || rawAction.type,
          coordinate: rawAction.coordinate,
          text: rawAction.text,
          button: rawAction.button,
        };

        // Execute the action on the real system
        await mouseKeyboard.execute(normalised);

        // Capture a fresh screenshot after the action so Claude sees the result
        lastScreenshot = await screenshot.capture();

        // Append the tool_result with the post-action screenshot
        appendToolResult(messages, toolUse.id, lastScreenshot);
      }
    }

    iterations++;
  }

  // Exhausted iterations or stop was requested
  return {
    success: false,
    lastScreenshot,
    iterations,
  };
}

// ---------------------------------------------------------------------------
// Lock screen
// ---------------------------------------------------------------------------

/**
 * Lock the OS screen.
 *
 * macOS: Ctrl+Cmd+Q (the system "Lock Screen" keyboard shortcut).
 *
 * @returns {Promise<void>}
 */
async function lockScreen() {
  await mouseKeyboard.execute({ type: 'key', text: 'ctrl+cmd+q' });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { runLoop, stopLoop, lockScreen };
