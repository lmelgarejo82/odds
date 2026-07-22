import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

type MutableRecord = Record<string, unknown>;

export async function withOfflineNetworkGuard<T>(operation: () => Promise<T>): Promise<T> {
  const restorers: Array<() => void> = [];
  const block = (label: string) => {
    return () => {
      throw new Error(`HISTORICAL_ANALYSIS_NETWORK_BLOCKED:${label}`);
    };
  };
  const replace = (target: MutableRecord, key: string, label: string) => {
    const original = target[key];
    target[key] = block(label);
    restorers.push(() => { target[key] = original; });
  };

  const globalTarget = globalThis as unknown as MutableRecord;
  replace(globalTarget, "fetch", "fetch");
  if ("WebSocket" in globalTarget) replace(globalTarget, "WebSocket", "browser-websocket");
  replace(http as unknown as MutableRecord, "request", "http.request");
  replace(http as unknown as MutableRecord, "get", "http.get");
  replace(https as unknown as MutableRecord, "request", "https.request");
  replace(https as unknown as MutableRecord, "get", "https.get");
  replace(net as unknown as MutableRecord, "connect", "net.connect");
  replace(net as unknown as MutableRecord, "createConnection", "net.createConnection");
  replace(tls as unknown as MutableRecord, "connect", "tls.connect");
  replace(dns as unknown as MutableRecord, "lookup", "dns.lookup");
  replace(dns as unknown as MutableRecord, "resolve", "dns.resolve");

  try {
    return await operation();
  } finally {
    for (const restore of restorers.reverse()) restore();
  }
}
