export const STATAREA_SOURCE="STATAREA" as const;
export const STATAREA_ALLOWED_DATE="2026-07-21";
export const STATAREA_ORIGIN="https://www.statarea.com";
export const STATAREA_PARSER_VERSION="statarea-daily-raw/1.0.0";
export const STATAREA_RAW_HEADERS=["TIP","1","X","2","HT1","HTX","HT2","1.5","2.5","3.5","BTS","OTS"] as const;
export const STATAREA_UNVERIFIED_HEADERS=["TIP","1.5","2.5","3.5","BTS","OTS"] as const;
export function validateStatareaDate(value:string):string{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error("INVALID_DATE_FORMAT");const parsed=new Date(`${value}T00:00:00.000Z`);if(Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==value)throw new Error("INVALID_DATE");if(value!==STATAREA_ALLOWED_DATE)throw new Error("DATE_NOT_AUTHORIZED");return value}
export function buildStatareaUrl(date:string):URL{validateStatareaDate(date);return new URL(`/predictions/date/${date}/competition`,STATAREA_ORIGIN)}
export function assertAuthorizedStatareaUrl(url:URL):void{const expected=buildStatareaUrl(STATAREA_ALLOWED_DATE);if(url.protocol!=="https:"||url.hostname!==expected.hostname||url.port||url.pathname!==expected.pathname||url.search||url.hash)throw new Error("UNAUTHORIZED_URL")}
