# LabelLens — AWS deploy runbook

Run these yourself in a terminal where your AWS credentials are already configured
(`aws sts get-caller-identity` should work before you start). Commands are written for
bash/git-bash; on plain PowerShell the `aws` calls are identical, just swap `\` line
continuations for `` ` `` and quote JSON file paths with `--cli-input-json file://...`
the same way.

## 0. Variables

```bash
export REGION="us-east-1"                     # region with Bedrock model access
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export MODEL_ID="amazon.nova-pro-v1:0"        # confirmed working end-to-end, see §1
export TABLE_NAME="labellens-scans"
export ROLE_NAME="labellens-lambda-role"
export CORS_ORIGIN="*"    # tighten to your S3/Amplify URL once you have it
```

## 1. Go/no-go: confirm Bedrock model access + structured-output support

**Already checked for this account/region — result: use `amazon.nova-pro-v1:0`.**

- Anthropic Claude models (Sonnet 4.5, Sonnet 4, etc.) show up in `list-foundation-models`
  and even in `list-inference-profiles`, but every actual invoke failed with
  `ResourceNotFoundException: Model use case details have not been submitted for this
  account`. This is a separate, additional gate from model access: Bedrock console →
  **Model access** → find the Anthropic use-case form and submit it (a few short
  questions), then retry after ~15 minutes. Not needed today, but worth doing in parallel
  if you want to try Claude's native Structured Outputs later (better OCR quality on messy
  label photos, generally).
- `amazon.nova-pro-v1:0` **works right now** — verified a full image-in/schema-JSON-out
  round trip via the `tool_use` fallback path (Nova doesn't support the native
  `outputConfig` Structured Outputs field; the Lambda already tries that first and falls
  back automatically, so no code change was needed).
- If you want to re-verify yourself or check a different model, run:
  ```bash
  aws bedrock list-foundation-models --region $REGION \
    --query "modelSummaries[?modelId=='$MODEL_ID']"
  ```
  Note this only confirms the model is *listed*, not that it's *invokable* — the
  use-case-form gate above only shows up on an actual `Converse` call, not in this list.

## 2. IAM role for both Lambdas

```bash
aws iam create-role --role-name $ROLE_NAME \
  --assume-role-policy-document file://trust-policy.json

aws iam put-role-policy --role-name $ROLE_NAME \
  --policy-name labellens-permissions \
  --policy-document file://permissions-policy.json

export ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"
sleep 10   # IAM role propagation lag before the first create-function call
```

## 3. DynamoDB table

```bash
aws dynamodb create-table \
  --table-name $TABLE_NAME \
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=ts,AttributeType=N \
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=ts,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION
```

## Deployed for this account — actual results

Everything below §1 was run against account `730335213933`. Two real gotchas came up that
aren't obvious from AWS's own docs, recorded here so no one re-discovers them under time
pressure:

1. **Lambda Function URLs (`AuthType: NONE`, public principal `*`) return `403
   Forbidden`/`AccessDeniedException` on this account even with the exact resource policy
   AWS's own docs show.** This is consistent with an account/org-level guardrail blocking
   public Function URLs (common on Control-Tower-managed or org-vended accounts) — there's
   nothing to fix in the Lambda config itself. **Workaround: use API Gateway (HTTP API)
   in front of the same Lambda instead** — that guardrail doesn't touch API Gateway.
2. **`aws apigatewayv2 create-api --target <lambda-arn>` ("quick create") does NOT add the
   resource-based permission letting API Gateway invoke the Lambda**, despite appearing to
   fully wire the integration + route. Without it, every request 500s with a generic
   `{"message":"Internal Server Error"}` and *zero* CloudWatch log groups get created (the
   invocation never reaches the function). You must add it manually — see below.

Live resources:
- `analyze` API: `https://mfvl8cbrqg.execute-api.us-east-1.amazonaws.com/`
- `journal` API: `https://a8f4hrl4aj.execute-api.us-east-1.amazonaws.com/`
- Frontend (Amplify Hosting): `https://main.decx80vwxv0uu.amplifyapp.com`
- DynamoDB table: `labellens-scans` (us-east-1)
- Model: `amazon.nova-pro-v1:0` (see §1 above for why not Claude)

### Actual commands used (API Gateway instead of Function URLs)

```bash
# per Lambda, instead of create-function-url-config:
aws apigatewayv2 create-api --name labellens-analyze-api --protocol-type HTTP \
  --target "arn:aws:lambda:$REGION:$ACCOUNT_ID:function:labellens-analyze" --region $REGION
# ^ prints ApiId and ApiEndpoint - save both

# REQUIRED, not automatic - the step that's easy to miss:
aws lambda add-permission \
  --function-name labellens-analyze \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:<ApiId>/*/*" \
  --region $REGION
```

Repeat both for `labellens-journal`. The Lambda code's own OPTIONS handling + CORS
headers (already in `index.mjs`) work fine through this catch-all `$default` route — no
separate API Gateway CORS config needed, verified with a real preflight request.

### Frontend deploy actually used (Amplify Hosting, CLI, no console)

```bash
aws amplify create-app --name labellens --region $REGION
# -> save appId
aws amplify create-branch --app-id $APP_ID --branch-name main --region $REGION
aws amplify create-deployment --app-id $APP_ID --branch-name main --region $REGION
# -> save jobId and zipUploadUrl

# zip must contain index.html at its root (Amplify's default document), not labellens.html
cp labellens.html /path/to/deploy/index.html
(cd /path/to/deploy && zip -q site.zip index.html)
curl -X PUT --upload-file /path/to/deploy/site.zip "$zipUploadUrl"

aws amplify start-deployment --app-id $APP_ID --branch-name main --job-id $jobId --region $REGION
# poll: aws amplify get-job --app-id $APP_ID --branch-name main --job-id $jobId --region $REGION
```

Live URL pattern: `https://<branch>.<appId>.amplifyapp.com`.

## 4. `analyze` Lambda

```bash
cd ../lambda/analyze
npm install --omit=dev
zip -r ../../deploy/analyze.zip . -x "*.git*"
cd ../../deploy

aws lambda create-function \
  --function-name labellens-analyze \
  --runtime nodejs20.x \
  --role $ROLE_ARN \
  --handler index.handler \
  --timeout 30 \
  --memory-size 512 \
  --zip-file fileb://analyze.zip \
  --environment "Variables={BEDROCK_MODEL_ID=$MODEL_ID,CORS_ORIGIN=$CORS_ORIGIN}" \
  --region $REGION

aws lambda create-function-url-config \
  --function-name labellens-analyze \
  --auth-type NONE \
  --cors '{"AllowOrigins":["*"],"AllowMethods":["POST"],"AllowHeaders":["content-type"]}' \
  --region $REGION

aws lambda add-permission \
  --function-name labellens-analyze \
  --action lambda:InvokeFunctionUrl \
  --statement-id public-invoke \
  --principal "*" \
  --function-url-auth-type NONE \
  --region $REGION

aws lambda get-function-url-config --function-name labellens-analyze --region $REGION \
  --query FunctionUrl --output text
```

Save that URL — it's `LABELLENS_ANALYZE_URL`.

## 5. `journal` Lambda

```bash
cd ../lambda/journal
npm install --omit=dev
zip -r ../../deploy/journal.zip . -x "*.git*"
cd ../../deploy

aws lambda create-function \
  --function-name labellens-journal \
  --runtime nodejs20.x \
  --role $ROLE_ARN \
  --handler index.handler \
  --timeout 15 \
  --memory-size 256 \
  --zip-file fileb://journal.zip \
  --environment "Variables={TABLE_NAME=$TABLE_NAME,CORS_ORIGIN=$CORS_ORIGIN}" \
  --region $REGION

aws lambda create-function-url-config \
  --function-name labellens-journal \
  --auth-type NONE \
  --cors '{"AllowOrigins":["*"],"AllowMethods":["POST"],"AllowHeaders":["content-type"]}' \
  --region $REGION

aws lambda add-permission \
  --function-name labellens-journal \
  --action lambda:InvokeFunctionUrl \
  --statement-id public-invoke \
  --principal "*" \
  --function-url-auth-type NONE \
  --region $REGION

aws lambda get-function-url-config --function-name labellens-journal --region $REGION \
  --query FunctionUrl --output text
```

Save that URL — it's `LABELLENS_JOURNAL_URL`.

## 6. Wire the URLs into the frontend

Open `labellens.html` and either:
- Replace the two placeholder strings directly in the `API` object (`REPLACE_WITH_ANALYZE_FUNCTION_URL` / `REPLACE_WITH_JOURNAL_FUNCTION_URL`), or
- Add this right before the `<script>` tag so you never touch the app code again on redeploy:
  ```html
  <script>
    window.LABELLENS_ANALYZE_URL = 'https://xxxx.lambda-url.us-east-1.on.aws/';
    window.LABELLENS_JOURNAL_URL = 'https://yyyy.lambda-url.us-east-1.on.aws/';
  </script>
  ```

## 7. Host the frontend

Fastest path: **Amplify Hosting console → "Deploy without Git" → drag and drop `labellens.html`.**
That's a few clicks and gives you HTTPS + a CDN URL immediately — no CLI needed for a
single static file. Once you have that URL, come back and set `CORS_ORIGIN` on both
Lambdas to that exact origin (tighter than `*`) via `aws lambda update-function-configuration`.

If you'd rather script it (S3 static website hosting):

```bash
export SITE_BUCKET="labellens-site-$ACCOUNT_ID"
aws s3 mb s3://$SITE_BUCKET --region $REGION
aws s3 website s3://$SITE_BUCKET --index-document labellens.html
aws s3 cp ../labellens.html s3://$SITE_BUCKET/labellens.html --acl public-read
echo "http://$SITE_BUCKET.s3-website-$REGION.amazonaws.com/labellens.html"
```

(S3 static website endpoints are HTTP-only; use Amplify Hosting or CloudFront if the
demo needs HTTPS — most browsers are fine with HTTP for a hackathon demo video, but the
camera-capture `getUserMedia`-style flows some browsers gate behind HTTPS do not apply
here since this app uses a plain file `<input>`, not live camera capture.)

## 8. Smoke-test before touching the frontend

```bash
# analyze — use a real label photo, base64-encoded
IMG_B64=$(base64 -w0 test-label.jpg)   # macOS: base64 -i test-label.jpg | tr -d '\n'
curl -s -X POST "$ANALYZE_URL" -H "Content-Type: application/json" \
  -d "{\"imageBase64\":\"data:image/jpeg;base64,$IMG_B64\"}" | jq .

# journal log
curl -s -X POST "$JOURNAL_URL" -H "Content-Type: application/json" \
  -d '{"action":"log","userId":"test-user","scan":{"productName":"Test Snack","ts":1737300000000,"nutrients":{"sugar":{"value":20,"pct":40,"tier":"warn"},"sodium":{"value":100,"pct":5,"tier":"good"},"satfat":{"value":2,"pct":9,"tier":"good"}},"fssaiOk":true}}'

# journal list
curl -s -X POST "$JOURNAL_URL" -H "Content-Type: application/json" \
  -d '{"action":"list","userId":"test-user","limit":10}' | jq .
```

If `analyze` returns a schema/validation error mentioning structured outputs or
`outputConfig`, that's the signal the model isn't on the native-structured-outputs
allowlist yet — check the CloudWatch log for `labellens-analyze` for the
"Structured output failed, falling back to tool_use" warning; if the tool_use fallback
*also* fails, that's the trigger to fall back to the Build It track instead of burning
more hours here.
