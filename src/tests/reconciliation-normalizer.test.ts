import { describe, expect, it } from "vitest";
import { categoryConflict, categoryFlags, decodeEntities, diceSimilarity, institutionalCore, normalizeIdentity } from "@/domain/reconciliation/normalizer";

describe("normalizador conservador de identidades", () => {
  it.each([
    ["Atlético  Mineiro", "atletico mineiro"], ["O’Higgins", "o higgins"], ["A–B", "a b"], ["  FC   Thun ", "fc thun"], ["Crvena-Zvezda", "crvena zvezda"], ["Malmö", "malmo"],
  ])("normaliza %s", (input, expected) => expect(normalizeIdentity(input)).toBe(expected));
  it("decodifica entidades HTML", () => expect(decodeEntities("A &amp; B &#39;C&#39;")).toBe("A & B 'C'"));
  it("conserva tokens protegidos", () => expect(normalizeIdentity("Club Women U21 Reserves B II 2 Academy Amateur")).toContain("women u21 reserves b ii 2 academy amateur"));
  it("solo reduce tokens institucionales en el core", () => expect(institutionalCore("FK Buxoro FC")).toBe("buxoro"));
  it("no colisiona por quitar FC cuando queda identidad distinta", () => expect(institutionalCore("Alpha FC")).not.toBe(institutionalCore("Beta FC")));
  it.each([["Women", "gender"], ["U21", "youth"], ["Reserves", "reserve"], ["Team B", "bTeam"], ["Academy", "academy"], ["Amateur", "amateur"]] as const)("clasifica %s", (token, flag) => expect(categoryFlags(token)[flag]).toBe(true));
  it.each([["Women", ""], ["U21", ""], ["Reserves", ""], ["Team B", ""]])("detecta conflicto protegido %s", (left, right) => expect(categoryConflict(categoryFlags(left), categoryFlags(right)).length).toBeGreaterThan(0));
  it("similitud exacta vale uno", () => expect(diceSimilarity("Jeju United", "Jeju United")).toBe(1));
  it("similitud incorrecta no se compensa", () => expect(diceSimilarity("Jeju United", "Completely Different")).toBeLessThan(0.4));
});
