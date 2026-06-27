# Chetan's Feature: Voice Enhancement (Whisper Upgrade)

## What This Is

The Remote Dev Assistant lets a developer call a phone number while AFK, and their laptop wakes up, opens Slack, and they control everything from their phone. Right now, the voice transcription during the call is handled by Twilio's basic built-in speech-to-text.

Your job is to upgrade that to OpenAI Whisper for higher quality transcription.

---

## Your Task (Task 11 in the project)

**This is non-blocking** — the core system works fine without your feature. Twilio's built-in transcription is the fallback. Your upgrade just makes it better.

### What to implement

In `routes/call.js`, find this comment (it's already there):

```javascript
// TODO: [WHISPER STUB] Replace Twilio built-in STT with OpenAI Whisper — Chetan's feature (non-blocking)
// Current: Twilio <Gather input="speech"> handles transcription
// Future: Stream audio to Whisper API, receive higher-quality transcription
```

Replace the Twilio `<Gather input="speech">` approach with an OpenAI Whisper integration:

1. **Record the call audio** — Use Twilio to record the call instead of using `<Gather>` for speech
2. **Send to Whisper** — When Twilio posts the recording URL to your webhook, download the audio and send it to the Whisper API
3. **Return transcription** — Pass the Whisper transcription text to the Intent Classifier (same as the current `SpeechResult` flow)

### API you'll need

```bash
npm install openai
```

```javascript
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Transcribe audio file
const transcription = await openai.audio.transcriptions.create({
  file: audioFileStream,
  model: 'whisper-1',
});
// transcription.text is your result
```

### Env variable to add to `.env.example`

```
OPENAI_API_KEY=your_openai_key_here
```

---

## What NOT to touch

- `server.js`
- Anything in `services/`
- Anything in `utils/`
- The Slack bot flow
- UiPath integration

Your change is **only in `routes/call.js`** and it must not break the fallback (if `OPENAI_API_KEY` is not set, fall back to Twilio's built-in transcription gracefully).

---

## How to test your change

1. Set `OPENAI_API_KEY` in `.env`
2. Call the Twilio number
3. Speak a command ("show me login.js")
4. Verify the transcription in the Slack thread is more accurate than before

---

## Resources

- [OpenAI Whisper API docs](https://platform.openai.com/docs/guides/speech-to-text)
- [Twilio recording webhooks](https://www.twilio.com/docs/voice/api/recording)
- Ask the main developer if you need the `.env` file or ngrok URL
