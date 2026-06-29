'use strict';

/**
 * services/claudeChat.js — Intelligent Intent Classifier
 *
 * Uses GPT-4o mini for natural language understanding — much smarter than
 * rigid keyword matching. Understands context, infers file paths, handles
 * ambiguous commands.
 *
 * Falls back to Claude Haiku if OpenAI key is not set.
 */

require('dotenv').config();

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

const SYSTEM_PROMPT = `You are an intelligent assistant for a remote laptop control system called Remote Dev Assistant.
The developer is away from their laptop and controlling it via Slack.

The project directory contains: src/auth.js, src/utils.js, src/index.js, tests/auth.test.js, tests/utils.test.js, package.json

Classify the developer's message into exactly one intent and extract relevant data.

Intents:
- fetch_file: show/view/read a file. Extract "filePath" (infer the most likely path, e.g. "auth file" → "src/auth.js", "utils" → "src/utils.js")
- send_file: find and send a file from the Mac (Downloads, Desktop, etc). Extract "fileName" and "folderHint"
- edit_code: change/update/fix/modify code. Extract "filePath" (infer intelligently) and "instruction" (be specific about what to change)
- run_tests: run tests/specs/test suite
- commit_code: commit/save/push changes. Extract "commitMessage"
- take_screenshot: screenshot/capture/show screen
- open_app: open/launch an application. Extract "appName"  
- open_url: open a URL (just open, no screenshot). Extract "url"
- browse_url: go to a URL and show me / screenshot it. Extract "url"
- search_code: search/find/grep for text. Extract "query"
- computer_use: anything else requiring screen control. Extract "instruction"
- end_session: end/close/lock/done/finish session
- unknown: genuinely unclear

Be intelligent about file paths:
- "auth file", "login module", "auth.js" → "src/auth.js"
- "utils", "utilities", "helpers" → "src/utils.js"
- "index", "main file", "entry" → "src/index.js"
- "tests", "test file" → "tests/auth.test.js"

Be intelligent about edit instructions:
- "change timeout to 60" → look for SESSION_TIMEOUT and change it to 60
- "increase the timeout" → find timeout variable and increase it
- "fix the login function" → find and fix issues in the login function

Return ONLY a JSON object, no markdown, no explanation:
{ "intent": "<intent>", "data": { <relevant fields> } }`;

const FALLBACK = { intent: 'unknown', data: {} };

/**
 * Classify using GPT-4o mini (preferred) or Claude Haiku (fallback).
 */
async function classify(text) {
  // Try GPT-4o mini first if OpenAI key is available
  if (process.env.OPENAI_API_KEY) {
    try {
      return await classifyWithGPT(text);
    } catch (err) {
      console.error('[claudeChat] GPT classification failed, falling back to Haiku:', err.message);
    }
  }
  // Fallback to Claude Haiku
  return classifyWithHaiku(text);
}

async function classifyWithGPT(text) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error [${response.status}]: ${err}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned);

  const intent = VALID_INTENTS.includes(parsed.intent) ? parsed.intent : 'unknown';
  const intentData = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  return { intent, data: intentData };
}

async function classifyWithHaiku(text) {
  const Anthropic = require('@anthropic-ai/sdk');
  let client;
  try {
    client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  } catch (err) {
    console.error('[claudeChat] Failed to initialise Anthropic client:', err.message);
    return FALLBACK;
  }

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    });

    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);

    const intent = VALID_INTENTS.includes(parsed.intent) ? parsed.intent : 'unknown';
    const intentData = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
    return { intent, data: intentData };
  } catch (err) {
    console.error('[claudeChat] Classification error:', err.message);
    return FALLBACK;
  }
}

module.exports = { classify, VALID_INTENTS };
