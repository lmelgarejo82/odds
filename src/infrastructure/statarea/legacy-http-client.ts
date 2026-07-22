import { assertAuthorizedLegacyStatareaUrl, buildLegacyStatareaUrl } from "@/domain/statarea/legacy-constants";

export const STATAREA_LEGACY_TIMEOUT_MS = 20_000;
export const STATAREA_LEGACY_MAX_BYTES = 5_000_000;
export const STATAREA_LEGACY_MAX_REDIRECTS = 2;
export const STATAREA_LEGACY_REQUEST_HEADERS = Object.freeze({
  "user-agent": "OU25-Consensus-Lab/0.5 controlled-research",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
});

export type LegacyStatareaHttpResponse = Readonly<{ requestedUrl: string; finalUrl: string; hostname: "old.statarea.com"; capturedAt: Date; httpStatus: number; contentType: string; body: Buffer }>;

export async function fetchLegacyStatarea(date: string, fetchImpl: typeof fetch = fetch): Promise<LegacyStatareaHttpResponse> {
  const requested = buildLegacyStatareaUrl(date); let current = requested;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), STATAREA_LEGACY_TIMEOUT_MS);
  try {
    for (let redirect = 0; redirect <= STATAREA_LEGACY_MAX_REDIRECTS; redirect++) {
      assertAuthorizedLegacyStatareaUrl(current);
      const response = await fetchImpl(current, { redirect: "manual", signal: controller.signal, headers: STATAREA_LEGACY_REQUEST_HEADERS });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location"); if (!location) throw new Error("REDIRECT_WITHOUT_LOCATION");
        current = new URL(location, current); assertAuthorizedLegacyStatareaUrl(current); continue;
      }
      const declared = Number(response.headers.get("content-length") ?? 0); if (declared > STATAREA_LEGACY_MAX_BYTES) throw new Error("RESPONSE_TOO_LARGE");
      const body = Buffer.from(await response.arrayBuffer()); if (body.byteLength > STATAREA_LEGACY_MAX_BYTES) throw new Error("RESPONSE_TOO_LARGE");
      return Object.freeze({ requestedUrl: requested.toString(), finalUrl: current.toString().replace(/\/$/, ""), hostname: "old.statarea.com", capturedAt: new Date(), httpStatus: response.status, contentType: response.headers.get("content-type") ?? "", body });
    }
    throw new Error("TOO_MANY_REDIRECTS");
  } finally { clearTimeout(timeout); }
}
