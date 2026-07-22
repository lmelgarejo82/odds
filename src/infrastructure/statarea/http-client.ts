import {
  assertAuthorizedStatareaUrl,
  buildStatareaUrl,
} from "@/domain/statarea/constants";
export const STATAREA_TIMEOUT_MS = 20_000;
export const STATAREA_MAX_BYTES = 5_000_000;
export const STATAREA_MAX_REDIRECTS = 2;
export type StatareaHttpResponse = Readonly<{
  requestedUrl: string;
  finalUrl: string;
  hostname: string;
  capturedAt: Date;
  httpStatus: number;
  contentType: string;
  body: Buffer;
}>;
export async function fetchStatarea(
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StatareaHttpResponse> {
  const requested = buildStatareaUrl(date);
  let current = requested;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATAREA_TIMEOUT_MS);
  try {
    for (let redirect = 0; redirect <= STATAREA_MAX_REDIRECTS; redirect++) {
      assertAuthorizedStatareaUrl(current);
      const response = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "OU25-Consensus-Lab/0.3 controlled-research",
          accept: "text/html",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("REDIRECT_WITHOUT_LOCATION");
        const next = new URL(location, current);
        assertAuthorizedStatareaUrl(next);
        current = next;
        continue;
      }
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > STATAREA_MAX_BYTES)
        throw new Error("RESPONSE_TOO_LARGE");
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > STATAREA_MAX_BYTES)
        throw new Error("RESPONSE_TOO_LARGE");
      return Object.freeze({
        requestedUrl: requested.toString(),
        finalUrl: current.toString(),
        hostname: current.hostname,
        capturedAt: new Date(),
        httpStatus: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body,
      });
    }
    throw new Error("TOO_MANY_REDIRECTS");
  } finally {
    clearTimeout(timeout);
  }
}
