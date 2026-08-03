import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  connection: vi.fn<() => Promise<void>>(),
  notFound: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/empty-state", () => ({
  EmptyState: () => {
    mocks.events.push("empty-state");
    return "empty-state";
  },
}));
vi.mock("@/components/historical-analysis-status", () => ({
  HistoricalAnalysisStatus: () => {
    mocks.events.push("historical-analysis");
    return "historical-analysis";
  },
}));
vi.mock("@/components/statarea-semantics-status", () => ({
  StatareaSemanticsStatus: () => {
    mocks.events.push("statarea-semantics");
    return "statarea-semantics";
  },
}));
vi.mock("@/components/market-priority-status", () => ({
  MarketPriorityStatus: () => {
    mocks.events.push("market-priority");
    return "market-priority";
  },
}));
vi.mock("@/components/prospective-shadow-status", () => ({
  ProspectiveShadowStatus: () => {
    mocks.events.push("prospective-shadow");
    return "prospective-shadow";
  },
}));

import SectionPage, { generateStaticParams } from "@/app/[section]/page";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");
const renderSection = async (section: string) => {
  const page = await SectionPage({ params: Promise.resolve({ section }) });
  return renderToStaticMarkup(page);
};

describe("renderizado request-time de secciones Prisma", () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.connection.mockReset();
    mocks.connection.mockImplementation(async () => {
      mocks.events.push("connection");
    });
    mocks.notFound.mockReset();
    mocks.notFound.mockImplementation(() => {
      mocks.events.push("not-found");
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  it.each([
    ["analisis-historico", "historical-analysis"],
    ["semantica-statarea", "statarea-semantics"],
    ["sistema-prioridad", "market-priority"],
    ["ejecucion-prospectiva", "prospective-shadow"],
  ])("espera una petición antes de renderizar %s", async (section, componentEvent) => {
    expect(await renderSection(section)).toContain(componentEvent);
    expect(mocks.connection).toHaveBeenCalledTimes(1);
    expect(mocks.events).toEqual(["connection", componentEvent]);
  });

  it("mantiene las secciones sin Prisma fuera de la frontera dinámica", async () => {
    expect(await renderSection("fuentes")).toContain("empty-state");
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.events).toEqual(["empty-state"]);
  });

  it("conserva notFound para una sección inválida", async () => {
    await expect(renderSection("inexistente")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.events).toEqual(["not-found"]);
  });

  it("preserva generateStaticParams con todas las secciones", () => {
    expect(generateStaticParams().map(({ section }) => section)).toEqual([
      "fuentes",
      "partidos",
      "conciliacion",
      "analisis-historico",
      "semantica-statarea",
      "sistema-prioridad",
      "ejecucion-prospectiva",
      "mejores-partidos",
      "seguimiento",
      "importaciones",
      "reportes",
      "configuracion-asistida",
    ]);
  });

  it("usa connection sin bypasses de caché ni APIs request-time artificiales", () => {
    const page = source("src/app/[section]/page.tsx");

    expect(page).toContain('import { connection } from "next/server";');
    expect(page).toContain("generateStaticParams");
    expect(page).not.toContain("force-dynamic");
    expect(page).not.toMatch(/revalidate\s*=\s*0/);
    expect(page).not.toMatch(/unstable_noStore|cookies\s*\(|headers\s*\(/);
  });

  it("no altera la presentación explícita de horarios en Asunción", () => {
    const prospective = source("src/components/prospective-shadow-status.tsx");

    expect(prospective).toContain('new Intl.DateTimeFormat("es-PY"');
    expect(prospective).toContain('timeZone: "America/Asuncion"');
    expect(prospective).toContain("Horario pendiente de normalización");
  });
});
