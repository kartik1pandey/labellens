# LabelLens — handoff brief for Claude Code

## What this is
LabelLens is a food-label scanning app built for **First Commit** (WeMakeDevs x AWS "Bharat Builds Tour" hackathon, Sept 17-20 2026, team "paradox"). A user photographs the back of a packaged food product; the app extracts ingredients, nutrition facts and the FSSAI license number, flags nutrients against WHO daily-limit guidance and ingredients against a curated additive/allergen list, checks the FSSAI number's format, and logs the scan to a running nutrition journal. Full problem statement, evidence, and reasoning are in `RESEARCH_NOTES.md`.

## Current state — read this before doing anything else
**Deployed and live** (day 4/4, Ship It track):
- Frontend: https://main.decx80vwxv0uu.amplifyapp.com (Amplify Hosting)
- `analyze` API: https://mfvl8cbrqg.execute-api.us-east-1.amazonaws.com/
- `journal` API: https://a8f4hrl4aj.execute-api.us-east-1.amazonaws.com/
- Model in use: `amazon.nova-pro-v1:0` (Claude models on this account are blocked by a separate "Anthropic model use case" form — see `deploy/DEPLOY.md` §1; Nova Pro works end-to-end today via the code's existing `tool_use` fallback)
- **Not Lambda Function URLs** — this account has a guardrail that 403s public Function URLs, so both Lambdas sit behind API Gateway (HTTP API) instead. See `deploy/DEPLOY.md` for the exact gotchas (API Gateway quick-create does NOT auto-grant itself invoke permission on the Lambda — has to be added manually).

Below is the original port description (still accurate for the code itself):
- `labellens.html` — same UX/visual design as the original prototype, byte-for-byte where possible. The two `window.claude.use(...)` call sites are replaced with `fetch()` calls to two Lambda Function URLs (`API.analyzeUrl` / `API.journalUrl`, overridable via `window.LABELLENS_ANALYZE_URL` / `window.LABELLENS_JOURNAL_URL`). Client-side image resize (canvas, ≤1600px, JPEG q0.7) was added before upload. A `localStorage` UUID stands in for a user id — no Cognito/login, matching the original no-signup design.
- `lambda/analyze/index.mjs` — Bedrock Converse call (native Structured Outputs, falls back to forced `tool_use` if the model isn't on the allowlist) + the exact deterministic FSSAI/nutrient/ingredient judgement logic ported verbatim from the old client-side JS. The AI only extracts; it never makes the judgement calls.
- `lambda/journal/index.mjs` — DynamoDB-backed log/list, same item shape (`ts` stays a numeric epoch-ms sort key) so the frontend's date math needed zero changes.
- `deploy/DEPLOY.md` — step-by-step `aws cli` runbook (IAM role, DynamoDB table, both Lambdas + Function URLs + CORS, frontend hosting via Amplify Hosting or S3, smoke-test curl commands) — **not yet run**, since this session has no AWS credentials. Someone with account access needs to run it, paste the two Function URLs into `labellens.html` (§6 of the runbook), and deploy the frontend.
- Full research findings (past-winner patterns, feature-gap analysis vs. reference repos, architecture tradeoffs, demo-video structure) are captured in the approved plan — see git history / ask for the plan file if it's not obvious from context.

## Next steps, in order
1. **Do one real end-to-end scan from a phone** against https://main.decx80vwxv0uu.amplifyapp.com — everything above is smoke-tested with synthetic payloads, not a real label photo yet.
2. **Layer in the cheap high-impact features** (plain-language "why" line per nutrient band; a dietary-profile toggle that re-highlights existing flags; citing the additive list's basis) — only if time remains, port + deploy already works without them.
3. **Push this to a public repo** and **record the 3-minute demo video** — architecture must be shown/narrated on screen, not just written in the README; verify the YouTube link plays signed-out before submitting.

## Reference projects (starting points — check these before building from scratch)
- **Strands Agents SDK** — https://github.com/strands-agents/sdk-python — the SDK itself; see the "Structured Output" example at https://strandsagents.com/docs/examples/ for the type-safe JSON pattern this app needs.
- **NutriCheck** — https://github.com/Vivek-2004/NutriCheck — Spring Boot + Gemini multimodal, ingredient safety categorization (Safe/Harmful/Needs Caution), closest architectural match.
- **OpenPharma** — https://github.com/Mister-Ritom/openPharm — React Native/Expo, barcode + OCR label scan, structured-output multimodal model, personalized health-condition ratings (diabetes/PCOS/heart) — good reference for the "stretch" personalization angle.
- **NutriScan** — https://github.com/syskey8/NutriScan — React + Tailwind, OCR + AI analysis with follow-up Q&A, multi-language support including Hindi/Marathi — relevant precedent for regional-language support, which LabelLens doesn't have yet.
- **BiteSmart** — https://github.com/clerisy47/BiteSmart — Kotlin Android + FastAPI, allergen/additive flagging, personalized recommendations by dietary profile.
- **tejas-label-ocr** — https://github.com/tpncoder/tejas-label-ocr — a small PyPI package specifically for structured nutrition-label extraction (brand, claims, nutrients with %RDA); useful for schema-design comparison even if not used directly.
- **FoodToxicityScanner** — https://github.com/NathanKolbas/FoodToxicityScanner — an actual prior hackathon's (Cornhacks 2020) version of a near-identical idea; useful as a "what a hackathon-scoped version looks like" comparison.

## Hard constraints, don't lose these
- Submission needs: a public repo, a demo video capped at 3 minutes, and a writeup covering the problem, the build, and where AWS fits — naming AWS isn't enough, the video has to show it.
- Tour rule: a project has to be built inside the event window (Sept 17-20) — starting from a pre-existing repo, even rewriting it, doesn't qualify.
- Keep the visual design system from `labellens.html` (deep bottle-green ink, sage paper, WHO-threshold traffic-light colors as the only accents, Fraunces + Archivo type) — that's already reviewed and intentional, don't regenerate it from scratch.
- Live FoSCoS registry verification is explicitly out of scope for the demo (CAPTCHA-protected government portal) — keep the local 14-digit format check as the real, working check, and keep "live registry lookup" labeled as roadmap, not faked.
