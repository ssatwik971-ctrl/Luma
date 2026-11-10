# Lumo (Netlify + Puter.js + Netlify Identity)

## Pages
- `/` landing page · `/login` log in / sign up / forgot / reset · `/app` the chat app (redirects to `/login` when signed out) · `404.html`
- `/api/health` shows whether Identity and the database are reachable (no secrets). Open it first if login or sign-up fails.

## Architecture
- **AI**: Puter.js only, in the browser. Models: `openai/gpt-6-luna`, `openai/gpt-6-luna-pro` (`puter.ai.chat`, streaming, image input), `gemini-nano-banana-2.1` (Nano Banana 2.1; selectable 1K/2K/4K output) (`puter.ai.txt2img`). Users sign in to Puter and pay from their own credits. No AI keys anywhere. No model is ever substituted: failures show an error + Retry.
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
PDF/Word upload unsupported. Uploaded images are analysed in-session; only filenames sync across devices. Identity does not work under `netlify dev` (test on a deploy). Not end-to-end tested.


## Advanced tools
- Deep Research uses Puter.js web search with GPT-6 Luna Pro to prepare source-linked reports. Availability depends on Puter's model/tool access.
- Artifact Studio generates standalone HTML/CSS/JS mini-apps and diagrams, with editable source and sandboxed live preview. Artifacts can be saved in conversations and downloaded.
- Voice uses browser speech recognition for dictation and hands-free turn-taking, plus speech synthesis for reading answers aloud. Browser/device support and microphone permission are required.
- Image generation uses Gemini Nano Banana 2.1 through Puter.js. Users can choose 1K, 2K, or 4K output; 2K is the default. Actual usage charges depend on the selected resolution and Puter's current provider pricing; each user pays through their own Puter account.
