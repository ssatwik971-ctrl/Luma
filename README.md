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
- Generated-image bytes are also kept in device-local IndexedDB. Cloud sync sends attachment metadata only, reducing database storage and repeated upload payloads; the generated image is restored on the same device when its conversation is reopened. Other devices see the attachment metadata, not the image bytes.
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
- Video files can be attached (up to 32 MiB, one per message) and analyzed with the explicit **Gemini 2.5 Flash (video)** model option. Lumo never silently switches models; select that model before sending a video. Video analysis is one chat request, but video-capable model support and billing depend on Puter's current service availability. Images are capped at 5 MB for inline model input.
- Video File objects are retained in IndexedDB on the same device and restored when a synced conversation is reopened there; raw video bytes are never uploaded to cloud history and are unavailable on other devices. The app labels this device-only limitation in the chat.


## Phase 4 · Context intelligence
- Saved memories are ranked locally using normalized terms, lightweight concept groups and phrase matching, improving recall across common paraphrases without an extra model request. Up to eight relevant memories (3,000 characters total) are included; memory use can be switched off in Settings. This is concept-aware lexical retrieval, not embedding-based semantic search.
- Long chats send the most recent 20 messages plus up to six matching older messages, retaining adjacent user/assistant turns. A 28,000-character context budget trims older content for model requests; full conversation history remains saved.
- Retrieval is local and makes no additional Puter model call. It is a lightweight relevance heuristic, not semantic search, so it may miss paraphrases or subtle connections. Smart model routing scores task complexity and remembers its on/off preference. Automatic memory extraction remains separately opt-in and can use an additional Puter request.


## Phase 5 · Performance and database optimisation (in progress)
- Database startup checks for the message sync unique index before running the legacy duplicate cleanup, avoiding a repeated full-table cleanup scan on normal cold starts.
- Added user-scoped indexes for message history/export access and memory ordering.
- Batch sync now reconciles removed messages with one set-based database delete instead of one delete query per conversation.
- Data export groups messages in one pass rather than repeatedly filtering the full message list for each conversation.
- Source-integrity regression checks cover these optimisations. Full test-suite execution, live database verification, and performance measurements are still pending.

- Conversation sidebar now uses bounded keyset pagination (50 chats per page, capped at 100) instead of fetching up to 200 records at once; a Load more control fetches subsequent pages.
- Search requests use request sequencing so slower old queries cannot overwrite newer results.

## Phase 6 — UI/UX polish (implementation complete; visual device testing pending)
- Improved responsive layouts for phone, tablet and desktop, including compact chat controls, safe-area spacing and scroll behavior.
- Added an accessible mobile navigation drawer with a dismissible backdrop, Escape-key support and expanded-state announcements.
- Added visible keyboard focus, disabled-control states and reduced-motion support.
- Refined message typography, Markdown lists/tables/code blocks, touch-friendly message actions, composer focus states and accessible model/composer labels.
- Improved settings and Artifact Studio dialog sizing, keyboard focus visibility and high-contrast preferences.
- Refined mobile Artifact Studio and settings dialogs for smaller screens.


## Phase 7 - Final verification (in progress)
- Added source-level regression checks for request-origin protection, user-scoped data access, rate limits, bounded sync/attachment payloads, pagination validation, deployment security headers, CI configuration and non-secret health diagnostics.
- Automated tests are configured in GitHub Actions on development-branch pushes and pull requests targeting main.
- Remaining before release: obtain a successful CI run, run the complete test suite in the CI environment, test Netlify Identity and Database on a deployed preview, exercise Puter chat/image/audio/video paths, verify local/cloud sync across browsers/devices, and complete responsive/accessibility and privacy/security checks.
- No production deployment or merge to main is authorized by this phase.


## Reliability fixes · November 2026
- Video attachment metadata now accepts the same 32 MiB ceiling as the browser upload control. Audio, image, generated-image and document limits remain separately bounded; both batch sync and direct message endpoints apply the same per-type validation.
- Voice dictation appends the finalized transcript after trimming it, preserving any text already in the composer.
- The application shell now loads dedicated `/app.css` and `/app.js` assets instead of keeping the full stylesheet and application script inline.
- The public landing page now describes Nano Banana 2.1, supported document OCR, audio/video input, Deep Research, Artifact Studio and Voice mode accurately.
- Source-integrity tests cover the modular assets, per-type attachment ceilings, local concept-aware memory retrieval and voice transcript handling.

## Sync data safety · November 2026
- Cloud sync is additive and chunked: long chats and large batches are split into requests that fit the server limits (50 messages per chat per request, 400 per request, about 900 KB), so they no longer fail permanently.
- A sync never deletes messages just because they are missing from the request. Only message ids the browser explicitly reports as removed (edit or regenerate) are deleted, so a stale device cannot erase messages added on another device.
- Sync stays batched (5–10 minutes) to limit database wake-ups. One extra flush runs when the page is hidden or closed (`keepalive`, at most once per minute, only if changes are pending).
- Chats created before this change have no recorded server message list; edits made to those before their next sync will not delete the old server copies of removed messages.

## Privacy, Artifact Studio and temporary chats · November 2026
- Local (offline) chats now live in a per-account IndexedDB database and are deleted from the device when you log out. If some chats have not synced yet, you are asked before logging out. Expired sessions keep the local data so it is not lost.
- One-time migration: the old shared local database (`lumo-local-v1`) is moved into the first account that logs in after this update, then deleted.
- Artifact Studio now saves artifacts through the same local-first store as normal messages (they sync with the chat). Artifacts over 60,000 characters are not saved to the chat; use Download HTML. In a temporary chat nothing is saved.
- Regenerate, Try Luna / Luna Pro and Edit now work in temporary chats.
- Generated images are not uploaded to the cloud (large data and database cost). The UI now says so, offers a Download button, and shows a clear placeholder on other devices.

## Small fixes · November 2026
- Memory retrieval: Hindi (Devanagari) words are now matched, and selected memories are separated by real newlines instead of a literal `\n`.
- Chat search also filters unsynced local chats by title and message text.
- Attaching PDF/DOCX/PPTX/XLSX signs in to Puter first, so OCR does not fail on a blocked popup.
- Streaming answers repaint at most every 100 ms (much less work on long replies).
- Voice mode keeps listening after silence and pauses itself after three empty attempts.
- The login page names Nano Banana 2.1 instead of GPT Image 2.

## Generated images in the cloud · November 2026
- Generated images are now saved to **Netlify Blobs** (store `lumo-images`, key `<user id>/<image id>`), not the database, so they do not add database load or wake-ups. The chat message stores only the image id; the image loads from `/api/images/:id` (login required, only your own images).
- Images are uploaded when they are generated (not in the 5–10 minute sync batch). The cloud copy is at most about 3 MB (large images are re-encoded to WebP); the full-quality original stays on the device that created it, with a Download button.
- Limits and cleanup: 300 images per account. Images are deleted when their chat, message (edit/regenerate) or all data is deleted. Temporary chats never upload.
- If Blobs is unavailable the image stays on that device and a notice says so. Chats created before this change keep their old device-only images.
- New dependency `@netlify/blobs`; run `npm install` and commit the lockfile to pin versions. No API key is needed on Netlify.

## Deep Research model check · November 2026
- Web search is documented by Puter only for OpenAI models, so Deep Research now shows a clear message (when toggled on and when sending) if the Gemini video model is selected, instead of failing unpredictably. No model is substituted automatically.
