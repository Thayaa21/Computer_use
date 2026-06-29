'use strict';

/**
 * services/router.js — Request Router
 *
 * Maps classified intents to service handler functions and dispatches
 * each inbound request to the appropriate handler, which sends a Slack
 * reply when finished (or on failure).
 *
 * Dispatch table covers all 7 intent values:
 *   fetch_file | edit_code | run_tests | commit_code
 *   computer_use | end_session | unknown
 *
 * Requirements: 2.2, 2.3, 3.1, 3.4, 4.3, 4.4, 5.3, 5.4, 5.5,
 *               6.3, 6.4, 7.4, 7.5, 8.1–8.4
 */

require('dotenv').config();

const fs             = require('fs').promises;
const path           = require('path');
const { exec }       = require('child_process');
const { promisify }  = require('util');

const execAsync      = promisify(exec);

const slackBot       = require('./slackBot');
const computerUse    = require('./computerUse');
const sessionManager = require('./sessionManager');
const maestro        = require('./maestro');

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getProjectDir() {
  return process.env.PROJECT_DIR || process.cwd();
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * fetch_file — Read a file from PROJECT_DIR and post it to Slack.
 *
 * Requirement 3.1: read the specified file from the project directory.
 * Requirement 3.4: if not found, reply with not-found + top-level listing.
 *
 * @param {{ filePath?: string }} data
 * @param {object} _context
 */
async function fetchFile(data, _context) {
  const filePath = data && data.filePath;

  if (!filePath) {
    await slackBot.postMessage(
      'Please specify a file path. Example: "show me src/index.js"'
    );
    return;
  }

  const absolutePath = path.join(getProjectDir(), filePath);

  try {
    const content = await fs.readFile(absolutePath, 'utf8');
    await slackBot.postFile(filePath, content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Requirement 3.4 — file not found → top-level listing
      let listing = '';
      try {
        const entries = await fs.readdir(getProjectDir(), { withFileTypes: true });
        listing = entries
          .map(e => (e.isDirectory() ? `${e.name}/` : e.name))
          .join('\n');
      } catch {
        listing = '(could not read project directory)';
      }

      await slackBot.postMessage(
        `:warning: File not found: \`${filePath}\`\n\n*Top-level project contents:*\n\`\`\`\n${listing}\n\`\`\``
      );
    } else {
      await slackBot.postError('fetch_file', err);
    }
  }
}

/**
 * edit_code — Read file, apply change with Claude Haiku, write back, open in VS Code.
 * Fast, reliable, zero CU cost. VS Code opens to show the result.
 */
async function editCode(data, _context) {
  const filePath    = (data && data.filePath)    || '';
  const instruction = (data && data.instruction) || '';

  if (!filePath || !instruction) {
    await slackBot.postMessage('Please specify the file and what to change. Example: "change the timeout in src/auth.js to 60"');
    return;
  }

  const absolutePath = path.join(getProjectDir(), filePath);
  let originalContent;

  try {
    originalContent = await fs.readFile(absolutePath, 'utf8');
  } catch (err) {
    await slackBot.postMessage(`:warning: Could not read \`${filePath}\`: ${err.message}`);
    return;
  }

  await slackBot.postMessage(`:pencil: Editing \`${path.basename(filePath)}\`...`);

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: `You are a code editor. Apply the requested change to the file content.
Return ONLY the complete updated file content — no explanation, no markdown fences, no commentary.
Preserve all existing formatting, indentation, and style.`,
      messages: [{ role: 'user', content: `File: ${filePath}\nInstruction: ${instruction}\nContent:\n${originalContent}` }]
    });

    const newContent = response.content.find(b => b.type === 'text')?.text || '';

    if (!newContent || newContent.trim() === originalContent.trim()) {
      await slackBot.postMessage(`:warning: No change was made to \`${filePath}\`. Try being more specific.`);
      return;
    }

    await fs.writeFile(absolutePath, newContent, 'utf8');

    // Open the edited file in VS Code so the audience sees it
    execAsync(`code ${JSON.stringify(absolutePath)}`).catch(() => {});

    await slackBot.postMessage(`:white_check_mark: *Edit complete* — \`${path.basename(filePath)}\`\n${instruction}`);

  } catch (err) {
    await slackBot.postError('edit_code', err);
  }
}

/**
 * run_tests — Trigger the UiPath test Robot job and post results.
 *
 * Requirement 5.3: post pass/fail counts + any failure messages.
 * Requirement 5.4: if job fails to start → post error.
 * Requirement 5.5: if job times out → notify developer.
 *
 * @param {object} _data
 * @param {object} _context
 */
async function runTests(_data, _context) {
  await slackBot.postMessage(':hourglass: Running tests...');
  try {
    const { stdout, stderr } = await execAsync('npm test', {
      cwd: getProjectDir(),
      timeout: 5 * 60 * 1000, // 5 min
    });
    const output = stdout || stderr || '(no output)';
    // Count basic pass/fail lines from Jest/Mocha output
    const passMatch = output.match(/(\d+)\s+passed/i);
    const failMatch = output.match(/(\d+)\s+failed/i);
    const passed = passMatch ? passMatch[1] : '?';
    const failed = failMatch ? failMatch[1] : '0';
    const emoji = failMatch ? ':x:' : ':white_check_mark:';
    await slackBot.postMessage(
      `${emoji} *Test Results*\n• Passed: ${passed}\n• Failed: ${failed}\n\`\`\`\n${output.slice(0, 2000)}\n\`\`\``
    );
  } catch (err) {
    // exec rejects on non-zero exit — still capture output
    const output = (err.stdout || err.stderr || err.message || '').slice(0, 2000);
    await slackBot.postMessage(`:x: Tests failed:\n\`\`\`\n${output}\n\`\`\``);
  }
}

/**
 * commit_code — Trigger the UiPath commit Robot job and post the result.
 *
 * Requirement 6.2: extract commit message from intent data, pass unchanged.
 * Requirement 6.3: on success → confirmation with commit hash + message.
 * Requirement 6.4: on failure → error with failure reason.
 *
 * @param {{ commitMessage?: string }} data
 * @param {object} _context
 */
async function commitCode(data, _context) {
  const commitMessage = (data && data.commitMessage) || 'chore: auto-commit via Remote Dev Assistant';
  const dir = getProjectDir();

  await slackBot.postMessage(`:hourglass: Committing: "${commitMessage}"...`);
  try {
    await execAsync('git add .', { cwd: dir });
    await execAsync(`git commit -m ${JSON.stringify(commitMessage)}`, { cwd: dir });
    const { stdout } = await execAsync('git push', { cwd: dir });
    // Extract commit hash from git output
    const hashMatch = (stdout || '').match(/[a-f0-9]{7,40}/);
    const commitHash = hashMatch ? hashMatch[0] : '(see git log)';
    await slackBot.postMessage(
      `:white_check_mark: *Committed!*\n• Hash: \`${commitHash}\`\n• Message: "${commitMessage}"`
    );
  } catch (err) {
    const output = (err.stdout || err.stderr || err.message || '').slice(0, 1000);
    await slackBot.postMessage(`:x: Commit failed:\n\`\`\`\n${output}\n\`\`\``);
  }
}

/**
 * computer_use — Run the Computer Use Agent with the developer's instruction.
 *
 * Requirement 7.4: on success → post final screenshot + completion message.
 * Requirement 7.5: on max-iteration failure → post screenshot + failure message.
 *
 * @param {{ instruction?: string }} data
 * @param {object} _context
 */
async function handleComputerUse(data, _context) {
  const instruction = (data && data.instruction) || '';

  if (!instruction) {
    await slackBot.postMessage(
      'Please provide a specific instruction. Example: "open the terminal and run npm install"'
    );
    return;
  }

  let result;
  try {
    result = await computerUse.runLoop(instruction);
  } catch (err) {
    await slackBot.postError('computer_use', err);
    return;
  }

  if (result.success) {
    // Requirement 7.4 — success: post screenshot + completion message
    const completionMessage = result.finalMessage || 'Task completed successfully.';
    if (result.lastScreenshot) {
      await slackBot.postImage(result.lastScreenshot, completionMessage);
    } else {
      await slackBot.postMessage(`:white_check_mark: ${completionMessage}`);
    }
  } else {
    // Requirement 7.5 — max iterations reached
    const failureMessage = `Task not completed after ${result.iterations} iterations.`;
    if (result.lastScreenshot) {
      await slackBot.postImage(result.lastScreenshot, failureMessage);
    } else {
      await slackBot.postMessage(`:x: ${failureMessage}`);
    }
  }
}

/**
 * end_session — Terminate the active session and lock the screen.
 *
 * Requirement 8.1: terminate any active Computer Use Agent loops.
 * Requirement 8.2: lock the laptop screen.
 * Requirement 8.3: post session-ended confirmation.
 * Requirement 8.4: if no active session → reply stating there is no session to end.
 *
 * @param {object} _data
 * @param {object} _context
 */
async function endSession(_data, _context) {
  if (!sessionManager.isActive()) {
    // Requirement 8.4
    await slackBot.postMessage('There is no active GhostDev session to end.');
    return;
  }

  // Requirement 8.1 — terminate any running Computer Use loops
  sessionManager.endSession();

  // Requirement 8.2 — lock the screen
  try {
    await computerUse.lockScreen();
  } catch (err) {
    console.error('[router] lockScreen error (non-fatal):', err.message);
  }

  // Requirement 8.3 — confirm session ended
  await slackBot.postMessage(
    ':lock: Session ended. The laptop screen has been locked.'
  );
}

/**
 * unknown — Reply with a clarification request.
 *
 * Requirement 2.3: if unknown intent → ask developer to clarify.
 *
 * @param {object} _data
 * @param {object} _context
 */
async function unknown(_data, _context) {
  await slackBot.postMessage(
    "I didn't understand that. Here's what you can ask:\n\n" +
    '• *Show a file* — "show me src/auth.js"\n' +
    '• *Edit code* — "change SESSION_TIMEOUT in src/auth.js to 60"\n' +
    '• *Search* — "search for login"\n' +
    '• *Send a file* — "send me report.pdf from Downloads"\n' +
    '• *Run tests* — "run the tests"\n' +
    '• *Commit* — "commit with message: fix bug"\n' +
    '• *Screenshot* — "take a screenshot"\n' +
    '• *Open app* — "open Slack"\n' +
    '• *Open URL* — "open https://github.com"\n' +
    '• *Screen control* — "open the terminal and type ls"\n' +
    '• *End session* — "end session"'
  );
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

/**
/**
 * take_screenshot — Capture screen and post to Slack. 1 API call, no loop.
 */
async function takeScreenshot(_data, _context) {
  await slackBot.postMessage(':camera: Taking screenshot...');
  try {
    const screenshotUtil = require('../utils/screenshot');
    const buffer = await screenshotUtil.capture();
    await slackBot.postImage(buffer, 'Current screen');
  } catch (err) {
    await slackBot.postError('take_screenshot', err);
  }
}

/**
 * open_app — Open a Mac application using AppleScript. Free — no CU needed.
 */
async function openApp(data, _context) {
  const appName = (data && data.appName) || '';
  if (!appName) {
    await slackBot.postMessage('Please specify the app name. Example: "open Slack"');
    return;
  }

  // Normalize common app name aliases
  const aliases = {
    'vscode': 'Visual Studio Code',
    'vs code': 'Visual Studio Code',
    'visual studio code': 'Visual Studio Code',
    'chrome': 'Google Chrome',
    'google chrome': 'Google Chrome',
    'terminal': 'Terminal',
    'finder': 'Finder',
    'slack': 'Slack',
    'safari': 'Safari',
    'notes': 'Notes',
    'xcode': 'Xcode',
  };
  const resolvedName = aliases[appName.toLowerCase()] || appName;

  try {
    // For VS Code, also open the project directory
    if (resolvedName === 'Visual Studio Code') {
      await execAsync(`code ${JSON.stringify(getProjectDir())}`);
      await slackBot.postMessage(`:white_check_mark: Opened *VS Code* with the project`);
      return;
    }
    await execAsync(`osascript -e 'tell application "${resolvedName}" to activate'`);
    await slackBot.postMessage(`:white_check_mark: Opened *${resolvedName}*`);
  } catch (err) {
    // Fallback: try using the `open` command with -a flag
    try {
      await execAsync(`open -a ${JSON.stringify(resolvedName)}`);
      await slackBot.postMessage(`:white_check_mark: Opened *${resolvedName}*`);
    } catch (err2) {
      await slackBot.postMessage(`:x: Could not open "${resolvedName}": ${err2.message}`);
    }
  }
}

/**
 * open_url — Open a URL in the default browser. Free — no CU needed.
 */
async function openUrl(data, _context) {
  const url = (data && data.url) || '';
  if (!url) {
    await slackBot.postMessage('Please specify a URL. Example: "open https://github.com"');
    return;
  }
  try {
    await execAsync(`open ${JSON.stringify(url)}`);
    await slackBot.postMessage(`:white_check_mark: Opened ${url}`);
  } catch (err) {
    await slackBot.postMessage(`:x: Could not open URL: ${err.message}`);
  }
}

/**
 * search_code — Search for text in the project using grep. Free — no CU needed.
 */
async function searchCode(data, _context) {
  const query       = (data && data.query)       || '';
  const filePattern = (data && data.filePattern) || '*';
  if (!query) {
    await slackBot.postMessage('Please specify what to search for. Example: "search for SESSION_TIMEOUT"');
    return;
  }
  await slackBot.postMessage(`:mag: Searching for \`${query}\`...`);
  try {
    const { stdout } = await execAsync(
      `grep -rn ${JSON.stringify(query)} ${JSON.stringify(getProjectDir())} --include=${JSON.stringify(filePattern)} 2>/dev/null | head -30`
    );
    const results = stdout.trim() || '(no matches found)';
    await slackBot.postMessage(`*Search results for* \`${query}\`:\n\`\`\`\n${results.slice(0, 2000)}\n\`\`\``);
  } catch (_err) {
    await slackBot.postMessage(`*Search results for* \`${query}\`:\n\`\`\`\n(no matches found)\n\`\`\``);
  }
}

/**
 * send_file — Use Computer Use to find a file anywhere on the Mac and upload it to Slack.
 *
 * The developer says "send me report.pdf from my Downloads" — Claude navigates
 * Finder/Spotlight to locate the file, then we read it and upload to Slack.
 *
 * @param {{ fileName?: string, folderHint?: string }} data
 * @param {object} _context
 */
async function sendFileViaComputerUse(data, _context) {
  const fileName   = (data && data.fileName)   || '';
  const folderHint = (data && data.folderHint) || '';

  if (!fileName) {
    await slackBot.postMessage('Please specify the file name. Example: "send me report.pdf from Downloads"');
    return;
  }

  await slackBot.postMessage(`:mag: Looking for \`${fileName}\`${folderHint ? ` in ${folderHint}` : ''} on your Mac...`);

  // Build the folder path to search
  const home = process.env.HOME || `/Users/${process.env.USER}`;
  const folderMap = {
    downloads: `${home}/Downloads`,
    desktop:   `${home}/Desktop`,
    documents: `${home}/Documents`,
    pictures:  `${home}/Pictures`,
    movies:    `${home}/Movies`,
    music:     `${home}/Music`,
  };

  // Determine search root
  const folderKey  = folderHint.toLowerCase().trim();
  const searchRoot = folderMap[folderKey] || (folderHint ? `${home}/${folderHint}` : home);

  try {
    // Use macOS find to locate the file
    const { stdout } = await execAsync(
      `find ${JSON.stringify(searchRoot)} -maxdepth 4 -iname ${JSON.stringify(fileName)} 2>/dev/null | head -5`
    );

    const matches = stdout.trim().split('\n').filter(Boolean);

    if (matches.length === 0) {
      await slackBot.postMessage(`:warning: Could not find \`${fileName}\` in ${folderHint || 'your home folder'}. Try specifying the folder, e.g. "send me report.pdf from Desktop".`);
      return;
    }

    const filePath = matches[0]; // use first match

    // For text/code files post inline; for everything else upload as attachment
    const ext = require('path').extname(filePath).slice(1).toLowerCase();
    const textExts = ['js','ts','py','rb','go','java','c','cpp','h','css','html','json','yml','yaml','md','txt','sh','env','xml','csv','log'];

    if (textExts.includes(ext)) {
      const content = require('fs').readFileSync(filePath, 'utf8');
      await slackBot.postFile(filePath, content);
    } else {
      await slackBot.postAnyFile(filePath, `📎 ${require('path').basename(filePath)} (from ${folderHint || 'Mac'})`);
    }

    if (matches.length > 1) {
      await slackBot.postMessage(`_Found ${matches.length} matches. Sent the first one: \`${filePath}\`_`);
    }

  } catch (err) {
    await slackBot.postError('send_file', err);
  }
}

/**
 * browse_url — Open a URL in Chrome using CU, take a screenshot, post to Slack.
 */
async function browseUrl(data, _context) {
  const url = (data && data.url) || '';
  if (!url) {
    await slackBot.postMessage('Please specify a URL. Example: "go to https://github.com and show me"');
    return;
  }

  await slackBot.postMessage(`:globe_with_meridians: Opening ${url}...`);
  await maestro.logEvent('browse_url', { url });

  // Open the URL using the shell (fastest, no CU needed for just opening)
  try {
    await execAsync(`open ${JSON.stringify(url)}`);
    await new Promise(r => setTimeout(r, 3000)); // wait for page to load
  } catch (_) {}

  // Take a screenshot and post it
  try {
    const screenshotUtil = require('../utils/screenshot');
    const buffer = await screenshotUtil.capture();
    await slackBot.postImage(buffer, `📸 ${url}`);
  } catch (err) {
    await slackBot.postError('browse_url', err);
  }
}

const DISPATCH_TABLE = {
  fetch_file:      fetchFile,
  send_file:       sendFileViaComputerUse,
  edit_code:       editCode,
  run_tests:       runTests,
  commit_code:     commitCode,
  take_screenshot: takeScreenshot,
  open_app:        openApp,
  open_url:        openUrl,
  browse_url:      browseUrl,
  search_code:     searchCode,
  computer_use:    handleComputerUse,
  end_session:     endSession,
  unknown:         unknown,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatch a classified intent to the appropriate handler.
 *
 * If the intent value is not in the dispatch table, falls back to `unknown`.
 *
 * @param {{ intent: string, data: object }} classifiedIntent
 * @param {object} context - Additional context from the event source (e.g. threadTs, channelId)
 * @returns {Promise<void>}
 */
async function dispatch(classifiedIntent, context) {
  const intentKey = classifiedIntent && classifiedIntent.intent;
  const data      = (classifiedIntent && classifiedIntent.data) || {};
  const handler   = DISPATCH_TABLE[intentKey] ?? DISPATCH_TABLE.unknown;

  // Log every command to Maestro for audit trail
  maestro.logEvent(intentKey, data).catch(() => {});

  try {
    await handler(data, context);
  } catch (err) {
    console.error(`[router] Unhandled error in handler for "${intentKey}":`, err.message);
    try {
      await slackBot.postError(`router (${intentKey})`, err);
    } catch (slackErr) {
      console.error('[router] Failed to post error to Slack:', slackErr.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  dispatch,
  // Handlers exported individually for unit testing (task 16.3)
  handlers: {
    fetchFile,
    editCode,
    runTests,
    commitCode,
    computerUse: handleComputerUse,
    endSession,
    unknown,
  },
  DISPATCH_TABLE,
};
