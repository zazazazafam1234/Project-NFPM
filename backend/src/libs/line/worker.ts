import { mkdirSync } from "fs";
import { join } from "path";
import { LINESSEClient, parseFlexMessage } from "./LINESSEClient.js";
import {
  amountToCents,
  confirmTopUpByAmount,
  getAccountsAwaitingPayment,
  getActivePaymentAccounts,
  markLineTransferEventFailed,
  recordLineTransferEvent,
  type ActivePaymentAccount,
} from "../../topups";

const revisionDir = process.env.LINE_REVISION_DIR ?? "./data/line-revisions";
const reloadMs = Number(process.env.LINE_ACCOUNTS_RELOAD_MS ?? 30000);

// LINE sometimes holds transfer notifications (often late at night). While a QR is
// waiting we re-sync by reconnecting from the saved revision: every minute normally,
// every 10 seconds for a few minutes after a customer presses "ฉันจ่ายเงินแล้ว".
const RESYNC_CHECK_MS = 5000;
const RESYNC_IDLE_MS = 60 * 1000;
const RESYNC_BOOST_MS = 10 * 1000;
const RESYNC_BOOST_MINUTES = 5;
const lastResync = new Map<string, number>();

type ManagedClient = {
  accountId: string;
  updatedAt: string;
  client: LINESSEClient;
};

const clients = new Map<string, ManagedClient>();

mkdirSync(revisionDir, { recursive: true });

function revisionFileFor(accountId: string) {
  return join(revisionDir, `${accountId}.revision.txt`);
}

function stopClient(accountId: string, reason: string) {
  const managed = clients.get(accountId);
  if (!managed) return;
  managed.client.disconnect();
  clients.delete(accountId);
  console.log(`[line-worker] stopped account=${accountId} reason=${reason}`);
}

function startClient(account: ActivePaymentAccount) {
  stopClient(account.id, "restart");

  const client = new LINESSEClient({
    cookie: account.lineCookie,
    storageFile: revisionFileFor(account.id),
  });

  console.log("[line-worker] starting account", {
    accountId: account.id,
    accountName: account.name,
    cookieLength: account.lineCookie.length,
    cookieHasLct: account.lineCookie.includes("lct="),
  });

  client.on("connected", (data) => {
    console.log("[line-worker] connected", {
      accountId: account.id,
      accountName: account.name,
      localRev: data?.localRev,
    });
  });

  client.on("revision", (rev) => {
    console.log("[line-worker] revision saved", {
      accountId: account.id,
      rev,
    });
  });

  client.on("message", async (data) => {
    if (!data?.message?.contentMetadata?.FLEX_JSON) return;

    const parsed = parseFlexMessage(data.message);
    if (!parsed?.เงินเข้า) return;

    const amountCents = amountToCents(parsed.เงินเข้า);
    if (!amountCents) {
      console.warn("[line-worker] unable to parse incoming amount", {
        accountId: account.id,
        amount: parsed.เงินเข้า,
      });
      return;
    }

    const lineRevision = data.revision ?? data.nextRevision ?? client.getLocalRev();
    let transferEvent: { id: string; alreadyMatched: boolean } | null = null;

    try {
      transferEvent = await recordLineTransferEvent({
        paymentAccountId: account.id,
        lineRevision,
        parsed: {
          ...parsed,
          paymentAccountId: account.id,
          paymentAccountName: account.name,
          lineRevision,
        },
      });

      if (transferEvent.alreadyMatched) {
        console.log("[line-worker] duplicate matched transfer ignored", {
          accountId: account.id,
          lineRevision,
          transferEventId: transferEvent.id,
        });
        return;
      }

      const result = await confirmTopUpByAmount({
        amountCents,
        lineMessage: {
          ...parsed,
          paymentAccountId: account.id,
          paymentAccountName: account.name,
          lineRevision,
          lineTransferEventId: transferEvent.id,
        },
        paymentAccountId: account.id,
        lineTransferEventId: transferEvent.id,
      });

      if (result.matched) {
        console.log(
          `[line-worker] paid account=${account.id} topup=${result.topUpId} user=${result.userId} points=${result.points} amount=${result.amount}`,
        );
      } else {
        console.log(
          `[line-worker] no pending topup account=${account.id} amount=${(amountCents / 100).toFixed(2)} reason=${result.reason}`,
        );
      }
    } catch (err) {
      if (transferEvent?.id) {
        await markLineTransferEventFailed(
          transferEvent.id,
          err instanceof Error ? err.message : "confirm_failed",
        );
      }
      console.error("[line-worker] confirm failed", {
        accountId: account.id,
        error: err instanceof Error ? err.message : err,
      });
    }
  });

  client.on("disconnected", (data) => {
    if (!clients.has(account.id)) return;
    console.log("[line-worker] disconnected", {
      accountId: account.id,
      reason: data?.reason,
    });
    setTimeout(() => {
      if (clients.has(account.id)) void client.connect();
    }, 3000);
  });

  client.on("error", (err) => {
    console.error("[line-worker] error", {
      accountId: account.id,
      error: err.message,
    });
  });

  clients.set(account.id, {
    accountId: account.id,
    updatedAt: account.updatedAt,
    client,
  });

  void client.connect();
}

async function resyncAwaitingAccounts() {
  const awaiting = await getAccountsAwaitingPayment(RESYNC_BOOST_MINUTES);
  const now = Date.now();
  for (const { payment_account_id: accountId, boost } of awaiting) {
    const managed = clients.get(accountId);
    // Only reconnect a live stream; the "disconnected" handler reconnects it in 3 s.
    if (!managed || !managed.client.isConnected()) continue;
    const since = now - (lastResync.get(accountId) ?? 0);
    if (since < (boost ? RESYNC_BOOST_MS : RESYNC_IDLE_MS)) continue;
    lastResync.set(accountId, now);
    console.log(`[line-worker] resync account=${accountId} reason=${boost ? "customer_check" : "pending_topup"}`);
    managed.client.disconnect();
  }
}

async function reloadAccounts() {
  const accounts = await getActivePaymentAccounts();
  const activeIds = new Set(accounts.map((account) => account.id));

  for (const accountId of clients.keys()) {
    if (!activeIds.has(accountId)) {
      stopClient(accountId, "inactive_or_removed");
    }
  }

  for (const account of accounts) {
    const current = clients.get(account.id);
    if (!current || current.updatedAt !== account.updatedAt) {
      startClient(account);
    }
  }

  if (accounts.length === 0) {
    console.log("[line-worker] no active payment accounts with LINE cookie; waiting for admin setup");
  }
}

async function boot() {
  await reloadAccounts();
  setInterval(() => {
    reloadAccounts().catch((err) => {
      console.error("[line-worker] reload failed", err instanceof Error ? err.message : err);
    });
  }, Number.isFinite(reloadMs) && reloadMs >= 5000 ? reloadMs : 30000);
  setInterval(() => {
    resyncAwaitingAccounts().catch((err) => {
      console.error("[line-worker] resync failed", err instanceof Error ? err.message : err);
    });
  }, RESYNC_CHECK_MS);
}

boot().catch((err) => {
  console.error("[line-worker] boot failed", err instanceof Error ? err.message : err);
  process.exit(1);
});
