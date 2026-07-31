import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createEvaluationInput } from "@/domain/market-v2/evaluation/evaluation-repository";
import type { PreMatchDecisionRecord } from "@/domain/market-v2/decision/types";
import type { OutcomeRecord } from "@/domain/market-v2/outcome/outcome-repository";

const repositoryRoot = process.cwd();
const schemaPath = resolve(repositoryRoot, "prisma/market-v2/schema.prisma");
const migrationPath = resolve(
  repositoryRoot,
  "prisma/market-v2/migrations/20260731000000_initial/migration.sql",
);
const decisionDirectory = resolve(repositoryRoot, "src/domain/market-v2/decision");

describe("Market V2 architecture boundaries", () => {
  it("keeps forbidden post-match imports out of decision modules", () => {
    const decisionSources = readdirSync(decisionDirectory)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(resolve(decisionDirectory, file), "utf8"))
      .join("\n");

    expect(decisionSources).not.toMatch(/from\s+["'][^"']*(outcome|settlement|evaluation)/i);
  });

  it("limits DecisionInputRepository to pre-match input families", () => {
    const port = readFileSync(resolve(decisionDirectory, "decision-input-repository.ts"), "utf8");
    expect(port).toContain("getFixture");
    expect(port).toContain("listForebetSnapshots");
    expect(port).toContain("listOddsSnapshots");
    expect(port).toContain("listMarketProbabilitySnapshots");
    expect(port).not.toMatch(/Outcome|Settlement|DecisionEvaluation/);
  });

  it("allows evaluation to combine an immutable decision and outcome", () => {
    const decision: PreMatchDecisionRecord = {
      id: "decision-1",
      fixtureId: "fixture-1",
      decidedAtUtc: "2026-08-01T17:30:00Z",
      status: "ABSTAINED",
      reasonCode: "NO_ELIGIBLE_PRICE",
      policyVersion: "policy-v1",
      inputHash: "input-hash",
    };
    const outcome: OutcomeRecord = {
      id: "outcome-1",
      fixtureId: "fixture-1",
      observedAtUtc: "2026-08-01T20:00:00Z",
      homeScore: 1,
      awayScore: 1,
      result1X2: "DRAW",
      status: "CONFIRMED",
      contentHash: "outcome-hash",
    };

    expect(createEvaluationInput(decision, outcome)).toEqual({ decision, outcome });
  });
});

describe("Market V2 Prisma isolation", () => {
  it("uses a dedicated client and an authorized database path", () => {
    const schema = readFileSync(schemaPath, "utf8");
    expect(schema).toContain('output   = "../../src/generated/market-v2-client"');
    expect(schema).toContain('url      = "file:../../var/market-v2/market-v2.sqlite"');
    expect(schema).not.toContain("DATABASE_URL");
    expect(schema).not.toContain("dev.db");

    const databasePath = resolve(resolve(schemaPath, ".."), "../../var/market-v2/market-v2.sqlite");
    expect(databasePath).toBe(resolve(repositoryRoot, "var/market-v2/market-v2.sqlite"));
    expect(databasePath.startsWith(`${repositoryRoot}/`)).toBe(true);
    expect(existsSync(databasePath)).toBe(false);
  });

  it("declares every required append-only trigger pair", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const requiredTables = [
      "SourceArtifact",
      "ForebetSnapshot",
      "OddsSnapshot",
      "MarketProbabilitySnapshot",
      "PreMatchDecision",
      "Outcome",
      "Settlement",
    ];
    for (const table of requiredTables) {
      expect(migration).toContain(`market_v2_${table}_no_update`);
      expect(migration).toContain(`market_v2_${table}_no_delete`);
    }
  });
});
