import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DailyRankingStatus } from "@/components/daily-ranking-status";
import { OperationalHistoryStatus } from "@/components/operational-history-status";
import { OperationalPerformanceStatus } from "@/components/operational-performance-status";

const sections = ["mejores-partidos", "historial", "rendimiento"] as const;

export function generateStaticParams() {
  return sections.map((section) => ({ section }));
}

export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  if (!(sections as readonly string[]).includes(section)) notFound();
  await connection();
  if (section === "mejores-partidos") return <DailyRankingStatus />;
  if (section === "historial") {
    const query: Record<string, string | string[] | undefined> = await (searchParams ?? Promise.resolve({}));
    return <OperationalHistoryStatus selectedDate={typeof query.date === "string" ? query.date : undefined} />;
  }
  return <OperationalPerformanceStatus />;
}
