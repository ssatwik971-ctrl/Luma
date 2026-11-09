# Lumo (Netlify + Puter.js + Netlify Identity)

## Architecture
- **AI**: Puter.js only, in the browser. Models: `openai/gpt-6-luna`, `openai/gpt-6-luna-pro` (`puter.ai.chat`, streaming, image input), `openai/dall-e-3` (`puter.ai.txt2img`). Users sign in to Puter and pay from their own credits. No AI keys anywhere. No model is ever substituted: failures show an error + Retry.
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

## Known limits
PDF/Word upload unsupported. Uploaded images are analysed in-session; only filenames sync across devices. Identity does not work under `netlify dev` (test on a deploy). Not end-to-end tested.
