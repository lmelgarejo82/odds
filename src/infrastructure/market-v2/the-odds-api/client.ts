import { z } from "zod";

export const THE_ODDS_API_BASE_URL = "https://api.the-odds-api.com" as const;
export const THE_ODDS_API_POLICY_VERSION = "the-odds-api/1.0.0" as const;

const outcomeSchema = z.object({ name: z.string().min(1), price: z.number().gt(1), point: z.number().optional() }).passthrough();
const marketSchema = z.object({ key: z.enum(["h2h", "totals"]), outcomes: z.array(outcomeSchema) }).passthrough();
const eventSchema = z.object({ id: z.string().min(1), commence_time: z.iso.datetime({ offset: true }), home_team: z.string().min(1), away_team: z.string().min(1), bookmakers: z.array(z.object({ key: z.string(), title: z.string(), markets: z.array(marketSchema) }).passthrough()) }).passthrough();

export type OddsApiEvent = z.infer<typeof eventSchema>;
export type OddsApiResult = Readonly<{ events: readonly OddsApiEvent[]; rawBytes: Uint8Array; capturedAtUtc: string; httpStatus: number }>;

export class TheOddsApiClient {
  constructor(private readonly options: Readonly<{ apiKey: string; fetchImpl: typeof fetch; clock: Readonly<{ nowUtc(): string }>; timeoutMs?: number; maxBytes?: number }>) {
    if (!options.apiKey || /[\s\u0000-\u001f]/u.test(options.apiKey)) throw new Error("THE_ODDS_API_KEY_INVALID");
  }

  async upcoming(): Promise<OddsApiResult> {
    const url = new URL("/v4/sports/upcoming/odds/", THE_ODDS_API_BASE_URL);
    url.search = new URLSearchParams({ apiKey: this.options.apiKey, regions: "eu,uk", markets: "h2h,totals", oddsFormat: "decimal", dateFormat: "iso" }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    try {
      const response = await this.options.fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: "application/json" } });
      if (response.status >= 300 && response.status < 400) throw new Error("ODDS_REDIRECT_BLOCKED");
      if (!response.ok) throw new Error(`ODDS_HTTP_${response.status}`);
      const rawBytes = new Uint8Array(await response.arrayBuffer());
      if (rawBytes.byteLength === 0 || rawBytes.byteLength > (this.options.maxBytes ?? 5_000_000)) throw new Error("ODDS_RESPONSE_SIZE_INVALID");
      if (new TextDecoder().decode(rawBytes).includes(this.options.apiKey)) throw new Error("ODDS_SECRET_REFLECTED");
      const parsed = z.array(eventSchema).safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes)));
      if (!parsed.success) throw new Error("ODDS_ENVELOPE_INVALID");
      return Object.freeze({ events: parsed.data, rawBytes, capturedAtUtc: this.options.clock.nowUtc(), httpStatus: response.status });
    } finally { clearTimeout(timer); }
  }
}
