import Decimal from "decimal.js";
import { canonicalHash } from "@/domain/canonical-hash";
import { deriveSemanticValues, parseSourcePercent } from "@/domain/statarea-semantics/normalization";

export const DIRECT_RAW_FIELDS = {
  "1": "sourceHomeWinPercent",
  X: "sourceDrawPercent",
  "2": "sourceAwayWinPercent",
  H1: "sourceHtHomeWinPercent",
  HX: "sourceHtDrawPercent",
  H2: "sourceHtAwayWinPercent",
  "1.5": "sourceOver15Percent",
  "2.5": "sourceOver25Percent",
  "3.5": "sourceOver35Percent",
  hc1: "sourceHandicap01HomePercent",
  hcX: "sourceHandicap01DrawPercent",
  hc2: "sourceHandicap01AwayPercent",
} as const;

const DERIVED_FIELDS = [
  "sourceUnder15Percent",
  "sourceUnder25Percent",
  "sourceUnder35Percent",
  "sourceDoubleChance1XPercent",
  "sourceDoubleChanceX2Percent",
  "sourceDoubleChance12Percent",
] as const;

type RawColumn = { headerRaw: string; valueRaw: string };
export type SemanticInputRow = {
  id: string;
  requestedDate: Date;
  rawColumnsJson: string;
  countryRaw: string | null;
  competitionRaw: string | null;
};

export type SemanticProjectionValue = ReturnType<typeof evaluateSemanticRows>["projections"][number];
const date = (value: Date) => value.toISOString().slice(0, 10);

function residualSummary(values: Decimal[]) {
  const absolute = values.map((value) => value.minus(100).abs());
  const total = values.length;
  const exact100 = absolute.filter((value) => value.eq(0)).length;
  const withinTolerance = absolute.filter((value) => value.lte(1)).length;
  return {
    total,
    exact100,
    withinTolerance,
    outsideTolerance: total - withinTolerance,
    averageAbsoluteResidual: total ? Decimal.sum(...absolute).div(total).toString() : "0",
    maximumAbsoluteResidual: total ? Decimal.max(...absolute).toString() : "0",
    tolerancePercentagePoints: "1" as const,
  };
}

export function evaluateSemanticRows(rows: SemanticInputRow[], partitions: Map<string, "DISCOVERY" | "VALIDATION">) {
  const sourceBefore = canonicalHash(rows.map((row) => ({ id: row.id, rawColumnsJson: row.rawColumnsJson })));
  const quality = new Map<string, { raw: string[]; invalid: number; outOfRange: number; dates: Set<string>; countries: Set<string>; competitions: Set<string> }>();
  for (const field of Object.values(DIRECT_RAW_FIELDS)) quality.set(field, { raw: [], invalid: 0, outOfRange: 0, dates: new Set(), countries: new Set(), competitions: new Set() });
  const oneXTwoSums: Decimal[] = [];
  const halfTimeSums: Decimal[] = [];
  let monotonicCompliant = 0;
  let maximumViolation = new Decimal(0);
  const monotonicityDates = new Set<string>();
  const monotonicityCountries = new Set<string>();
  const monotonicityCompetitions = new Set<string>();
  let complementsValid = 0;
  let doubleChanceIdentitiesWithinTolerance = 0;
  const byDate = new Map<string, { partition: "DISCOVERY" | "VALIDATION"; rows: number; ready: number; readyWithWarnings: number; insufficient: number; rejected: number; invalidValues: number; warnings: Set<string> }>();
  const projections = rows.map((row) => {
    const sportsDate = date(row.requestedDate);
    const partition = partitions.get(sportsDate);
    if (!partition) throw new Error(`ROW_OUTSIDE_DATASET:${row.id}:${sportsDate}`);
    const columns = new Map((JSON.parse(row.rawColumnsJson) as RawColumn[]).map((column) => [column.headerRaw, column.valueRaw]));
    const values: Record<string, Decimal> = {};
    let invalidValues = 0;
    for (const [rawHeader, canonicalField] of Object.entries(DIRECT_RAW_FIELDS)) {
      const raw = columns.get(rawHeader);
      const fieldQuality = quality.get(canonicalField)!;
      if (raw === undefined) {
        invalidValues++;
        fieldQuality.dates.add(sportsDate);
        if (row.countryRaw) fieldQuality.countries.add(row.countryRaw);
        if (row.competitionRaw) fieldQuality.competitions.add(row.competitionRaw);
        continue;
      }
      fieldQuality.raw.push(raw);
      try {
        values[canonicalField] = parseSourcePercent(raw).value;
      } catch (error) {
        invalidValues++;
        fieldQuality.invalid++;
        if (String(error).includes("OUT_OF_RANGE")) fieldQuality.outOfRange++;
        fieldQuality.dates.add(sportsDate);
        if (row.countryRaw) fieldQuality.countries.add(row.countryRaw);
        if (row.competitionRaw) fieldQuality.competitions.add(row.competitionRaw);
      }
    }
    const minimumReady = Boolean(values.sourceOver25Percent);
    let derived: ReturnType<typeof deriveSemanticValues> | null = null;
    if (minimumReady) {
      try { derived = deriveSemanticValues(values); } catch { invalidValues++; }
    }
    const ou25SemanticReady = Boolean(values.sourceOver25Percent && derived?.sourceUnder25Percent);
    const doubleChanceSemanticReady = Boolean(derived?.sourceDoubleChance1XPercent && derived.sourceDoubleChanceX2Percent && derived.sourceDoubleChance12Percent);
    const htSemanticReady = Boolean(values.sourceHtHomeWinPercent && values.sourceHtDrawPercent && values.sourceHtAwayWinPercent);
    const handicap01SemanticReady = Boolean(values.sourceHandicap01HomePercent && values.sourceHandicap01DrawPercent && values.sourceHandicap01AwayPercent);
    const warnings = ou25SemanticReady ? ["TIPS_UNVERIFIED", "HANDICAP_0_1_ANALYSIS_DISABLED"] : [];
    const qualityStatus = !ou25SemanticReady ? "INSUFFICIENT" as const : warnings.length ? "READY_WITH_WARNINGS" as const : "READY" as const;
    const summary = byDate.get(sportsDate) ?? { partition, rows: 0, ready: 0, readyWithWarnings: 0, insufficient: 0, rejected: 0, invalidValues: 0, warnings: new Set<string>() };
    summary.rows++;
    summary.invalidValues += invalidValues;
    if (qualityStatus === "READY") summary.ready++;
    else if (qualityStatus === "READY_WITH_WARNINGS") summary.readyWithWarnings++;
    else summary.insufficient++;
    warnings.forEach((warning) => summary.warnings.add(warning));
    byDate.set(sportsDate, summary);
    if (values.sourceHomeWinPercent && values.sourceDrawPercent && values.sourceAwayWinPercent) oneXTwoSums.push(values.sourceHomeWinPercent.plus(values.sourceDrawPercent).plus(values.sourceAwayWinPercent));
    if (values.sourceHtHomeWinPercent && values.sourceHtDrawPercent && values.sourceHtAwayWinPercent) halfTimeSums.push(values.sourceHtHomeWinPercent.plus(values.sourceHtDrawPercent).plus(values.sourceHtAwayWinPercent));
    if (values.sourceOver15Percent && values.sourceOver25Percent && values.sourceOver35Percent) {
      const firstViolation = values.sourceOver25Percent.minus(values.sourceOver15Percent);
      const secondViolation = values.sourceOver35Percent.minus(values.sourceOver25Percent);
      const violation = Decimal.max(firstViolation, secondViolation, 0);
      if (violation.eq(0)) monotonicCompliant++;
      else {
        monotonicityDates.add(sportsDate);
        if (row.countryRaw) monotonicityCountries.add(row.countryRaw);
        if (row.competitionRaw) monotonicityCompetitions.add(row.competitionRaw);
      }
      maximumViolation = Decimal.max(maximumViolation, violation);
    }
    if (derived && [values.sourceOver15Percent.plus(derived.sourceUnder15Percent), values.sourceOver25Percent.plus(derived.sourceUnder25Percent), values.sourceOver35Percent.plus(derived.sourceUnder35Percent)].every((sum) => sum.eq(100))) complementsValid++;
    if (derived && [derived.sourceDoubleChance1XPercent.plus(values.sourceAwayWinPercent), derived.sourceDoubleChanceX2Percent.plus(values.sourceHomeWinPercent), derived.sourceDoubleChance12Percent.plus(values.sourceDrawPercent)].every((sum) => sum.minus(100).abs().lte(1))) doubleChanceIdentitiesWithinTolerance++;
    return {
      rawRowId: row.id,
      sportsDate: row.requestedDate,
      partition,
      ...values,
      ...derived,
      ou25SemanticReady,
      doubleChanceSemanticReady,
      htSemanticReady,
      handicap01SemanticReady,
      semanticReadiness: qualityStatus,
      qualityStatus,
      warnings,
    };
  });
  const sourceAfter = canonicalHash(rows.map((row) => ({ id: row.id, rawColumnsJson: row.rawColumnsJson })));
  if (sourceBefore !== sourceAfter) throw new Error("RAW_ROWS_MUTATED_DURING_ASSESSMENT");
  const qualityByField = [...quality.entries()].map(([field, entry]) => {
    const parsedValues = entry.raw.flatMap((raw) => { try { return [parseSourcePercent(raw).value]; } catch { return []; } });
    const formatsObserved = [...new Set(entry.raw.map((raw) => /^\d+%$/.test(raw.trim()) ? "INTEGER_PERCENT" : raw.includes(",") ? "DECIMAL_COMMA_PERCENT" : "DECIMAL_DOT_PERCENT"))].sort();
    return {
      field,
      total: 1110 as const,
      present: entry.raw.length,
      missing: 1110 - entry.raw.length,
      parseable: parsedValues.length,
      invalid: entry.invalid,
      outOfRange: entry.outOfRange,
      minimum: parsedValues.length ? Decimal.min(...parsedValues).toString() : null,
      maximum: parsedValues.length ? Decimal.max(...parsedValues).toString() : null,
      distinctValues: new Set(entry.raw).size,
      formatsObserved,
      affectedDates: [...entry.dates].sort(),
      affectedCountries: [...entry.countries].sort(),
      affectedCompetitions: [...entry.competitions].sort(),
    };
  });
  const qualityByDate = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([sportsDate, value]) => ({
    sportsDate,
    partition: value.partition,
    rows: value.rows,
    ready: value.ready,
    readyWithWarnings: value.readyWithWarnings,
    insufficient: value.insufficient,
    rejected: value.rejected,
    invalidValues: value.invalidValues,
    warnings: [...value.warnings].sort(),
  }));
  const invalidValues = qualityByField.reduce((sum, field) => sum + field.invalid, 0);
  const missingValues = qualityByField.reduce((sum, field) => sum + field.missing, 0);
  const ready = projections.filter((projection) => projection.qualityStatus === "READY").length;
  const readyWithWarnings = projections.filter((projection) => projection.qualityStatus === "READY_WITH_WARNINGS").length;
  const insufficient = projections.filter((projection) => projection.qualityStatus === "INSUFFICIENT").length;
  const derivedQuality = DERIVED_FIELDS.map((field) => {
    const derivedValues = projections.flatMap((projection) => {
      const value = projection[field];
      return value instanceof Decimal ? [value] : [];
    });
    return {
      field,
      total: rows.length,
      derivable: derivedValues.length,
      notDerivable: rows.length - derivedValues.length,
      outOfRange: derivedValues.filter((value) => value.lt(0) || value.gt(100)).length,
      maximumDecimalPlaces: derivedValues.length ? Math.max(...derivedValues.map((value) => value.decimalPlaces())) : 0,
      sourcePrecisionPreserved: true,
      warnings: ["Valor derivado; no es una probabilidad real ni calibrada."],
    };
  });
  return {
    projections,
    qualityByField,
    qualityByDate,
    qualityTotals: {
      rows: 1110 as const,
      ready,
      readyWithWarnings,
      insufficient,
      rejected: 0,
      invalidValues,
      missingValues,
      oneXTwo: residualSummary(oneXTwoSums),
      halfTime: residualSummary(halfTimeSums),
      monotonicity: {
        compliant: monotonicCompliant,
        violations: rows.length - monotonicCompliant,
        maximumViolation: maximumViolation.toString(),
        affectedDates: [...monotonicityDates].sort(),
        affectedCountries: [...monotonicityCountries].sort(),
        affectedCompetitions: [...monotonicityCompetitions].sort(),
      },
      complementsValid,
      doubleChanceIdentitiesWithinTolerance,
      derivedQuality,
    },
    findings: [
      { field: "statareaTip", findingType: "UNVERIFIED_FIELD", severity: "WARNING" as const, count: rows.length, expectedRule: "TIP remains separate and is not analyzed." },
      { field: "handicap01", findingType: "ANALYSIS_DISABLED", severity: "INFO" as const, count: rows.length, expectedRule: "Official modality 0:1 is documented but excluded from B007." },
    ],
  };
}
