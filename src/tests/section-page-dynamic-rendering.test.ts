import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ events: [] as string[], connection: vi.fn<() => Promise<void>>(), notFound: vi.fn() }));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/daily-ranking-status", () => ({ DailyRankingStatus: () => { mocks.events.push("daily-ranking"); return "daily-ranking"; } }));
vi.mock("@/components/operational-history-status", () => ({ OperationalHistoryStatus: () => { mocks.events.push("operational-history"); return "operational-history"; } }));
vi.mock("@/components/operational-performance-status", () => ({ OperationalPerformanceStatus: () => { mocks.events.push("operational-performance"); return "operational-performance"; } }));

import SectionPage, { generateStaticParams } from "@/app/[section]/page";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const renderSection = async (section: string) => renderToStaticMarkup(await SectionPage({ params: Promise.resolve({ section }) }));

describe("producto operativo simplificado", () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.connection.mockReset();
    mocks.connection.mockImplementation(async () => { mocks.events.push("connection"); });
    mocks.notFound.mockReset();
    mocks.notFound.mockImplementation(() => { mocks.events.push("not-found"); throw new Error("NEXT_NOT_FOUND"); });
  });

  it.each([
    ["mejores-partidos", "daily-ranking"],
    ["historial", "operational-history"],
    ["rendimiento", "operational-performance"],
  ])("renderiza %s con datos a request-time", async (section, componentEvent) => {
    expect(await renderSection(section)).toContain(componentEvent);
    expect(mocks.connection).toHaveBeenCalledTimes(1);
    expect(mocks.events).toEqual(["connection", componentEvent]);
  });

  it("elimina secciones sin funcionalidad de la superficie pública", async () => {
    await expect(renderSection("fuentes")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.connection).not.toHaveBeenCalled();
  });

  it("publica únicamente las tres secciones útiles", () => {
    expect(generateStaticParams().map(({ section }) => section)).toEqual(["mejores-partidos", "historial", "rendimiento"]);
    const navigation = source("src/components/navigation.tsx");
    expect(navigation).not.toMatch(/Fuentes|Conciliación|Configuración asistida|Reportes/u);
  });

  it("usa connection sin bypasses de caché", () => {
    const page = source("src/app/[section]/page.tsx");
    expect(page).toContain('import { connection } from "next/server";');
    expect(page).not.toContain("force-dynamic");
    expect(page).not.toMatch(/revalidate\s*=\s*0|unstable_noStore|cookies\s*\(|headers\s*\(/u);
  });
});
