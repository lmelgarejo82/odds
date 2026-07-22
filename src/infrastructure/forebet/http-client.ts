import { assertAuthorizedForebetUrl, buildForebetUrl } from "@/domain/forebet/constants";

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 5_000_000;

export type ForebetHttpResponse = Readonly<{
  requestedUrl: string; finalUrl: string; capturedAt: Date; httpStatus: number;
  contentType: string; body: Buffer;
}>;

export async function fetchForebet(date: string): Promise<ForebetHttpResponse> {
  const requested = buildForebetUrl(date);
  assertAuthorizedForebetUrl(requested);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(requested, {
      redirect: "manual", signal: controller.signal,
      headers: { "user-agent": "OU25-Consensus-Lab/0.2 controlled-research", accept: "text/html" },
    });
    const finalUrl = new URL(response.url);
    assertAuthorizedForebetUrl(finalUrl);
    if (response.status >= 300 && response.status < 400) throw new Error("REDIRECT_NOT_ALLOWED");
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BYTES) throw new Error("RESPONSE_TOO_LARGE");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_BYTES) throw new Error("RESPONSE_TOO_LARGE");
    return Object.freeze({ requestedUrl: requested.toString(), finalUrl: finalUrl.toString(), capturedAt: new Date(), httpStatus: response.status, contentType: response.headers.get("content-type") ?? "", body });
  } finally { clearTimeout(timeout); }
}
