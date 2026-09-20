import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const REGION = process.env.AWS_REGION || 'us-east-1';
// Amazon Nova Pro by default: confirmed working end-to-end (image in, schema-shaped JSON out)
// via the tool_use fallback path below. Anthropic Claude models on this account are blocked
// until the "Anthropic model use case" form is submitted in the Bedrock console (separate from
// model access) - see deploy/DEPLOY.md §1. Switch BEDROCK_MODEL_ID once that clears if you
// want to try Claude's native Structured Outputs path instead.
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const bedrock = new BedrockRuntimeClient({ region: REGION });

// ---------- Same deterministic thresholds as the labellens.html prototype ----------
const DAILY_LIMITS = { sugar_g: 50, sodium_mg: 2000, satfat_g: 22 };
const FLAG_BANDS = { good: 15, caution: 30 }; // % of daily limit, per serving

const FLAGGED_INGREDIENTS = [
  { match: /partially hydrogenated|vanaspati|hydrogenated veg/i, label: 'trans fat source', tier: 'warn' },
  { match: /high fructose corn syrup|\bhfcs\b/i, label: 'added sugar', tier: 'warn' },
  { match: /monosodium glutamate|\bmsg\b|e-?\s?621/i, label: 'flavour enhancer', tier: 'caution' },
  { match: /sodium benzoate|e-?\s?211/i, label: 'preservative', tier: 'caution' },
  { match: /\bbha\b|\bbht\b|e-?\s?32[01]/i, label: 'preservative', tier: 'caution' },
  { match: /tartrazine|e-?\s?102|sunset yellow|e-?\s?110|allura red|e-?\s?129/i, label: 'artificial colour', tier: 'caution' },
  { match: /sulphite|sulfite|e-?\s?22\d/i, label: 'preservative · allergen risk', tier: 'caution' },
  { match: /\bmilk\b|\bwhey\b|casein|lactose/i, label: 'allergen: milk', tier: 'caution' },
  { match: /peanut|groundnut/i, label: 'allergen: peanut', tier: 'warn' },
  { match: /\bsoy\b|soya/i, label: 'allergen: soy', tier: 'caution' },
  { match: /gluten|\bwheat\b/i, label: 'allergen: gluten', tier: 'caution' },
  { match: /\begg\b|albumin/i, label: 'allergen: egg', tier: 'caution' },
  { match: /tree nut|cashew|almond|walnut|pistachio/i, label: 'allergen: tree nut', tier: 'caution' }
];

const EXTRACTION_PROMPT = 'You are reading a photo of the back of a packaged food product sold in India. ' +
  'Reply with ONLY this JSON shape, no other text:\n' +
  '{"productName": string|null, "fssaiNumber": string of digits only or null, "servingSize": string|null, ' +
  '"nutrients": {"sugar_g": number|null, "sodium_mg": number|null, "saturatedFat_g": number|null}, ' +
  '"ingredients": [string, ...]}\n' +
  'Use the values as printed per serving, reading each number and its unit exactly as printed — do not reinterpret the decimal point or unit. ' +
  'sodium_mg: if the label prints a line explicitly labelled "Sodium" (in mg or g), use that number directly, converting g to mg by *1000 only — never apply any other conversion to it. ' +
  'Only if the label has NO "Sodium" line at all, but DOES print a "Salt" line in grams, then convert: sodium_mg = salt_g * 400. Never apply both. ' +
  'If only per-100g values are printed with no serving size, use the per-100g values and set servingSize to "100 g". ' +
  'Split the ingredients list into individual items, preserving the order printed. If a field truly is not visible, use null — never guess a number.';

const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    productName: { type: ['string', 'null'] },
    fssaiNumber: { type: ['string', 'null'] },
    servingSize: { type: ['string', 'null'] },
    nutrients: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sugar_g: { type: ['number', 'null'] },
        sodium_mg: { type: ['number', 'null'] },
        saturatedFat_g: { type: ['number', 'null'] }
      },
      required: ['sugar_g', 'sodium_mg', 'saturatedFat_g']
    },
    ingredients: { type: 'array', items: { type: 'string' } }
  },
  required: ['productName', 'fssaiNumber', 'servingSize', 'nutrients', 'ingredients']
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function respond(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

function parseImage(imageBase64) {
  // Accepts either a raw base64 string or a data: URL.
  var mime = 'image/jpeg';
  var b64 = imageBase64;
  var m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(imageBase64 || '');
  if (m) { mime = m[1]; b64 = m[2]; }
  var format = mime.split('/')[1] === 'jpg' ? 'jpeg' : mime.split('/')[1];
  return { format: format, bytes: Buffer.from(b64, 'base64') };
}

// ---------- Bedrock call: try native Structured Outputs, fall back to forced tool_use ----------
async function extractWithStructuredOutput(image) {
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{
      role: 'user',
      content: [
        { text: EXTRACTION_PROMPT },
        { image: { format: image.format, source: { bytes: image.bytes } } }
      ]
    }],
    outputConfig: {
      textFormat: {
        type: 'json_schema',
        // NOTE: the SDK's JsonSchemaDefinition.schema field is typed as a JSON *string*,
        // not a raw object - passing an object throws a SerializationException.
        structure: { jsonSchema: { name: 'food_label_extraction', schema: JSON.stringify(EXTRACTION_JSON_SCHEMA) } }
      }
    }
  });
  const res = await bedrock.send(command);
  const text = res.output.message.content.find(function (c) { return c.text; }).text;
  return JSON.parse(text);
}

async function extractWithToolUse(image) {
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{
      role: 'user',
      content: [
        { text: EXTRACTION_PROMPT },
        { image: { format: image.format, source: { bytes: image.bytes } } }
      ]
    }],
    toolConfig: {
      tools: [{ toolSpec: { name: 'food_label_extraction', inputSchema: { json: EXTRACTION_JSON_SCHEMA } } }],
      toolChoice: { tool: { name: 'food_label_extraction' } }
    }
  });
  const res = await bedrock.send(command);
  const toolUse = res.output.message.content.find(function (c) { return c.toolUse; });
  if (!toolUse) throw new Error('Model did not return a tool_use block');
  return toolUse.toolUse.input;
}

async function extractLabel(image) {
  try {
    return await extractWithStructuredOutput(image);
  } catch (err) {
    // Model/region not on the native structured-outputs allowlist yet — fall back.
    console.warn('Structured output failed, falling back to tool_use:', err.message);
    return await extractWithToolUse(image);
  }
}

// ---------- Deterministic flagging (ported verbatim from labellens.html — no LLM in the judgement calls) ----------
function checkFssaiFormat(rawNumber) {
  var digits = (rawNumber || '').replace(/\D/g, '');
  if (!digits) return { number: null, ok: false, reason: 'No FSSAI number visible on the label.' };
  if (digits.length !== 14) return { number: digits, ok: false, reason: 'Found ' + digits.length + ' digits, not the 14 an FSSAI number should have.' };
  var year = parseInt(digits.slice(3, 5), 10);
  var thisYear2 = new Date().getFullYear() % 100;
  if (isNaN(year) || year < 12 || year > thisYear2) return { number: digits, ok: false, reason: 'Structure is 14 digits, but the registration-year digits look off.' };
  return { number: digits, ok: true, reason: 'Valid 14-digit FSSAI structure.' };
}

function buildAnalysis(raw) {
  raw = raw || {};
  var n = raw.nutrients || {};
  var defs = [
    { key: 'sugar', label: 'Sugar', unit: 'g', value: (n.sugar_g == null ? null : Number(n.sugar_g)), limit: DAILY_LIMITS.sugar_g },
    { key: 'sodium', label: 'Sodium', unit: 'mg', value: (n.sodium_mg == null ? null : Number(n.sodium_mg)), limit: DAILY_LIMITS.sodium_mg },
    { key: 'satfat', label: 'Saturated fat', unit: 'g', value: (n.saturatedFat_g == null ? null : Number(n.saturatedFat_g)), limit: DAILY_LIMITS.satfat_g }
  ];
  var rows = defs.map(function (r) {
    if (r.value == null || isNaN(r.value)) return Object.assign({}, r, { pct: null, tier: 'unknown' });
    var pct = Math.round((r.value / r.limit) * 100);
    var tier = pct >= FLAG_BANDS.caution ? 'warn' : (pct >= FLAG_BANDS.good ? 'caution' : 'good');
    return Object.assign({}, r, { pct: pct, tier: tier });
  });

  var ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : []).map(function (name) {
    var hit = null;
    for (var i = 0; i < FLAGGED_INGREDIENTS.length; i++) { if (FLAGGED_INGREDIENTS[i].match.test(name)) { hit = FLAGGED_INGREDIENTS[i]; break; } }
    return { name: name, flag: hit ? hit.tier : null, why: hit ? hit.label : null };
  });

  return {
    productName: raw.productName || 'Scanned product',
    servingSize: raw.servingSize || null,
    nutrientRows: rows,
    fssai: checkFssaiFormat(raw.fssaiNumber),
    ingredients: ingredients,
    ts: Date.now()
  };
}

export const handler = async (event) => {
  if (event.requestContext && event.requestContext.http && event.requestContext.http.method === 'OPTIONS') {
    return respond(204, {});
  }
  try {
    var body = event.body;
    if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
    var payload = JSON.parse(body || '{}');
    if (!payload.imageBase64) return respond(400, { error: 'imageBase64 is required' });

    var image = parseImage(payload.imageBase64);
    var raw = await extractLabel(image);
    var analysis = buildAnalysis(raw);
    return respond(200, analysis);
  } catch (err) {
    console.error(err);
    return respond(500, { error: (err && err.message) || 'Analysis failed' });
  }
};
