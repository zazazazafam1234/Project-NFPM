import { LINESSEClient, parseFlexMessage } from "./LINESSEClient.js";
import { amountToCents, confirmTopUpByAmount } from "../../topups";

const cookie = process.env.LINE_COOKIE;
const storageFile = process.env.LINE_REVISION_FILE ?? "/app/data/line_revision.txt";

if (!cookie) {
  console.error("LINE_COOKIE is required for line-worker");
  process.exit(1);
}

const client = new LINESSEClient({
  cookie,
  storageFile,
});

client.on("connected", (data) => {
  console.log("[line-worker] connected", data);
});

client.on("revision", (rev) => {
  console.log("[line-worker] revision saved", rev);
});

client.on("message", async (data) => {
  if (!data?.message?.contentMetadata?.FLEX_JSON) return;

  const parsed = parseFlexMessage(data.message);
  if (!parsed?.เงินเข้า) return;

  const amountCents = amountToCents(parsed.เงินเข้า);
  if (!amountCents) {
    console.warn("[line-worker] unable to parse incoming amount", parsed.เงินเข้า);
    return;
  }

  try {
    const result = await confirmTopUpByAmount({
      amountCents,
      lineMessage: parsed,
    });

    if (result.matched) {
      console.log(
        `[line-worker] paid topup=${result.topUpId} user=${result.userId} points=${result.points} amount=${result.amount}`,
      );
    } else {
      console.log(
        `[line-worker] no pending topup for amount=${(amountCents / 100).toFixed(2)} reason=${result.reason}`,
      );
    }
  } catch (err) {
    console.error("[line-worker] confirm failed", err instanceof Error ? err.message : err);
  }
});

client.on("disconnected", (data) => {
  console.log("[line-worker] disconnected", data.reason);
  setTimeout(() => client.connect(), 3000);
});

client.on("error", (err) => {
  console.error("[line-worker] error", err.message);
});

client.connect();
