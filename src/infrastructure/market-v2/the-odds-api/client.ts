import { randomUUID } from "node:crypto";
import { z } from "zod";

export const THE_ODDS_API_BASE_URL = "https://api.the-odds-api.com" as const;
export const THE_ODDS_API_POLICY_VERSION = "the-odds-api/1.1.0" as const;

const outcomeSchema = z.object({ name: z.string().min(1), price: z.number(), point: z.number().optional() }).passthrough();
const marketSchema = z.object({ key: z.string().min(1), outcomes: z.array(outcomeSchema) }).passthrough();
const eventIdentitySchema = z.object({ id: z.string().min(1), sport_key: z.string().min(1).optional(), sport_title: z.string().optional(), commence_time: z.iso.datetime({ offset: true }), home_team: z.string().min(1), away_team: z.string().min(1) }).passthrough();
const eventSchema = eventIdentitySchema.extend({ bookmakers: z.array(z.object({ key: z.string(), title: z.string(), markets: z.array(marketSchema) }).passthrough()) });
const sportSchema = z.object({ key: z.string().min(1), group: z.string(), title: z.string(), description: z.string(), active: z.boolean(), has_outrights: z.boolean() }).passthrough();

export type OddsApiEvent = z.infer<typeof eventSchema>;
export type OddsApiEventIdentity = z.infer<typeof eventIdentitySchema>;
export type OddsApiSport = z.infer<typeof sportSchema>;
export type OddsQuotaMetadata = Readonly<{ used: number | null; remaining: number | null; last: number | null }>;
export type OddsRequestContext = Readonly<{ endpointKey: "sports-catalog" | "sport-events" | "odds-by-sport"; sportKey: string | null; regions: readonly string[]; markets: readonly string[]; commenceTimeFrom: string | null; commenceTimeTo: string | null }>;
export type OddsProviderFailure = Readonly<{ httpStatus: number; providerErrorCode: string | null; providerErrorMessage: string; request: OddsRequestContext; quota: OddsQuotaMetadata; correlationId: string; capturedAtUtc: string; evidenceBytes: Uint8Array }>;
export type OddsProviderErrorClassification = "INVALID_SPORT" | "UNKNOWN_SPORT" | "INVALID_REGION" | "INVALID_MARKET" | "INVALID_MARKET_COMBO" | "INVALID_COMMENCE_TIME_FROM" | "INVALID_COMMENCE_TIME_TO" | "INVALID_COMMENCE_TIME_RANGE" | "OUT_OF_USAGE_CREDITS" | "PROVIDER_VALIDATION_ERROR" | "PROVIDER_HTTP_ERROR";
type ApiResult<T> = Readonly<{ payload: readonly T[]; rawBytes: Uint8Array; capturedAtUtc: string; httpStatus: number; quota: OddsQuotaMetadata; request: OddsRequestContext }>;
export type OddsApiResult = ApiResult<OddsApiEvent> & Readonly<{ events: readonly OddsApiEvent[] }>;
export type OddsEventsResult = ApiResult<OddsApiEventIdentity> & Readonly<{ events: readonly OddsApiEventIdentity[] }>;
export type OddsSportsResult = ApiResult<OddsApiSport> & Readonly<{ sports: readonly OddsApiSport[] }>;

export class TheOddsApiError extends Error {
  constructor(readonly sanitizedCode: string, readonly responseReceived: boolean, readonly httpStatus: number | null, readonly providerFailure: OddsProviderFailure | null = null) { super(sanitizedCode); this.name = "TheOddsApiError"; }
}

const safeIntegerHeader = (headers: Headers, name: string): number | null => { const raw = headers.get(name); return raw !== null && /^\d+$/u.test(raw) ? Number(raw) : null; };
const quotaFrom = (headers: Headers): OddsQuotaMetadata => Object.freeze({ used: safeIntegerHeader(headers, "x-requests-used"), remaining: safeIntegerHeader(headers, "x-requests-remaining"), last: safeIntegerHeader(headers, "x-requests-last") });
const providerUtcSecond = (value: number): string => new Date(value).toISOString().replace(/\.\d{3}Z$/u, "Z");
const truncateUtf8 = (value: string, maximumBytes = 2048): string => { const clean = value.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim(); const bytes = new TextEncoder().encode(clean); return bytes.byteLength <= maximumBytes ? clean : new TextDecoder().decode(bytes.slice(0, maximumBytes)).replace(/\uFFFD$/u, ""); };
const safeProviderToken = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value) ? value : null;

function sanitizedProviderError(body: Uint8Array, contentType: string | null, apiKey: string): Readonly<{ code: string | null; message: string }> {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(body);
  if (contentType?.toLowerCase().includes("text/html") || /^\s*</u.test(decoded)) return Object.freeze({ code: null, message: "HTML_ERROR_BODY_REDACTED" });
  let parsed: unknown;
  try { parsed = JSON.parse(decoded); } catch { return Object.freeze({ code: null, message: truncateUtf8(decoded.replaceAll(apiKey, "[REDACTED]")) || "UNPARSEABLE_PROVIDER_ERROR" }); }
  const record = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const code = safeProviderToken(record.error_code ?? record.code);
  const rawMessage = typeof record.message === "string" ? record.message : typeof record.error === "string" ? record.error : "PROVIDER_ERROR_WITHOUT_MESSAGE";
  return Object.freeze({ code, message: truncateUtf8(rawMessage.replaceAll(apiKey, "[REDACTED]")) });
}

export function classifyOddsProviderFailure(failure: OddsProviderFailure): OddsProviderErrorClassification {
  const value = `${failure.providerErrorCode ?? ""} ${failure.providerErrorMessage}`.toUpperCase();
  if (/OUT_OF_USAGE|USAGE.*CREDIT|QUOTA.*EXCEEDED/u.test(value)) return "OUT_OF_USAGE_CREDITS";
  if (/UNKNOWN[_ ]SPORT/u.test(value)) return "UNKNOWN_SPORT";
  if (/INVALID[_ ]SPORT/u.test(value)) return "INVALID_SPORT";
  if (/INVALID[_ ]REGION/u.test(value)) return "INVALID_REGION";
  if (/INVALID[_ ]MARKET.*COMBO|MARKET.*COMBINATION/u.test(value)) return "INVALID_MARKET_COMBO";
  if (/INVALID[_ ]MARKET/u.test(value)) return "INVALID_MARKET";
  if (/INVALID[_ ]COMMENCE[_ ]TIME[_ ]FROM/u.test(value)) return "INVALID_COMMENCE_TIME_FROM";
  if (/INVALID[_ ]COMMENCE[_ ]TIME[_ ]TO/u.test(value)) return "INVALID_COMMENCE_TIME_TO";
  if (/COMMENCE.*RANGE|TIME.*RANGE/u.test(value)) return "INVALID_COMMENCE_TIME_RANGE";
  return failure.httpStatus === 400 || failure.httpStatus === 422 ? "PROVIDER_VALIDATION_ERROR" : "PROVIDER_HTTP_ERROR";
}

export class TheOddsApiClient {
  constructor(private readonly options: Readonly<{ apiKey: string; fetchImpl: typeof fetch; clock: Readonly<{ nowUtc(): string }>; timeoutMs?: number; maxBytes?: number }>) {
    if (!options.apiKey || /[\s\u0000-\u001f]/u.test(options.apiKey)) throw new Error("THE_ODDS_API_KEY_INVALID");
  }

  async sportsCatalog(): Promise<OddsSportsResult> {
    const context: OddsRequestContext = Object.freeze({ endpointKey: "sports-catalog", sportKey: null, regions: [], markets: [], commenceTimeFrom: null, commenceTimeTo: null });
    const url = new URL("/v4/sports/", THE_ODDS_API_BASE_URL); url.searchParams.set("all", "true");
    const result = await this.request(url, context, z.array(sportSchema));
    return Object.freeze({ ...result, sports: result.payload });
  }

  async eventsBySport(input: Readonly<{ sportKey: string; commenceTimeFrom: string; commenceTimeTo: string }>): Promise<OddsEventsResult> {
    const { url, from, to } = this.sportUrl(input, "events");
    const context: OddsRequestContext = Object.freeze({ endpointKey: "sport-events", sportKey: input.sportKey, regions: [], markets: [], commenceTimeFrom: from, commenceTimeTo: to });
    const result = await this.request(url, context, z.array(eventIdentitySchema));
    return Object.freeze({ ...result, events: result.payload });
  }

  async bySport(input: Readonly<{ sportKey: string; commenceTimeFrom: string; commenceTimeTo: string; regions?: readonly string[]; markets?: readonly string[] }>): Promise<OddsApiResult> {
    const { url, from, to } = this.sportUrl(input, "odds");
    const regions = Object.freeze([...(input.regions ?? ["eu"])]); const markets = Object.freeze([...(input.markets ?? ["h2h"])]);
    if (regions.length === 0 || regions.some((value) => !/^[a-z]{2}$/u.test(value))) throw new TheOddsApiError("ODDS_REGION_INVALID", false, null);
    if (markets.length === 0 || markets.some((value) => value !== "h2h" && value !== "totals")) throw new TheOddsApiError("ODDS_MARKET_INVALID", false, null);
    url.searchParams.set("regions", regions.join(",")); url.searchParams.set("markets", markets.join(",")); url.searchParams.set("oddsFormat", "decimal"); url.searchParams.set("dateFormat", "iso");
    const context: OddsRequestContext = Object.freeze({ endpointKey: "odds-by-sport", sportKey: input.sportKey, regions, markets, commenceTimeFrom: from, commenceTimeTo: to });
    const result = await this.request(url, context, z.array(eventSchema));
    return Object.freeze({ ...result, events: result.payload });
  }

  private sportUrl(input: Readonly<{ sportKey: string; commenceTimeFrom: string; commenceTimeTo: string }>, suffix: "events" | "odds"): Readonly<{ url: URL; from: string; to: string }> {
    if (!/^soccer_[a-z0-9_]+$/u.test(input.sportKey)) throw new TheOddsApiError("ODDS_SPORT_KEY_INVALID", false, null);
    const fromValue = Date.parse(input.commenceTimeFrom), toValue = Date.parse(input.commenceTimeTo);
    if (!Number.isFinite(fromValue) || !Number.isFinite(toValue) || fromValue >= toValue) throw new TheOddsApiError("ODDS_TIME_WINDOW_INVALID", false, null);
    const from = providerUtcSecond(fromValue), to = providerUtcSecond(toValue);
    const url = new URL(`/v4/sports/${input.sportKey}/${suffix}/`, THE_ODDS_API_BASE_URL); url.searchParams.set("commenceTimeFrom", from); url.searchParams.set("commenceTimeTo", to);
    return Object.freeze({ url, from, to });
  }

  private async request<T>(url: URL, context: OddsRequestContext, schema: z.ZodType<readonly T[]>): Promise<ApiResult<T>> {
    url.searchParams.set("apiKey", this.options.apiKey);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    try {
      const response = await this.options.fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: "application/json" } });
      const capturedAtUtc = this.options.clock.nowUtc(); const quota = quotaFrom(response.headers);
      if (response.status >= 300 && response.status < 400) throw new TheOddsApiError("ODDS_REDIRECT_BLOCKED", true, response.status);
      const rawBytes = new Uint8Array(await response.arrayBuffer());
      if (!response.ok) {
        const provider = sanitizedProviderError(rawBytes, response.headers.get("content-type"), this.options.apiKey);
        const correlationId = truncateUtf8(response.headers.get("x-request-id") ?? response.headers.get("x-correlation-id") ?? response.headers.get("cf-ray") ?? randomUUID(), 200);
        const evidenceDocument = { version: "odds-provider-error/1.0.0", httpStatus: response.status, providerErrorCode: provider.code, providerErrorMessage: provider.message, endpointLogical: context.endpointKey, sportKey: context.sportKey, regions: context.regions, markets: context.markets, commenceTimeFrom: context.commenceTimeFrom, commenceTimeTo: context.commenceTimeTo, quota, correlationId, capturedAtUtc };
        const evidenceBytes = new TextEncoder().encode(JSON.stringify(evidenceDocument));
        const failure: OddsProviderFailure = Object.freeze({ httpStatus: response.status, providerErrorCode: provider.code, providerErrorMessage: provider.message, request: context, quota, correlationId, capturedAtUtc, evidenceBytes });
        throw new TheOddsApiError("ODDS_PROVIDER_RESPONSE", true, response.status, failure);
      }
      if (rawBytes.byteLength === 0 || rawBytes.byteLength > (this.options.maxBytes ?? 5_000_000)) throw new TheOddsApiError("ODDS_RESPONSE_SIZE_INVALID", true, response.status);
      if (new TextDecoder().decode(rawBytes).includes(this.options.apiKey)) throw new TheOddsApiError("ODDS_SECRET_REFLECTED", true, response.status);
      let document: unknown; try { document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes)); } catch { throw new TheOddsApiError("ODDS_JSON_INVALID", true, response.status); }
      const parsed = schema.safeParse(document); if (!parsed.success) throw new TheOddsApiError("ODDS_ENVELOPE_INVALID", true, response.status);
      return Object.freeze({ payload: Object.freeze([...parsed.data]), rawBytes, capturedAtUtc, httpStatus: response.status, quota, request: context });
    } finally { clearTimeout(timer); }
  }
}
