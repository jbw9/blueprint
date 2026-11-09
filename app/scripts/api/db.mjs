// The one DynamoDB table every route here keeps its state in (TABLE): pk/sk strings, `ttl` for what expires.
//   install / <at>#<rand>        one run of install.sh, with its IP and where that is, and whether CI ran it
//   visit#<day> / <visitor>      one browser's views on blpr.dev that day
//   teamip / <network>           a network the admin dashboard was opened from: its installs and machines are ours (admin.mjs)
//   run / <at>#<id>              one finished run, without its report; runbody#<id> / body holds that
//   feedback / <at>#<id>         one bug report or feedback from the app; feedbackimg#<id> / <n> its pictures
//   admin / pw                   the dashboard password, as scrypt salt:hash
//   credit / config              the credit's settings (credit.mjs)
//   account / gh:<id>            one GitHub account on the credit, and the machines it uses (auth.mjs)
//   session / <sha256>           one signed-in machine's session, by its token's hash
//   device / <id>                one machine, and the account it is bound to
//   ipreg#<network> / <day>      accounts new to the credit from that network that day
//   win#acct:<id> / tab5h|tabweek|genweek   an account's open window, in millionths of a dollar
//   slot#<acct> / <lane>#<n>     one call of the account's in flight; rate#<acct> / <minute> its spend that minute
//   creditmonth / <YYYY-MM>      everyone's credit spend that month, held under its ceiling
//   creditday / <day>            the credit's spend that day; use#<day> / <acct> one account's tokens and spend
//   req#<acct> / <at>            one call, kept 30 days for review
//   usage#<day> / <lane>#<family>   every account's calls on one model that day; usage#<day> / refused, the calls turned away
//   limit#<route>#<network> / <minute>   how often one network asked a public route that minute (index.mjs)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE ?? "bluprint";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

export const get = async (pk, sk) => (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))).Item ?? null;
export const put = (item, condition, values, names) =>
  doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: item,
      ...(condition ? { ConditionExpression: condition } : {}),
      ...(values ? { ExpressionAttributeValues: values } : {}),
      ...(names ? { ExpressionAttributeNames: names } : {}),
    }),
  );
export const del = (pk, sk, condition, values) =>
  doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk }, ...(condition ? { ConditionExpression: condition, ExpressionAttributeValues: values } : {}) }));
export const update = (pk, sk, expression, values, condition, names) =>
  doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk, sk },
      UpdateExpression: expression,
      ExpressionAttributeValues: values,
      ...(names ? { ExpressionAttributeNames: names } : {}),
      ...(condition ? { ConditionExpression: condition } : {}),
      ReturnValues: "ALL_NEW",
    }),
  ).then((r) => r.Attributes);

/** Every item under one pk, in sk order, across pages. */
export async function query(pk, { from, to } = {}) {
  const out = [];
  let start;
  do {
    const range = from && to ? " and sk between :a and :b" : from ? " and sk >= :a" : "";
    const r = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: `pk = :pk${range}`,
        ExpressionAttributeValues: { ":pk": pk, ...(from ? { ":a": from } : {}), ...(to ? { ":b": to } : {}) },
        ExclusiveStartKey: start,
      }),
    );
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

export async function getMany(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) {
    let req = { [TABLE]: { Keys: keys.slice(i, i + 100) } };
    while (req && Object.keys(req).length) {
      const r = await doc.send(new BatchGetCommand({ RequestItems: req }));
      out.push(...(r.Responses?.[TABLE] ?? []));
      req = r.UnprocessedKeys;
    }
  }
  return out;
}

/** An item without the keys that are not its own (`pk`, `sk` and the like). */
export const without = (item, ...keys) => Object.fromEntries(Object.entries(item ?? {}).filter(([k]) => !keys.includes(k)));

/** A failed condition, which several writes here expect. */
export const refused = (e) => e?.name === "ConditionalCheckFailedException";

/** Whether `key` has been asked for fewer than `max` times this minute, counting this ask. */
export async function under(key, max) {
  try {
    await update(`limit#${key}`, new Date().toISOString().slice(0, 16), "ADD n :one SET #ttl = :ttl",
      { ":one": 1, ":max": max, ":ttl": Math.floor(Date.now() / 1000) + 120 }, "attribute_not_exists(n) OR n < :max", { "#ttl": "ttl" });
    return true;
  } catch (e) {
    if (refused(e)) return false;
    throw e;
  }
}

export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
