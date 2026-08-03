import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/empty-state";
import { HistoricalAnalysisStatus } from "@/components/historical-analysis-status";
import { MarketPriorityStatus } from "@/components/market-priority-status";
import { ProspectiveShadowStatus } from "@/components/prospective-shadow-status";
import { StatareaSemanticsStatus } from "@/components/statarea-semantics-status";
import { DailyRankingStatus } from "@/components/daily-ranking-status";

const sections: Record<string, string> = {
  fuentes: "Fuentes",
  partidos: "Partidos",
  conciliacion: "Conciliación",
  "analisis-historico": "Análisis histórico",
  "semantica-statarea": "Semántica y calidad Statarea",
  "sistema-prioridad": "Sistema de prioridad",
  "ejecucion-prospectiva": "Ejecución prospectiva",
  "mejores-partidos": "Mejores partidos",
  seguimiento: "Seguimiento",
  importaciones: "Importaciones",
  reportes: "Reportes",
  "configuracion-asistida": "Configuración asistida",
};

const databaseBackedSections = new Set([
  "analisis-historico",
  "semantica-statarea",
  "sistema-prioridad",
  "ejecucion-prospectiva",
  "mejores-partidos",
]);

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const title = sections[section];

  if (!title) notFound();

  if (databaseBackedSections.has(section)) {
    await connection();
  }

  if (section === "analisis-historico") return <HistoricalAnalysisStatus />;
  if (section === "semantica-statarea") return <StatareaSemanticsStatus />;
  if (section === "sistema-prioridad") return <MarketPriorityStatus />;
  if (section === "ejecucion-prospectiva") return <ProspectiveShadowStatus />;
  if (section === "mejores-partidos") return <DailyRankingStatus />;

  return <EmptyState title={title} />;
}
