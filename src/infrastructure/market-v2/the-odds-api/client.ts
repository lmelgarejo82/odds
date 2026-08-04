import { z } from "zod";

export const THE_ODDS_API_BASE_URL = "https://api.the-odds-api.com" as const;
export const THE_ODDS_API_POLICY_VERSION = "the-odds-api/1.0.0" as const;

const outcomeSchema = z.object({ name: z.string().min(1), price: z.number(), point: z.number().optional() }).passthrough();
const marketSchema = z.object({ key: z.string().min(1), outcomes: z.array(outcomeSchema) }).passthrough();
const eventSchema = z.object({ id: z.string().min(1), sport_key:z.string().optional(),sport_title:z.string().optional(),commence_time: z.iso.datetime({ offset: true }), home_team: z.string().min(1), away_team: z.string().min(1), bookmakers: z.array(z.object({ key: z.string(), title: z.string(), markets: z.array(marketSchema) }).passthrough()) }).passthrough();

export type OddsApiEvent = z.infer<typeof eventSchema>;
export type OddsApiResult = Readonly<{ events: readonly OddsApiEvent[]; rawBytes: Uint8Array; capturedAtUtc: string; httpStatus: number }>;
export class TheOddsApiError extends Error{constructor(readonly sanitizedCode:string,readonly responseReceived:boolean,readonly httpStatus:number|null){super(sanitizedCode);this.name="TheOddsApiError"}}

export class TheOddsApiClient {
  constructor(private readonly options: Readonly<{ apiKey: string; fetchImpl: typeof fetch; clock: Readonly<{ nowUtc(): string }>; timeoutMs?: number; maxBytes?: number }>) {
    if (!options.apiKey || /[\s\u0000-\u001f]/u.test(options.apiKey)) throw new Error("THE_ODDS_API_KEY_INVALID");
  }

  async upcoming(): Promise<OddsApiResult> {
    return this.request(new URL("/v4/sports/upcoming/odds/", THE_ODDS_API_BASE_URL));
  }

  async bySport(input: Readonly<{ sportKey: string; commenceTimeFrom: string; commenceTimeTo: string }>): Promise<OddsApiResult> {
    if (!/^soccer_[a-z0-9_]+$/u.test(input.sportKey)) throw new TheOddsApiError("ODDS_SPORT_KEY_INVALID", false, null);
    const from = Date.parse(input.commenceTimeFrom), to = Date.parse(input.commenceTimeTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new TheOddsApiError("ODDS_TIME_WINDOW_INVALID", false, null);
    const url = new URL(`/v4/sports/${input.sportKey}/odds/`, THE_ODDS_API_BASE_URL);
    url.searchParams.set("commenceTimeFrom", new Date(from).toISOString());
    url.searchParams.set("commenceTimeTo", new Date(to).toISOString());
    return this.request(url);
  }

  private async request(url: URL): Promise<OddsApiResult> {
    url.searchParams.set("apiKey", this.options.apiKey);
    url.searchParams.set("regions", "eu,uk");
    url.searchParams.set("markets", "h2h,totals");
    url.searchParams.set("oddsFormat", "decimal");
    url.searchParams.set("dateFormat", "iso");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    try {
      const response = await this.options.fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: "application/json" } });
      if (response.status >= 300 && response.status < 400) throw new TheOddsApiError("ODDS_REDIRECT_BLOCKED",true,response.status);
      if (response.status === 404 || response.status === 422) throw new TheOddsApiError("ODDS_COMPETITION_NOT_COVERED",true,response.status);
      if (!response.ok) throw new TheOddsApiError("ODDS_HTTP_FAILURE",true,response.status);
      const rawBytes = new Uint8Array(await response.arrayBuffer());
      if (rawBytes.byteLength === 0 || rawBytes.byteLength > (this.options.maxBytes ?? 5_000_000)) throw new TheOddsApiError("ODDS_RESPONSE_SIZE_INVALID",true,response.status);
      if (new TextDecoder().decode(rawBytes).includes(this.options.apiKey)) throw new TheOddsApiError("ODDS_SECRET_REFLECTED",true,response.status);
      let document:unknown;try{document=JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes))}catch{throw new TheOddsApiError("ODDS_JSON_INVALID",true,response.status)}
      const parsed = z.array(eventSchema).safeParse(document);
      if (!parsed.success) throw new TheOddsApiError("ODDS_ENVELOPE_INVALID",true,response.status);
      return Object.freeze({ events: parsed.data, rawBytes, capturedAtUtc: this.options.clock.nowUtc(), httpStatus: response.status });
    } finally { clearTimeout(timer); }
  }
}
