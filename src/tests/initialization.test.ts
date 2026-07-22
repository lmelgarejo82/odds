import { describe,expect,it } from "vitest";
import { initialResearch,initializationIdentity } from "@/application/initial-research";

describe("inicialización controlada",()=>{
  it("define una base deportiva vacía",()=>expect({artifacts:0,matches:0,reports:0,rankings:0,tracking:0}).toEqual({artifacts:0,matches:0,reports:0,rankings:0,tracking:0}));
  it("define una investigación DRAFT sin resultados afirmados",()=>expect(initialResearch).toMatchObject({status:"DRAFT",active:false,resultsAsserted:false,separateSides:true}));
  it("produce una identidad estable para un seed idempotente",()=>expect(initializationIdentity()).toBe(initializationIdentity()));
});
