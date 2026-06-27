# Remote Dev Assistant

## What We're Building

A system that lets a developer fix bugs and ship code without ever touching their laptop.

The developer is away from their desk. They call a phone number, describe the issue, and their laptop wakes up on its own — unlocks, scans the project, and opens Slack with a ready message. From that point, the developer controls everything through Slack on their phone: reading files, editing code, running tests, committing changes. The laptop does the work. The developer just gives instructions.

## The Problem We're Solving

When a developer is AFK, their options are limited — SSH requires setup, remote desktop is clunky on a phone, and most tools assume the machine is already awake and accessible. There's no natural, phone-first way to interact with a codebase remotely.

This system removes that friction entirely. The developer stays in Slack, uses plain language, and gets results back in seconds.

## Core Capabilities

- **Wake on call** — a phone call triggers the laptop to unlock and prepare a session automatically
- **Natural language control** — every Slack message is understood and routed to the right action
- **File access** — read any file in the project from Slack
- **Code editing** — describe a change in plain language, AI makes it in VS Code
- **Test execution** — run the test suite and get results posted to Slack
- **Git commits** — commit and push with a custom message, all from Slack
- **Session end** — one message locks the laptop and closes the session
