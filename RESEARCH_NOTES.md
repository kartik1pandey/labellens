# LabelLens — research notes and sources

## The problem, with evidence
- Feb 10, 2026: India's Supreme Court ordered FSSAI to act on front-of-pack warning labels after a public-interest petition linking excess sugar/fat/salt to diabetes, obesity, and cardiovascular disease.
- Aug 28, 2026: FSSAI's response, filed with the Court, proposes red hexagonal "HIGH SUGAR" / "HIGH FAT" / "HIGH SALT" warnings for packaged food, based on thresholds in the ICMR-National Institute of Nutrition's Dietary Guidelines for Indians, 2024.
  - Source: https://www.freepressjournal.in/business/fssai-proposes-red-front-pack-warnings-for-foods-high-in-fat-sugar-and-salt
  - Source: https://www.drishtiias.com/daily-updates/daily-news-analysis/fssai-proposes-front-of-pack-warning-labels-for-packaged-foods/print_manually
- Known gap in the proposal itself: Phase 1 only warns when a product is high in **two or more** of fat/sugar/salt — something dangerously high in sugar alone, unremarkable on fat and salt, gets no warning under the first phase. LabelLens flags on any single nutrient being high, closing this gap today, ahead of the regulation.
- Historically, Indian consumers have relied solely on back-of-pack nutrition tables, which public health experts and the Court have both said fail to communicate risk effectively. Source: https://www.ocacademy.in/blogs/front-of-pack-warning-labels-fssai-india

## FSSAI number verification
- FSSAI license numbers are 14 digits. Structure: digit 1 = registration status; digits 2-3 = state code; digits 4-5 = year of registration; digits 6-8 = number of enrolled units; digits 9-14 = license number. Source: https://www.setindiabiz.com/?p=1678
- Official verification is via **FoSCoS** (Food Safety Compliance System) — its FBO Search returns business name, address, license type, and active/expired/suspended status. Source: https://surepass.io/blog/how-to-check-fssai-license-number-real-or-fake/
- Fake/expired FSSAI numbers on packaging are a real, acknowledged problem — verification guides exist specifically because of this.
- **Constraint:** the FoSCoS portal is CAPTCHA-protected, so a published web page cannot reliably call it live. LabelLens does a local 14-digit format/structure check (real, deterministic) and marks live registry lookup as roadmap — this is an honest design choice, not a shortcut to hide.

## Nutrient flagging thresholds used
LabelLens flags per-serving nutrients against WHO daily-limit guidance (2000 kcal reference diet), since FSSAI's own exact regulatory per-serving cutoffs aren't finalized/public yet:
- Free sugars: WHO recommends under 10% of total energy intake → **50g/day** reference.
- Sodium: WHO recommends under 2000mg/day → **2000mg/day** reference.
- Saturated fat: WHO recommends under 10% of total energy intake → **22g/day** reference.
- LabelLens's own flagging bands (not an official regulatory scale): under 15% of the daily limit per serving = good, 15-30% = caution, over 30% = high. These bands are LabelLens's design choice — say so if asked, don't present them as official.

## Hackathon context
- Event: First Commit, stop one of WeMakeDevs' "Bharat Builds Tour" with AWS. Online Sept 17-20, 2026; optional in-person day Sept 19 in Bangalore.
- Tracks: Build It (open-source AWS stack — Strands, Cedar, SAM CLI/LocalStack, PartyRock, OpenSearch — no AWS account needed) and Ship It (deployed on AWS — Lambda, API Gateway, DynamoDB, S3, Bedrock, Amplify/App Runner, Cognito, EventBridge, Step Functions).
- Prizes: Ship It ₹2,00,000 + $3,000 AWS credits; Build It ₹1,50,000 + $2,000 AWS credits; Best UI ₹1,00,000 + $1,000 AWS credits; four runner-up teams get $1,000 AWS credits each; top 10 students from top projects get fast-tracked interviews with Amazon's university talent team.
- Judging weighs: idea & impact, built on AWS, learning, execution, and the demo video (capped at 3 minutes — no live demo, so the video is what's judged).
- Scope rule: a project begun before the hackathon opened doesn't qualify even if rewritten — only what's added during the event window is judged. Open-source libraries, frameworks, and boilerplate are fine to use.
- Team: "paradox" — Kartik Pandey and Anwita Chakraborty (2 of 4 seats).

## Reference projects found (existing prior art — see CLAUDE.md for the full list with notes)
Searched for open-source nutrition-label / ingredient-scanner projects to check LabelLens isn't reinventing an already-solved wheel and to find architecture patterns worth reusing: NutriCheck (Spring Boot + Gemini), OpenPharma (React Native + Gemini, personalized health ratings), NutriScan (React + OCR + follow-up Q&A, Hindi/Marathi support), BiteSmart (Kotlin + FastAPI, allergen flagging), tejas-label-ocr (PyPI structured-extraction package), FoodToxicityScanner (a 2020 hackathon's version of a similar idea).
