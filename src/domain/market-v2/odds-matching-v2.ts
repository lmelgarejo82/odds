import { normalizeProviderTeamName,PROVIDER_TEAM_ALIAS_REGISTRY_VERSION,scopeCompatible,type ProviderTeamAliasRecord } from "./provider-team-alias";

export const ODDS_MATCHING_V2_POLICY=Object.freeze({version:"odds-matching/2.0.0",registryVersion:PROVIDER_TEAM_ALIAS_REGISTRY_VERSION,kickoffToleranceMinutes:15,orientation:"DIRECT" as const});
export type OddsMatchV2Code="MATCHED_EXACT"|"MATCHED_APPROVED_ALIAS"|"EVENT_NOT_FOUND"|"KICKOFF_OUTSIDE_TOLERANCE"|"HOME_ALIAS_MISSING"|"AWAY_ALIAS_MISSING"|"TEAM_ALIAS_AMBIGUOUS"|"SCOPE_MISMATCH"|"MULTIPLE_EVENTS"|"ORIENTATION_MISMATCH";
export type OddsIdentityEvent=Readonly<{id:string;homeName:string;awayName:string;kickoffAtUtc:string;sportKey?:string;sportTitle?:string}>;
export type CanonicalOddsFixture=Readonly<{fixtureId:string;homeTeamId:string;awayTeamId:string;homeName:string;awayName:string;kickoffAtUtc:string;country:string;competitionName:string}>;
export type OddsMatchV2Result=Readonly<{code:OddsMatchV2Code;matchedEventId?:string;matcherVersion:string;registryVersion:string;confidence:"EXACT"|"APPROVED"|"NONE"|"AMBIGUOUS";aliasesUsed:readonly Readonly<{aliasId:string;canonicalTeamId:string;providerAliasRaw:string;sourceArtifactId:string}>[];sourceArtifactId:string;deltaSeconds:number|null;reasons:readonly string[];warnings:readonly string[]}>;

type Resolution=Readonly<{matched:boolean;exact:boolean;ambiguous:boolean;scopeMismatch:boolean;aliases:readonly ProviderTeamAliasRecord[]}>;
function resolveTeam(providerName:string,canonicalTeamId:string,canonicalName:string,fixture:CanonicalOddsFixture,aliases:readonly ProviderTeamAliasRecord[]):Resolution{
  if(normalizeProviderTeamName(providerName)===normalizeProviderTeamName(canonicalName))return {matched:true,exact:true,ambiguous:false,scopeMismatch:false,aliases:[]};
  const normalized=normalizeProviderTeamName(providerName);const approved=aliases.filter(alias=>alias.status==="APPROVED"&&alias.providerKey==="the-odds-api"&&alias.providerAliasNormalized===normalized&&alias.registryVersion===PROVIDER_TEAM_ALIAS_REGISTRY_VERSION);
  const compatible=approved.filter(alias=>scopeCompatible(alias,fixture));const targets=new Set(compatible.map(alias=>alias.canonicalTeamId));
  if(targets.size>1)return {matched:false,exact:false,ambiguous:true,scopeMismatch:false,aliases:compatible};
  const selected=compatible.filter(alias=>alias.canonicalTeamId===canonicalTeamId);
  return {matched:selected.length===1,exact:false,ambiguous:false,scopeMismatch:approved.some(alias=>alias.canonicalTeamId===canonicalTeamId)&&selected.length===0,aliases:selected};
}
export function matchOddsFixtureV2(fixture:CanonicalOddsFixture,events:readonly OddsIdentityEvent[],aliases:readonly ProviderTeamAliasRecord[],sourceArtifactId:string):OddsMatchV2Result{
  const base={matcherVersion:ODDS_MATCHING_V2_POLICY.version,registryVersion:ODDS_MATCHING_V2_POLICY.registryVersion,sourceArtifactId};
  const football=events.filter(event=>!event.sportKey||event.sportKey.startsWith("soccer_"));
  if(football.length===0)return {...base,code:"EVENT_NOT_FOUND",confidence:"NONE",aliasesUsed:[],deltaSeconds:null,reasons:["NO_FOOTBALL_EVENTS"],warnings:[]};
  const within=football.filter(event=>Math.abs(Date.parse(event.kickoffAtUtc)-Date.parse(fixture.kickoffAtUtc))<=ODDS_MATCHING_V2_POLICY.kickoffToleranceMinutes*60_000);
  if(within.length===0)return {...base,code:"KICKOFF_OUTSIDE_TOLERANCE",confidence:"NONE",aliasesUsed:[],deltaSeconds:null,reasons:["NO_EVENT_WITHIN_TOLERANCE"],warnings:[]};
  const matches:Array<{event:OddsIdentityEvent;home:Resolution;away:Resolution}>=[];let homeMissing=false,awayMissing=false,ambiguous=false,scopeMismatch=false,orientationMismatch=false;
  for(const event of within){
    const home=resolveTeam(event.homeName,fixture.homeTeamId,fixture.homeName,fixture,aliases),away=resolveTeam(event.awayName,fixture.awayTeamId,fixture.awayName,fixture,aliases);
    const reverseHome=resolveTeam(event.homeName,fixture.awayTeamId,fixture.awayName,fixture,aliases),reverseAway=resolveTeam(event.awayName,fixture.homeTeamId,fixture.homeName,fixture,aliases);
    if(reverseHome.matched&&reverseAway.matched)orientationMismatch=true;
    ambiguous=ambiguous||home.ambiguous||away.ambiguous;scopeMismatch=scopeMismatch||home.scopeMismatch||away.scopeMismatch;homeMissing=homeMissing||!home.matched;awayMissing=awayMissing||!away.matched;
    if(home.matched&&away.matched)matches.push({event,home,away});
  }
  if(matches.length>1)return {...base,code:"MULTIPLE_EVENTS",confidence:"AMBIGUOUS",aliasesUsed:[],deltaSeconds:null,reasons:["MULTIPLE_DIRECT_EVENTS"],warnings:[]};
  if(matches.length===0){const code:OddsMatchV2Code=ambiguous?"TEAM_ALIAS_AMBIGUOUS":orientationMismatch?"ORIENTATION_MISMATCH":scopeMismatch?"SCOPE_MISMATCH":homeMissing?"HOME_ALIAS_MISSING":awayMissing?"AWAY_ALIAS_MISSING":"EVENT_NOT_FOUND";return {...base,code,confidence:ambiguous?"AMBIGUOUS":"NONE",aliasesUsed:[],deltaSeconds:null,reasons:[code],warnings:[]}}
  const selected=matches[0],used=[...selected.home.aliases,...selected.away.aliases].map(alias=>({aliasId:alias.id,canonicalTeamId:alias.canonicalTeamId,providerAliasRaw:alias.providerAliasRaw,sourceArtifactId:alias.sourceArtifactId}));const exact=selected.home.exact&&selected.away.exact;
  return {...base,code:exact?"MATCHED_EXACT":"MATCHED_APPROVED_ALIAS",matchedEventId:selected.event.id,confidence:exact?"EXACT":"APPROVED",aliasesUsed:used,deltaSeconds:Math.abs(Date.parse(selected.event.kickoffAtUtc)-Date.parse(fixture.kickoffAtUtc))/1000,reasons:[exact?"EXACT_NORMALIZED_DIRECT":"APPROVED_ALIAS_DIRECT"],warnings:[]};
}
