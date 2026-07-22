export const FOREBET_SOURCE = "FOREBET" as const;
export const FOREBET_PARSER_VERSION = "forebet-ou25-es/1.0.0";
export const FOREBET_ALLOWED_DATE = "2026-07-21";
export const FOREBET_ORIGIN = "https://www.forebet.com";
export const FOREBET_PATH_PREFIX = "/es/predicciones-de-futbol/predicciones-bajo-mas-2-5-goles/";

export function validateSportDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_DATE_FORMAT");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("INVALID_DATE");
  if (value !== FOREBET_ALLOWED_DATE) throw new Error("DATE_NOT_AUTHORIZED");
  return value;
}

export function buildForebetUrl(date: string): URL {
  validateSportDate(date);
  return new URL(`${FOREBET_PATH_PREFIX}${date}`, FOREBET_ORIGIN);
}

export function assertAuthorizedForebetUrl(value: URL): void {
  const expected = buildForebetUrl(FOREBET_ALLOWED_DATE);
  if (value.protocol !== "https:" || value.hostname !== expected.hostname || value.port || value.pathname !== expected.pathname || value.search || value.hash) {
    throw new Error("UNAUTHORIZED_URL");
  }
}
