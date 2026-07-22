import Decimal from "decimal.js";
import { deriveSemanticValues, parseSourcePercent } from "@/domain/statarea-semantics/normalization";
import { DIRECT_RAW_FIELDS } from "@/domain/statarea-semantics/quality";

type RawColumn = { headerRaw: string; valueRaw: string };
export type ProspectiveSemanticInput = Readonly<{ id: string; rawColumnsJson: string }>;

export function projectProspectiveSemanticRow(row: ProspectiveSemanticInput) {
  const columns = new Map((JSON.parse(row.rawColumnsJson) as RawColumn[]).map((column) => [column.headerRaw, column.valueRaw]));
  const values: Record<string, Decimal> = {};
  const warnings: string[] = [];
  for (const [rawHeader, canonicalField] of Object.entries(DIRECT_RAW_FIELDS)) {
    const raw = columns.get(rawHeader);
    if (raw === undefined) { warnings.push(`MISSING_${canonicalField}`); continue; }
    try { values[canonicalField] = parseSourcePercent(raw).value; }
    catch { warnings.push(`INVALID_${canonicalField}`); }
  }
  let derived: ReturnType<typeof deriveSemanticValues> | null = null;
  try { derived = deriveSemanticValues(values); }
  catch { warnings.push("DERIVATION_COMPONENT_MISSING_OR_INVALID"); }
  const ou25SemanticReady = Boolean(values.sourceOver25Percent && derived?.sourceUnder25Percent);
  const doubleChanceSemanticReady = Boolean(derived?.sourceDoubleChance1XPercent && derived.sourceDoubleChanceX2Percent && derived.sourceDoubleChance12Percent);
  const qualityStatus = ou25SemanticReady && doubleChanceSemanticReady ? "READY_WITH_WARNINGS" as const : "INSUFFICIENT" as const;
  return {
    rawRowId: row.id,
    sourceHomeWinPercent: values.sourceHomeWinPercent ?? null,
    sourceDrawPercent: values.sourceDrawPercent ?? null,
    sourceAwayWinPercent: values.sourceAwayWinPercent ?? null,
    sourceDoubleChance1XPercent: derived?.sourceDoubleChance1XPercent ?? null,
    sourceDoubleChanceX2Percent: derived?.sourceDoubleChanceX2Percent ?? null,
    sourceDoubleChance12Percent: derived?.sourceDoubleChance12Percent ?? null,
    sourceOver25Percent: values.sourceOver25Percent ?? null,
    sourceUnder25Percent: derived?.sourceUnder25Percent ?? null,
    ou25SemanticReady,
    doubleChanceSemanticReady,
    qualityStatus,
    warnings: [...new Set(["TIPS_UNVERIFIED", "HANDICAP_0_1_ANALYSIS_DISABLED", ...warnings])],
  };
}
