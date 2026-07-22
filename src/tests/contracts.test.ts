import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateContract } from "@/contracts/validator";
import { forebetCaptureReportSchema } from "@/contracts/forebet-capture";
import { statareaCaptureContractSchema } from "@/contracts/statarea-capture";
import { reconciliationContractSchema } from "@/contracts/reconciliation";
import { historicalDatasetContractSchema } from "@/contracts/historical-dataset";

const schemaDirectory=join(process.cwd(),"src","contracts","schemas");
const fixtureDirectory=join(process.cwd(),"src","contracts","fixtures");
const schemas=readdirSync(schemaDirectory).filter(name=>name.endsWith(".schema.json"));
const json=(path:string)=>JSON.parse(readFileSync(path,"utf8"));

describe("contratos JSON",()=>{
  it("valida el contrato Forebet también con Zod",()=>expect(forebetCaptureReportSchema.safeParse(json(join(fixtureDirectory,"forebet-ou25-capture-report.valid.json"))).success).toBe(true));
  it("rechaza el contrato Forebet inválido con Zod",()=>expect(forebetCaptureReportSchema.safeParse(json(join(fixtureDirectory,"forebet-ou25-capture-report.invalid.json"))).success).toBe(false));
  it("valida el contrato Statarea con Zod",()=>expect(statareaCaptureContractSchema.safeParse(json(join(fixtureDirectory,"statarea-daily-capture.valid.json"))).success).toBe(true));
  it("rechaza el contrato Statarea inválido con Zod",()=>expect(statareaCaptureContractSchema.safeParse(json(join(fixtureDirectory,"statarea-daily-capture.invalid.json"))).success).toBe(false));
  it("impide marcar 2.5 como semántica verificada",()=>{const fixture=json(join(fixtureDirectory,"statarea-daily-capture.valid.json"));fixture.rows[0].rawColumns[8].semanticStatus="VERIFIED";expect(statareaCaptureContractSchema.safeParse(fixture).success).toBe(false)});
  it("impide también con AJV marcar 2.5 como verificada",()=>{const fixture=json(join(fixtureDirectory,"statarea-daily-capture.valid.json"));fixture.rows[0].rawColumns[8].semanticStatus="VERIFIED";const schema=json(join(schemaDirectory,"statarea-daily-capture.schema.json"));expect(validateContract(schema,fixture).valid).toBe(false)});
  it("valida conciliación con Zod",()=>expect(reconciliationContractSchema.safeParse(json(join(fixtureDirectory,"fixture-reconciliation.valid.json"))).success).toBe(true));
  it("rechaza conciliación inválida con Zod",()=>expect(reconciliationContractSchema.safeParse(json(join(fixtureDirectory,"fixture-reconciliation.invalid.json"))).success).toBe(false));
  it.each([["MATCHED",null,"s1"],["ONLY_FOREBET","f1","s1"],["ONLY_STATAREA","f1","s1"]])("impide combinación inválida %s",(status,forebetId,statareaId)=>{const fixture=json(join(fixtureDirectory,"fixture-reconciliation.valid.json"));Object.assign(fixture.decisions[0],{status,forebetObservationId:forebetId,statareaRowId:statareaId});expect(reconciliationContractSchema.safeParse(fixture).success).toBe(false)});
  it("valida histórico congelado con Zod",()=>expect(historicalDatasetContractSchema.safeParse(json(join(fixtureDirectory,"historical-dataset.valid.json"))).success).toBe(true));
  it("rechaza histórico incompleto con Zod",()=>expect(historicalDatasetContractSchema.safeParse(json(join(fixtureDirectory,"historical-dataset.invalid.json"))).success).toBe(false));
  it("rechaza partición histórica incorrecta",()=>{const fixture=json(join(fixtureDirectory,"historical-dataset.valid.json"));fixture.days[14].partition="DISCOVERY";expect(historicalDatasetContractSchema.safeParse(fixture).success).toBe(false)});
  for(const schemaFile of schemas){
    const stem=schemaFile.replace(".schema.json",""); const schema=json(join(schemaDirectory,schemaFile));
    it(`${stem}: acepta fixture válido`,()=>expect(validateContract(schema,json(join(fixtureDirectory,`${stem}.valid.json`))).valid).toBe(true));
    it(`${stem}: rechaza fixture inválido`,()=>expect(validateContract(schema,json(join(fixtureDirectory,`${stem}.invalid.json`))).valid).toBe(false));
    it(`${stem}: rechaza additionalProperties`,()=>{const fixture=json(join(fixtureDirectory,`${stem}.valid.json`));expect(validateContract(schema,{...fixture,noPermitido:true}).valid).toBe(false)});
  }
});
