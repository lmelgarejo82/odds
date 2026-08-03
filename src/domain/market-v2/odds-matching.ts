import { normalizeName, type DiscoveredFixture } from "./daily-analysis";

export const ODDS_MATCHING_POLICY=Object.freeze({version:"odds-matching/1.0.0",kickoffToleranceMinutes:15,orientation:"DIRECT" as const});
export type OddsMatchCode="USABLE_ODDS_AVAILABLE"|"ODDS_EVENT_NOT_FOUND"|"ODDS_FIXTURE_AMBIGUOUS"|"ODDS_KICKOFF_OUTSIDE_TOLERANCE"|"ODDS_TEAM_NAME_MISMATCH";
export type OddsEventIdentity=Readonly<{id:string;homeName:string;awayName:string;kickoffAtUtc:string;competitionName?:string}>;

export function diagnoseOddsFixture(fixture:DiscoveredFixture,events:readonly OddsEventIdentity[]):Readonly<{code:OddsMatchCode;matchedEventId?:string;method:string;confidence:string;compared:Readonly<Record<string,string|number>>;warnings:readonly string[]}>{
  if(events.length===0)return {code:"ODDS_EVENT_NOT_FOUND",method:ODDS_MATCHING_POLICY.version,confidence:"NONE",compared:{candidateEvents:0},warnings:[]};
  const directNames=events.filter((event)=>normalizeName(event.homeName)===normalizeName(fixture.homeName)&&normalizeName(event.awayName)===normalizeName(fixture.awayName));
  if(directNames.length===0)return {code:"ODDS_TEAM_NAME_MISMATCH",method:ODDS_MATCHING_POLICY.version,confidence:"NONE",compared:{candidateEvents:events.length,home:fixture.homeName,away:fixture.awayName},warnings:[]};
  const within=directNames.filter((event)=>Math.abs(Date.parse(event.kickoffAtUtc)-Date.parse(fixture.kickoffAtUtc))<=ODDS_MATCHING_POLICY.kickoffToleranceMinutes*60_000);
  if(within.length===0)return {code:"ODDS_KICKOFF_OUTSIDE_TOLERANCE",method:ODDS_MATCHING_POLICY.version,confidence:"NONE",compared:{nameMatches:directNames.length,toleranceMinutes:ODDS_MATCHING_POLICY.kickoffToleranceMinutes},warnings:[]};
  if(within.length!==1)return {code:"ODDS_FIXTURE_AMBIGUOUS",method:ODDS_MATCHING_POLICY.version,confidence:"AMBIGUOUS",compared:{matches:within.length},warnings:["MULTIPLE_DIRECT_MATCHES"]};
  return {code:"USABLE_ODDS_AVAILABLE",matchedEventId:within[0].id,method:ODDS_MATCHING_POLICY.version,confidence:"EXACT",compared:{kickoffDeltaSeconds:Math.abs(Date.parse(within[0].kickoffAtUtc)-Date.parse(fixture.kickoffAtUtc))/1000,orientation:"DIRECT"},warnings:[]};
}
