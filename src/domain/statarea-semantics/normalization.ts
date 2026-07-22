import Decimal from "decimal.js";

export type ParsedSourcePercent = { raw: string; trimmed: string; value: Decimal; decimalPlaces: number };

export function parseSourcePercent(raw: string): ParsedSourcePercent {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d+(?:[.,]\d+)?)%$/);
  if (!match) throw new Error(`INVALID_SOURCE_PERCENT_FORMAT:${raw}`);
  const value = new Decimal(match[1].replace(",", "."));
  if (value.lt(0) || value.gt(100)) throw new Error(`SOURCE_PERCENT_OUT_OF_RANGE:${raw}`);
  return { raw, trimmed, value, decimalPlaces: value.decimalPlaces() };
}

export function requireRange(value: Decimal, field: string) {
  if (value.lt(0) || value.gt(100)) throw new Error(`DERIVED_SOURCE_PERCENT_OUT_OF_RANGE:${field}:${value.toString()}`);
  return value;
}

export function deriveSemanticValues(values: Record<string, Decimal>) {
  const required = ["sourceHomeWinPercent", "sourceDrawPercent", "sourceAwayWinPercent", "sourceOver15Percent", "sourceOver25Percent", "sourceOver35Percent"];
  for (const field of required) if (!values[field]) throw new Error(`DERIVATION_COMPONENT_MISSING:${field}`);
  return {
    sourceUnder15Percent: requireRange(new Decimal(100).minus(values.sourceOver15Percent), "sourceUnder15Percent"),
    sourceUnder25Percent: requireRange(new Decimal(100).minus(values.sourceOver25Percent), "sourceUnder25Percent"),
    sourceUnder35Percent: requireRange(new Decimal(100).minus(values.sourceOver35Percent), "sourceUnder35Percent"),
    sourceDoubleChance1XPercent: requireRange(values.sourceHomeWinPercent.plus(values.sourceDrawPercent), "sourceDoubleChance1XPercent"),
    sourceDoubleChanceX2Percent: requireRange(values.sourceDrawPercent.plus(values.sourceAwayWinPercent), "sourceDoubleChanceX2Percent"),
    sourceDoubleChance12Percent: requireRange(values.sourceHomeWinPercent.plus(values.sourceAwayWinPercent), "sourceDoubleChance12Percent"),
  };
}
