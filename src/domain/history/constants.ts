export const HISTORY_CODE = "OU25-JULY-2026-V1";
export const HISTORY_VERSION = "1.0.0";
export const CAPTURE_POLICY_VERSION = "july-sequential-legacy-first-valid/1.1.0";
export const HISTORY_FROM = "2026-07-01";
export const HISTORY_TO = "2026-07-21";
export const DISCOVERY_TO = "2026-07-14";
export const VALIDATION_FROM = "2026-07-15";
export const PINNED_FOREBET_ID = "cmrw4hyk90003qw204t6pb1j5";
export const PINNED_FOREBET_HASH = "41539d0e0e1ec9a5dadd7a144a79e5d14a31878a5de0fedffdf54c20c9946c6b";
export const PINNED_FOREBET_01_HASH = "12d9613b55d82ae74086fdcfdfa8c2a067e11e06fb85f5a20db3a4dffa1e8c17";
export const CAPTURE_MINIMUM_PAUSE_MS = 5_000;

export function historyDates(): string[] { return Array.from({ length: 21 }, (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`); }
export function validateHistoryRange(from: string, to: string): void { if (from !== HISTORY_FROM || to !== HISTORY_TO) throw new Error("HISTORY_RANGE_NOT_AUTHORIZED"); }
export function historyPartition(date: string): "DISCOVERY" | "VALIDATION" { return date <= DISCOVERY_TO ? "DISCOVERY" : "VALIDATION"; }
