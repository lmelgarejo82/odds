import { validateStatareaDate } from "./constants";

export const STATAREA_LEGACY_SOURCE_PRESENTATION = "LEGACY_OFFICIAL" as const;
export const STATAREA_MODERN_SOURCE_PRESENTATION = "MODERN" as const;
export const STATAREA_LEGACY_ORIGIN = "https://old.statarea.com";
export const STATAREA_LEGACY_ENDPOINT_TEMPLATE = "https://old.statarea.com/predictions/YYYY-MM-DD";
export const STATAREA_MODERN_ENDPOINT_TEMPLATE = "https://www.statarea.com/predictions/date/YYYY-MM-DD/competition";
export const STATAREA_LEGACY_PARSER_VERSION = "statarea-legacy-daily-raw/1.0.0";
export const STATAREA_LEGACY_CAPTURE_POLICY_VERSION = "july-sequential-legacy-first-valid/1.1.0";
export const STATAREA_LEGACY_RAW_HEADERS = ["Tips", "Result", "1", "X", "2", "H1", "HX", "H2", "1.5", "2.5", "3.5", "hc1", "hcX", "hc2", "votación", "comentario"] as const;
export const STATAREA_LEGACY_PREDICTIVE_HEADERS = STATAREA_LEGACY_RAW_HEADERS.slice(2, 14);

export function buildLegacyStatareaUrl(date: string): URL {
  validateStatareaDate(date);
  return new URL(`/predictions/${date}`, STATAREA_LEGACY_ORIGIN);
}

export function assertAuthorizedLegacyStatareaUrl(value: URL): void {
  const match = value.pathname.match(/^\/predictions\/(\d{4}-\d{2}-\d{2})\/?$/);
  if (value.protocol !== "https:" || value.hostname !== "old.statarea.com" || value.port || !match || value.search || value.hash) throw new Error("UNAUTHORIZED_LEGACY_URL");
  validateStatareaDate(match[1]);
}
