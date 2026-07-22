import {notFound} from "next/navigation";
import {EmptyState} from "@/components/empty-state";
import {HistoricalAnalysisStatus} from "@/components/historical-analysis-status";
import {MarketPriorityStatus} from "@/components/market-priority-status";
import {StatareaSemanticsStatus} from "@/components/statarea-semantics-status";
const sections:Record<string,string>={fuentes:"Fuentes",partidos:"Partidos",conciliacion:"Conciliación","analisis-historico":"Análisis histórico","semantica-statarea":"Semántica y calidad Statarea","sistema-prioridad":"Sistema de prioridad","mejores-partidos":"Mejores partidos",seguimiento:"Seguimiento",importaciones:"Importaciones",reportes:"Reportes","configuracion-asistida":"Configuración asistida"};
export function generateStaticParams(){return Object.keys(sections).map(section=>({section}))}
export default async function SectionPage({params}:{params:Promise<{section:string}>}){const {section}=await params;const title=sections[section];if(!title)notFound();if(section==="analisis-historico")return <HistoricalAnalysisStatus/>;if(section==="semantica-statarea")return <StatareaSemanticsStatus/>;if(section==="sistema-prioridad")return <MarketPriorityStatus/>;return <EmptyState title={title}/>}
