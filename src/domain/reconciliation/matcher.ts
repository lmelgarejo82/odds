import { MATCH_CONFIGURATION } from "./configuration";
import { categoryConflict, categoryFlags, contextEvidence, diceSimilarity, institutionalCore, normalizeIdentity } from "./normalizer";

export type IdentityRow = { id: string; homeTeamRaw: string; awayTeamRaw: string; competitionRaw: string | null; countryRaw: string | null; categoryRaw: string | null };
export type Candidate = { key: string; forebetId: string; statareaId: string; orientation: "DIRECT" | "REVERSED"; homeScore: number; awayScore: number; aggregateScore: number; marginToSecond: number | null; stage: "EXACT" | "CONSERVATIVE" | "APPROXIMATE" | "CONFLICT"; competitionEvidence: string; countryEvidence: string; categoryEvidence: string; evidence: Record<string, unknown>; rejectionReasons: string[]; rank: number };
export type Decision = { status: "MATCHED" | "AMBIGUOUS" | "ONLY_FOREBET" | "ONLY_STATAREA" | "CONFLICT"; forebetId: string | null; statareaId: string | null; candidateKey: string | null; reasonCode: string; reasons: string[]; warnings: string[]; confidenceClass: "EXACT" | "STRONG" | "REVIEW" | "UNRESOLVED" };

const round = (value: number) => Math.round(value * 10000) / 10000;
export function reconcileIdentities(forebet: IdentityRow[], statarea: IdentityRow[]): { candidates: Candidate[]; decisions: Decision[] } {
  const candidates: Candidate[] = [];
  for (const f of forebet) for (const s of statarea) {
    const directHome = diceSimilarity(f.homeTeamRaw, s.homeTeamRaw); const directAway = diceSimilarity(f.awayTeamRaw, s.awayTeamRaw);
    const reverseHome = diceSimilarity(f.homeTeamRaw, s.awayTeamRaw); const reverseAway = diceSimilarity(f.awayTeamRaw, s.homeTeamRaw);
    const fFlags = categoryFlags(f.homeTeamRaw, f.awayTeamRaw, f.categoryRaw); const sFlags = categoryFlags(s.homeTeamRaw, s.awayTeamRaw, s.categoryRaw);
    const conflicts = categoryConflict(fFlags, sFlags);
    const country = contextEvidence(f.countryRaw, s.countryRaw, "country"); const competition = contextEvidence(f.competitionRaw, s.competitionRaw, "competition");
    if (country === "CONFLICT") conflicts.push("COUNTRY_CONFLICT");
    const directPlausible = (directHome >= MATCH_CONFIGURATION.candidateMinimumPerSide && directAway >= MATCH_CONFIGURATION.candidateMinimumPerSide) || (conflicts.length > 0 && directHome >= MATCH_CONFIGURATION.conflictDetectionMinimumPerSide && directAway >= MATCH_CONFIGURATION.conflictDetectionMinimumPerSide);
    const reversedPlausible = reverseHome >= MATCH_CONFIGURATION.approximateMinimumPerSide && reverseAway >= MATCH_CONFIGURATION.approximateMinimumPerSide;
    if (!directPlausible && !reversedPlausible) continue;
    const orientation = reversedPlausible && (!directPlausible || reverseHome + reverseAway > directHome + directAway) ? "REVERSED" : "DIRECT";
    const homeScore = orientation === "DIRECT" ? directHome : reverseHome; const awayScore = orientation === "DIRECT" ? directAway : reverseAway;
    const exact = orientation === "DIRECT" && normalizeIdentity(f.homeTeamRaw) === normalizeIdentity(s.homeTeamRaw) && normalizeIdentity(f.awayTeamRaw) === normalizeIdentity(s.awayTeamRaw);
    const conservative = orientation === "DIRECT" && institutionalCore(f.homeTeamRaw) === institutionalCore(s.homeTeamRaw) && institutionalCore(f.awayTeamRaw) === institutionalCore(s.awayTeamRaw);
    const stage = orientation === "REVERSED" || conflicts.length ? "CONFLICT" : exact ? "EXACT" : conservative ? "CONSERVATIVE" : "APPROXIMATE";
    candidates.push({ key: `${f.id}:${s.id}:${orientation}`, forebetId: f.id, statareaId: s.id, orientation, homeScore: round(homeScore), awayScore: round(awayScore), aggregateScore: round(Math.min(homeScore, awayScore)), marginToSecond: null, stage, competitionEvidence: competition, countryEvidence: country, categoryEvidence: conflicts.length ? "CONFLICT" : "COMPATIBLE", evidence: { forebetNormalized: [normalizeIdentity(f.homeTeamRaw), normalizeIdentity(f.awayTeamRaw)], statareaNormalized: [normalizeIdentity(s.homeTeamRaw), normalizeIdentity(s.awayTeamRaw)], forebetCore: [institutionalCore(f.homeTeamRaw), institutionalCore(f.awayTeamRaw)], statareaCore: [institutionalCore(s.homeTeamRaw), institutionalCore(s.awayTeamRaw)] }, rejectionReasons: [...conflicts, ...(orientation === "REVERSED" ? ["REVERSED_ORIENTATION"] : [])], rank: 0 });
  }
  for (const f of forebet) {
    const ranked = candidates.filter((candidate) => candidate.forebetId === f.id).sort((a, b) => b.aggregateScore - a.aggregateScore || a.statareaId.localeCompare(b.statareaId));
    ranked.forEach((candidate, index) => { candidate.rank = index + 1; candidate.marginToSecond = index === 0 ? round(candidate.aggregateScore - (ranked[1]?.aggregateScore ?? 0)) : null; });
  }
  const proposals = new Map<string, Candidate>(); const decisions: Decision[] = [];
  for (const f of forebet) {
    const ranked = candidates.filter((candidate) => candidate.forebetId === f.id).sort((a, b) => a.rank - b.rank); const best = ranked[0];
    if (!best) { decisions.push({ status: "ONLY_FOREBET", forebetId: f.id, statareaId: null, candidateKey: null, reasonCode: "NO_COMPATIBLE_CANDIDATE", reasons: [], warnings: [], confidenceClass: "UNRESOLVED" }); continue; }
    if (best.stage === "CONFLICT") { decisions.push({ status: "CONFLICT", forebetId: f.id, statareaId: best.statareaId, candidateKey: best.key, reasonCode: best.rejectionReasons[0] ?? "MATERIAL_CONFLICT", reasons: best.rejectionReasons, warnings: [], confidenceClass: "REVIEW" }); continue; }
    const close = (best.marginToSecond ?? 0) < MATCH_CONFIGURATION.minimumMargin && ranked.length > 1;
    const strictApprox = best.homeScore >= MATCH_CONFIGURATION.approximateMinimumPerSide && best.awayScore >= MATCH_CONFIGURATION.approximateMinimumPerSide && best.aggregateScore >= MATCH_CONFIGURATION.approximateMinimumAggregate;
    if (close || (best.stage === "APPROXIMATE" && !strictApprox)) { decisions.push({ status: "AMBIGUOUS", forebetId: f.id, statareaId: null, candidateKey: best.key, reasonCode: close ? "INSUFFICIENT_MARGIN" : "FUZZY_BELOW_STRICT_THRESHOLD", reasons: [best.key], warnings: [], confidenceClass: "REVIEW" }); continue; }
    proposals.set(f.id, best);
  }
  const byStatarea = new Map<string, string[]>(); for (const [forebetId, candidate] of proposals) byStatarea.set(candidate.statareaId, [...(byStatarea.get(candidate.statareaId) ?? []), forebetId]);
  for (const [forebetId, best] of proposals) {
    if ((byStatarea.get(best.statareaId)?.length ?? 0) > 1) decisions.push({ status: "AMBIGUOUS", forebetId, statareaId: null, candidateKey: best.key, reasonCode: "ONE_TO_ONE_COLLISION", reasons: byStatarea.get(best.statareaId) ?? [], warnings: [], confidenceClass: "REVIEW" });
    else decisions.push({ status: "MATCHED", forebetId, statareaId: best.statareaId, candidateKey: best.key, reasonCode: `${best.stage}_UNIQUE_DIRECT`, reasons: [best.competitionEvidence, best.countryEvidence, best.categoryEvidence], warnings: [], confidenceClass: best.stage === "EXACT" ? "EXACT" : "STRONG" });
  }
  const claimed = new Set(decisions.filter((decision) => decision.statareaId !== null).map((decision) => decision.statareaId));
  for (const s of statarea) if (!claimed.has(s.id)) decisions.push({ status: "ONLY_STATAREA", forebetId: null, statareaId: s.id, candidateKey: null, reasonCode: "NO_SELECTED_FOREBET_COUNTERPART", reasons: [], warnings: [], confidenceClass: "UNRESOLVED" });
  return { candidates: candidates.sort((a, b) => a.forebetId.localeCompare(b.forebetId) || a.rank - b.rank), decisions };
}
