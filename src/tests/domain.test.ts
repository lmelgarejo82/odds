import { describe,expect,it } from "vitest";
import { canonicalHash } from "@/domain/canonical-hash";
import { assertCandidateIsEligible,calculatePriorityScore,rankDeterministically,scoreComponentsSchema } from "@/domain/ranking";
import { immutableSnapshot,separateSides } from "@/domain/snapshots";
import { domainPolicy } from "@/domain/policy";

describe("ranking explicable",()=>{
  it("suma los componentes y admite el máximo 100",()=>expect(calculatePriorityScore({signalScore:40,historicalEvidenceScore:40,dataQualityScore:20})).toBe(100));
  it.each([[41,0,0],[0,41,0],[0,0,21]])("aplica los límites 40/40/20",(signalScore,historicalEvidenceScore,dataQualityScore)=>expect(scoreComponentsSchema.safeParse({signalScore,historicalEvidenceScore,dataQualityScore}).success).toBe(false));
  it("no denomina probability a la prioridad",()=>expect(domainPolicy.terminology).toBe("priorityScore"));
  it("excluye matching ambiguo",()=>expect(()=>assertCandidateIsEligible("AMBIGUOUS")).toThrow(/ambiguo/));
  it("es reproducible ante empates",()=>{const input=[{canonicalKey:"b",priorityScore:80},{canonicalKey:"a",priorityScore:80}];expect(rankDeterministically(input).map(x=>x.canonicalKey)).toEqual(["a","b"])});
});
describe("integridad",()=>{
  it("produce un hash canónico independiente del orden",()=>expect(canonicalHash({b:2,a:1})).toBe(canonicalHash({a:1,b:2})));
  it("mantiene snapshots inmutables",()=>expect(Object.isFrozen(immutableSnapshot({value:1}))).toBe(true));
  it("mantiene Over y Under separados",()=>expect(separateSides({over25:61,under25:39})).toEqual({over:61,under:39}));
  it("no ejecuta apuestas, no usa stake ni cuotas para seleccionar",()=>expect(domainPolicy).toMatchObject({executesBets:false,usesStake:false,selectionUsesOdds:false}));
});
