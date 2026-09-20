import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE_NAME = process.env.TABLE_NAME || 'labellens-scans';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

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

async function logScan(userId, scan) {
  var item = {
    userId: userId,
    ts: scan.ts || Date.now(),
    productName: scan.productName || 'Scanned product',
    nutrients: scan.nutrients || {},
    fssaiOk: !!scan.fssaiOk
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

async function listScans(userId, limit, sinceDays) {
  var params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: sinceDays
      ? 'userId = :uid AND #ts BETWEEN :from AND :now'
      : 'userId = :uid',
    ExpressionAttributeValues: sinceDays
      ? { ':uid': userId, ':from': Date.now() - sinceDays * 86400000, ':now': Date.now() }
      : { ':uid': userId },
    ScanIndexForward: false,
    Limit: limit || 50
  };
  if (sinceDays) params.ExpressionAttributeNames = { '#ts': 'ts' };
  var res = await ddb.send(new QueryCommand(params));
  return res.Items || [];
}

export const handler = async (event) => {
  if (event.requestContext && event.requestContext.http && event.requestContext.http.method === 'OPTIONS') {
    return respond(204, {});
  }
  try {
    var body = event.body;
    if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
    var payload = JSON.parse(body || '{}');
    if (!payload.userId) return respond(400, { error: 'userId is required' });

    if (payload.action === 'log') {
      if (!payload.scan) return respond(400, { error: 'scan is required for action=log' });
      var item = await logScan(payload.userId, payload.scan);
      return respond(200, { ok: true, item: item });
    }

    if (payload.action === 'list') {
      var scans = await listScans(payload.userId, payload.limit, payload.sinceDays);
      return respond(200, { scans: scans });
    }

    return respond(400, { error: 'action must be "log" or "list"' });
  } catch (err) {
    console.error(err);
    return respond(500, { error: (err && err.message) || 'Journal request failed' });
  }
};
