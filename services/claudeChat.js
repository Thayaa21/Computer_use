/**
 * services/claudeChat.js — Intent Classifier
 *
 * Uses Claude Haiku 4.5 to classify a developer's text message into one of
 * seven intents and extract relevant structured data.
 *
 * Requirements: 2.1, 2.4, 2.5
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const VALID_INTENTS = [
  'fetch_file',
  'send_file',
  'edit_code',
  'run_tests',
  'commit_code',
  'take_screenshot',
  'open_app',
  'open_url',
  'browse_url',
  'search_code',
  'computer_use',
  'end_session',
  'unknown',
];

const SYSTEM_PROMPT = `You are an intent classifier for a remote laptop control system.
Classify the following developer message into exactly one of these intents:
  fetch_file, send_file, edit_code, run_tests, commit_code, take_screenshot, open_app, open_url, browse_url, search_code, computer_use, end_session, unknown

Return a JSON object:
{ "intent": "<intent>", "data": { <extracted fields> } }

Rules:
- fetch_file: user wants to see contents of a code/text file from the project. Extract "filePath".
- send_file: user wants to find and send ANY file from their Mac. Extract "fileName" and "folderHint".
- edit_code: user wants to change code in a file. Extract "filePath" and "instruction".
- run_tests: user wants to run the test suite.
- commit_code: user wants to git commit. Extract "commitMessage".
- take_screenshot: user wants a screenshot of the current screen.
- open_app: user wants to open an application without a screenshot. Extract "appName".
- open_url: user wants to open a URL without seeing a screenshot. Extract "url".
- browse_url: user wants to open a URL AND see a screenshot of the page. Extract "url". Use when they say "show me", "what does it look like", "go to ... and show me".
- search_code: user wants to search for text in the project. Extract "query" and optionally "filePattern".
- computer_use: freeform screen control not covered above. Extract "instruction".
- end_session: user wants to end/close/lock the session.
- unknown: none of the above.

IMPORTANT: Return ONLY raw JSON. No markdown, no code fences, no explanation. Just the JSON object.`;

const FALLBACK = { intent: 'unknown', data: {} };

/**
 * Classify a developer message into an intent.
 *
 * @param {string} text - The raw message from the developer.
 * @returns {Promise<{ intent: string, data: object }>}
 */
async function classify(text) {
  let client;
  try {
    client = new Anthropic.Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  } catch (err) {
    console.error('[claudeChat] Failed to initialise Anthropic client:', err.message);
    return FALLBACK;
  }

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    });

    // Extract text content from the first content block
    const rawText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Strip markdown code fences if Claude wraps response in ```json ... ```
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    const parsed = JSON.parse(cleaned);

    // Validate that the returned intent is one of the 7 allowed values
    const intent = VALID_INTENTS.includes(parsed.intent) ? parsed.intent : 'unknown';
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};

    return { intent, data };
  } catch (err) {
    console.error('[claudeChat] Classification error:', err.message);
    return FALLBACK;
  }
}

module.exports = { classify, VALID_INTENTS };
