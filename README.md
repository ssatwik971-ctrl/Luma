# Lumo (Netlify + Puter.js + Netlify Identity)

## Pages
- `/` landing page · `/login` log in / sign up / forgot / reset · `/app` the chat app (redirects to `/login` when signed out) · `404.html`
- `/api/health` shows whether Identity and the database are reachable (no secrets). Open it first if login or sign-up fails.

## Architecture
- **AI**: Puter.js only, in the browser. Models: `openai/gpt-6-luna`, `openai/gpt-6-luna-pro` (`puter.ai.chat`, streaming, image input), `gemini-nano-banana-2.1` (Nano Banana 2.1; selectable 1K/2K/4K output) (`puter.ai.txt2img`). PDF, DOCX, PPTX and XLSX text extraction uses Puter Mistral OCR (`puter.ai.img2txt`). Users sign in to Puter and pay from their own credits. No AI keys anywhere. No model is ever substituted: failures show an error + Retry.
- **Auth**: Netlify Identity via `@netlify/identity` (server-side `signup/login/logout/getUser`, `requestPasswordRecovery`, `recoverPassword`). Identity sends the reset email itself.
- **Backend**: one Netlify Function `netlify/functions/api.mjs` (`/api/*`): conversations, messages, memories, settings, rate limiting. Every query is filtered by the Identity user id.
- **Database**: Netlify Database (`@netlify/database`). Tables are created on first request (`create table if not exists`).

## Environment variables
**None required.** (Database connection and Identity are provided by the Netlify platform; Puter needs no key.)

## Deploy
1. Push to GitHub, import the repo in Netlify (settings come from `netlify.toml`).
2. Project configuration > **Identity**: enable it, registration **Open**, and enable **autoconfirm** (Identity > Emails > Confirmation template) so sign-up logs users in immediately.
3. Data & Storage > **Database**: create the database (Netlify Database is documented as available on credit-based plans only).
4. Deploy, open the site, sign up, then press Send (Puter sign-in popup appears).
5. After first `npm install`, commit the lockfile so `latest` dependencies are pinned.

## Troubleshooting sign-up / login
- Site protection (password / Netlify login) must be **off** for production, otherwise every Identity request returns 401.
- Login page shows a yellow **Setup needed** banner: Identity is not enabled (or the database is unreachable). Fix it in Netlify, redeploy, reload.
- "Sign-ups are closed": set Identity registration to **Open**.
- "Please confirm your email": turn on **autoconfirm**, or click the link in the confirmation email.
- Real Identity errors are logged in Netlify Functions logs (`identity signup failed ...`, `identity login failed ...`).

## Known limits
- Document OCR supports PDF, DOCX, PPTX and XLSX up to 10 MB per file in the app. OCR is a separate Puter AI operation and may consume the user's Puter resources; scanned or unusually formatted documents may extract imperfectly. Extracted text is limited to 60,000 characters per file and 180,000 per message.
- Uploaded image bytes remain local to the device; same-device cached image inputs are restored when reopening a synced conversation. They are not uploaded to cloud history or available on other devices.
- Deep Research performs three focused web-search stages and a synthesis pass. Actual search availability and citations depend on Puter's model/tool access; users should verify important claims against linked primary sources.
- Usage dashboard values come from `puter.auth.getMonthlyUsage()`. Resource amounts are Puter's microcent units; the dashboard converts them to USD and does not forecast charges.
- Identity does not work under `netlify dev` (test on a deploy). Live end-to-end tests require the site's Netlify Identity and Database configuration.


## Advanced tools
- Deep Research uses Puter.js web search with GPT-6 Luna Pro to prepare source-linked reports. Availability depends on Puter's model/tool access.
- Artifact Studio generates standalone HTML/CSS/JS mini-apps and diagrams, with editable source and sandboxed live preview. Artifacts can be saved in conversations and downloaded.
- Voice uses browser speech recognition for dictation and hands-free turn-taking, plus speech synthesis for reading answers aloud. Browser/device support and microphone permission are required.
- Image generation uses Gemini Nano Banana 2.1 through Puter.js. Users can choose 1K, 2K, or 4K output; 2K is the default. Actual usage charges depend on the selected resolution and Puter's current provider pricing; each user pays through their own Puter account.

## Local-first conversation sync
- Chat turns are written immediately to the browser's IndexedDB store, so the conversation remains available locally without a database write for every message.
- Pending conversations are batch-synced after five minutes of inactivity, with a ten-minute maximum wait while the page remains active.
- The batch endpoint validates payload sizes and uses stable UUIDs with conflict-safe inserts, making retries idempotent.
- Failed syncs remain queued locally and retry later; opening the app or reconnecting to the internet resumes synchronization. A page-close sync is attempted, but browsers may terminate it, so the persistent queue is the recovery mechanism.
- The chat header reports whether changes are saved locally, syncing, or synced. AI requests still run immediately through Puter; only database persistence is deferred.
- Local browser storage is device/browser-specific and is not a substitute for cloud backup until the sync completes. Clear site data or using another browser/device can remove or hide unsynced local conversations.


## Phase 2 · Advanced AI chat (implemented; live device testing still required)
- **Smart model routing** can be enabled from the composer. It selects Luna Pro for prompts that look complex or long, and Luna for simpler prompts. Image generation remains on the selected image model.
- **Branch here** creates a separate conversation from the selected message; the original conversation remains unchanged.
- **Regenerate with another model** lets the latest assistant response be retried with Luna or Luna Pro.
- **Conversation folders** can be assigned from the folder icon in the sidebar. Folder metadata syncs with the conversation.
- **Memory deduplication** avoids inserting an exact case-insensitive duplicate memory.

Phase 2 features are implemented on the development branch. Browser and live-service testing is still required before production use.


**Cost-conscious design:** Multi-model Arena was removed because generating two answers to one prompt would consume two Puter model requests. Lumo now uses one selected/routed model request per response.


## Phase 2 · Remaining chat controls
- **Temporary chats** are held in the current page session only. Their messages are not written to IndexedDB, cloud history, or automatic memory extraction; closing or refreshing the page discards them.
- **Memory management** supports editing and deleting individual saved memories. Duplicate edits are rejected by the API.
- **Cost control:** Arena mode is removed. A normal response uses one selected/routed model request. Automatic memory extraction remains opt-in because it makes an additional model request.


## Phase 3 · Advanced AI and multimodal (implemented; live device testing still required)
- **Voice language selection:** choose English (India/US), Hindi, Bengali, Tamil, Telugu, Marathi or Urdu for browser speech recognition and speech synthesis. Actual language availability depends on the browser and installed voice packs.
- **Voice playback controls:** read the latest response aloud and stop playback/listening. Hands-free mode continues listening after the assistant finishes speaking; microphone permission and supported browser APIs are required.
- **Image continuity on the same device:** when a synced conversation is reopened, Lumo restores locally cached image inputs for that device. The image bytes are not uploaded to cloud history, so they are not available on other devices.
- **Arena remains removed:** Phase 3 does not add parallel model responses. Existing PDF/Office OCR and image generation continue to use the configured Puter.js services and may consume the user's Puter resources. Speech transcription passes the selected language's ISO base code to Puter; browser speech recognition and speech synthesis retain the full locale.


### Phase 3 · Audio and video input
- Audio files can be attached and explicitly transcribed with Puter.js `puter.ai.speech2txt()`. Transcription is user-triggered, not automatic; the transcript is inserted into the composer for review before sending. The transcription request uses Puter resources and may incur usage.
- Video files can be attached (up to 20 MB, one per message) and analyzed with the explicit **Gemini 2.5 Flash (video)** model option. Lumo never silently switches models; select that model before sending a video. Video analysis is one chat request, but video-capable model support and billing depend on Puter's current service availability. Images are capped at 5 MB for inline model input.
- Video File objects are retained in IndexedDB on the same device and restored when a synced conversation is reopened there; raw video bytes are never uploaded to cloud history and are unavailable on other devices. The app labels this device-only limitation in the chat.


## Phase 4 · Context intelligence
- Saved memories are ranked against the current prompt using lightweight local keyword matching, with a minimum relevance threshold. Up to eight relevant memories (3,000 characters total) are included; memory use can be switched off in Settings.
- Long chats send the most recent 20 messages plus up to six matching older messages, retaining adjacent user/assistant turns. A 28,000-character context budget trims older content for model requests; full conversation history remains saved.
- Retrieval is local and makes no additional Puter model call. It is a lightweight relevance heuristic, not semantic search, so it may miss paraphrases or subtle connections. Smart model routing scores task complexity and remembers its on/off preference. Automatic memory extraction remains separately opt-in and can use an additional Puter request.


## Phase 5 · Performance and database optimisation (in progress)
- Database startup checks for the message sync unique index before running the legacy duplicate cleanup, avoiding a repeated full-table cleanup scan on normal cold starts.
- Added user-scoped indexes for message history/export access and memory ordering.
- Batch sync now reconciles removed messages with one set-based database delete instead of one delete query per conversation.
- Data export groups messages in one pass rather than repeatedly filtering the full message list for each conversation.
- Source-integrity regression checks cover these optimisations. Full test-suite execution, live database verification, and performance measurements are still pending.
