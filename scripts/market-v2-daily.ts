import { randomUUID } from "node:crypto";
import { classifyDailyFailure, parseDailyArguments, runDaily } from "@/infrastructure/market-v2/daily/runtime";

async function main() {
  try {
    const args = parseDailyArguments(process.argv.slice(2));
    const result = await runDaily(args, { apiFootballKey: () => process.env.API_FOOTBALL_KEY, oddsApiKey: () => process.env.THE_ODDS_API_KEY, fetchImpl: globalThis.fetch });
    const fields = [["RUN_COMPLETE",true],["RUN_ID",result.runId],["SPORTS_DATE",args.sportsDate],["RUN_MODE",result.runMode],["FIXTURES_DISCOVERED",result.fixturesDiscovered],["FIXTURES_ELIGIBLE",result.fixturesEligible],["FIXTURES_DEEP_ANALYZED",result.fixturesDeepAnalyzed],["FIXTURES_EXCLUDED",result.fixturesExcluded],["RECOMMENDATIONS",result.recommendations],["VALUE_DETECTED",result.valueDetected],["MODEL_REVIEW",result.modelReview],["WATCH",result.watch],["PASS",result.pass],["CALIBRATION_STATUS","BOOTSTRAP"],["HISTORICAL_CALIBRATION_AVAILABLE",result.historicalCalibrationAvailable],["ODDS_AVAILABLE",result.oddsAvailable],["ODDS_RESPONSE_RECEIVED",result.oddsResponseReceived],["ODDS_EVENTS_RECEIVED",result.oddsEventsReceived],["ODDS_FIXTURES_MATCHED",result.oddsFixturesMatched],["ODDS_MARKETS_MATCHED",result.oddsMarketsMatched],["USABLE_ODDS_AVAILABLE",result.usableOddsAvailable],["MARKET_EVALUATIONS_CREATED",result.marketEvaluationsCreated],["MARKET_VALUE_CALCULATED",result.marketValueCalculated],["API_FOOTBALL_BUDGET",result.apiFootballBudget],["API_FOOTBALL_REQUESTS",result.apiFootballRequests],["ODDS_BUDGET",result.oddsBudget],["ODDS_REQUESTS",result.oddsRequests],["NETWORK_USED",result.networkUsed],["REPLAYED",result.replayed],["AUTOMATED_BETTING",false],["EXIT",0]] as const;
    for (const [key,value] of fields) console.log(`${key} ${String(value)}`);
  } catch (error) { console.error(`RUN_FAILED ${classifyDailyFailure(error)}`); console.error(`CORRELATION_ID ${randomUUID()}`); console.error("EXIT 1"); process.exitCode=1; }
}
void main();
