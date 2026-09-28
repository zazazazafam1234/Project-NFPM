import { createParser } from "eventsource-parser";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

export class LINESSEClient {
      constructor(config = {}) {
            this.storageFile = config.storageFile || resolve("./line_revision.txt");

            this.config = {
                  baseUrl: "https://line-chrome-gw.line-apps.com/api/operation/receive",
                  localRev: this.loadRevision() || 0,
                  version: "3.7.1",
                  cookie: config.cookie || "",
                  maxRetries: config.maxRetries || 5,
                  retryDelay: config.retryDelay || 2000,
                  ...config
            };

            this.abort = null;
            this.retries = 0;
            this.status = "disconnected";
            this.handlers = {};
      }

      loadRevision() {
            try {
                  if (!existsSync(this.storageFile)) return null;
                  const content = readFileSync(this.storageFile, "utf-8").trim();
                  const rev = parseInt(content);
                  return isNaN(rev) ? null : rev;
            } catch (err) {
                  console.error("Failed to load revision:", err.message);
                  return null;
            }
      }

      saveRevision(rev) {
            try {
                  writeFileSync(this.storageFile, rev.toString(), "utf-8");
            } catch (err) {
                  console.error("Failed to save revision:", err.message);
            }
      }

      on(event, fn) {
            if (!this.handlers[event]) this.handlers[event] = [];
            this.handlers[event].push(fn);
            return this;
      }

      emit(event, data) {
            if (this.handlers[event]) {
                  this.handlers[event].forEach(fn => fn(data));
            }
      }

      buildUrl() {
            const p = new URLSearchParams({
                  localRev: this.config.localRev,
                  version: this.config.version,
                  lastPartialFullSyncs: "{}",
                  language: "en_US"
            });
            return `${this.config.baseUrl}?${p}`;
      }

      async connect() {
            if (this.status === "connected") return;

            this.abort = new AbortController();

            try {
                  const res = await fetch(this.buildUrl(), {
                        signal: this.abort.signal,
                        headers: {
                              "accept": "text/event-stream",
                              "cache-control": "no-cache",
                              "Cookie": this.config.cookie,
                              "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                        }
                  });

                  if (!res.ok) throw new Error(`HTTP ${res.status}`);

                  this.status = "connected";
                  this.retries = 0;
                  this.emit("connected", { localRev: this.config.localRev });

                  await this.stream(res.body);

            } catch (err) {
                  if (err.name === "AbortError") return;

                  this.status = "disconnected";
                  this.emit("error", err);

                  if (this.retries < this.config.maxRetries) {
                        this.retries++;
                        setTimeout(() => this.connect(), this.config.retryDelay * this.retries);
                  } else {
                        this.emit("disconnected", { reason: "max_retries" });
                  }
            }
      }

      async stream(body) {
            const parser = createParser({
                  onEvent: (e) => this.handle(e)
            });

            const reader = body.getReader();
            const decoder = new TextDecoder();

            try {
                  while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        parser.feed(decoder.decode(value, { stream: true }));
                  }
            } catch (err) {
                  if (err.name !== "AbortError") throw err;
            } finally {
                  reader.releaseLock();
                  this.status = "disconnected";
                  this.emit("disconnected", { reason: "stream_ended" });
            }
      }

      handle(event) {
            if (!event.data) return;

            try {
                  const data = JSON.parse(event.data);

                  if (data.revision) {
                        const rev = parseInt(data.revision);
                        this.config.localRev = rev;
                        this.saveRevision(rev);
                        this.emit("revision", rev);
                  }

                  if (data.nextRevision) {
                        const rev = parseInt(data.nextRevision);
                        this.config.localRev = rev;
                        this.saveRevision(rev);
                        this.emit("revision", rev);
                  }

                  this.emit("message", data);
            } catch {
                  this.emit("message", { raw: event.data });
            }
      }

      disconnect() {
            if (this.abort) this.abort.abort();
            this.status = "disconnected";
      }

      isConnected() {
            return this.status === "connected";
      }

      getLocalRev() {
            return this.config.localRev;
      }

      clearRevision() {
            try {
                  if (existsSync(this.storageFile)) {
                        writeFileSync(this.storageFile, "0", "utf-8");
                  }
                  this.config.localRev = 0;
            } catch (err) {
                  console.error("Failed to clear revision:", err.message);
            }
      }
}


export function parseFlexMessage(message) {
      if (!message?.contentMetadata?.FLEX_JSON) {
            // console.log(JSON.stringify(message, null, 2))
            return null;
      }

      try {
            const flex = JSON.parse(message.contentMetadata.FLEX_JSON);
            const altText = message.contentMetadata.ALT_TEXT || "";

            const amountMatch = altText.match(/เงินเข้า:\s*([\d,]+\.?\d*)\s*บาท/);
            const accountMatch = altText.match(/เข้าบัญชี\s*([^\s]+)/);
            const dateMatch = altText.match(/เมื่อ\s*([^\s]+\s+[^\s]+)/);
            const balanceMatch = altText.match(/ยอดเงินที่ใช้ได้\s*([\d,]+\.?\d*)\s*บาท/);

            let data = {};

            if (flex?.body?.contents) {
                  flex.body.contents.forEach(item => {
                        if (item.layout === "horizontal" || item.layout === "baseline") {
                              const contents = item.contents || [];
                              if (contents.length >= 2) {
                                    const label = contents[0].text?.trim();
                                    const value = contents[1].text?.trim() ||
                                          contents[1].contents?.[0]?.text?.trim();

                                    if (label && value) {
                                          data[label] = value;
                                    }
                              }
                        }
                  });
            }

            return {
                  เงินเข้า: amountMatch?.[1] || data["เงินเข้า"] || "",
                  เมื่อ: dateMatch?.[1] || data["วันที่ทำรายการ"] || "",
                  ยอดเงินทั้งหมด: balanceMatch?.[1] || data["ยอดที่ใช้ได้"] || "",
                  เข้าบัญชี: accountMatch?.[1] || data["เข้าบัญชี"] || "",
                  ประเภท: data["ประเภท"] || "",
                  จากบัญชี: data["จากบัญชี"] || "",
                  ผู้โอน: data["ผู้โอน"] || "",
                  raw: {
                        altText,
                        flex
                  }
            };

      } catch (err) {
            console.error("Failed to parse flex message:", err);
            return null;
      }
}