import { MATCH_CONFIGURATION } from "./configuration";

const entityMap: Record<string, string> = { amp: "&", apos: "'", quot: '"', nbsp: " ", lt: "<", gt: ">" };
const institutional = new Set<string>(MATCH_CONFIGURATION.institutionalTokens);

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|nbsp|lt|gt);/gi, (_, code: string) => {
    if (code[0] === "#") return String.fromCodePoint(Number.parseInt(code.slice(code[1]?.toLowerCase() === "x" ? 2 : 1), code[1]?.toLowerCase() === "x" ? 16 : 10));
    return entityMap[code.toLowerCase()] ?? _;
  });
}

export function normalizeIdentity(value: string): string {
  return decodeEntities(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/['".,/()\[\]{}:;!?&+_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function identityTokens(value: string): string[] { return normalizeIdentity(value).split(" ").filter(Boolean); }
export function institutionalCore(value: string): string {
  return identityTokens(value).filter((token) => !institutional.has(token)).sort().join(" ");
}

export type CategoryFlags = { gender: boolean; youth: boolean; reserve: boolean; bTeam: boolean; academy: boolean; amateur: boolean };
export function categoryFlags(...values: Array<string | null | undefined>): CategoryFlags {
  const tokens = new Set(values.flatMap((value) => identityTokens(value ?? "")));
  return {
    gender: ["women", "w", "ladies", "femenino"].some((token) => tokens.has(token)),
    youth: [...tokens].some((token) => /^(u(?:17|18|19|20|21|23)|youth|juvenil)$/.test(token)),
    reserve: tokens.has("reserve") || tokens.has("reserves"),
    bTeam: tokens.has("b") || tokens.has("ii") || tokens.has("2"),
    academy: tokens.has("academy"),
    amateur: tokens.has("amateur"),
  };
}

export function categoryConflict(left: CategoryFlags, right: CategoryFlags): string[] {
  const conflicts: string[] = [];
  for (const key of ["gender", "youth", "reserve", "bTeam", "academy", "amateur"] as const) if (left[key] !== right[key]) conflicts.push(`CATEGORY_${key.toUpperCase()}_CONFLICT`);
  return conflicts;
}

export function diceSimilarity(leftRaw: string, rightRaw: string): number {
  const left = normalizeIdentity(leftRaw); const right = normalizeIdentity(rightRaw);
  if (left === right) return 1;
  if (!left || !right) return 0;
  const grams = (value: string) => value.length < 2 ? [value] : Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
  const pool = grams(right); let hits = 0;
  for (const gram of grams(left)) { const index = pool.indexOf(gram); if (index >= 0) { hits++; pool.splice(index, 1); } }
  return (2 * hits) / (grams(left).length + grams(right).length);
}

const countries: Record<string, string> = { alemania: "germany", germany: "germany", suecia: "sweden", sweden: "sweden", "corea del sur": "south korea", "south korea": "south korea", uzbekistan: "uzbekistan", china: "china", australia: "australia", international: "international" };
export function contextEvidence(left: string | null, right: string | null, kind: "country" | "competition"): "EXACT" | "COMPATIBLE" | "MISSING_ONE_SIDE" | "UNVERIFIED" | "CONFLICT" {
  if (!left || !right) return "MISSING_ONE_SIDE";
  const a = normalizeIdentity(left); const b = normalizeIdentity(right);
  if (a === b) return "EXACT";
  if (kind === "country" && countries[a] && countries[b]) return countries[a] === countries[b] ? "COMPATIBLE" : "CONFLICT";
  if (kind === "competition" && (a.includes(b) || b.includes(a))) return "COMPATIBLE";
  return "UNVERIFIED";
}
