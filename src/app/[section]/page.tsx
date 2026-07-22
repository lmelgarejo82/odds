import {notFound} from "next/navigation";
import {EmptyState} from "@/components/empty-state";
import {HistoricalDatasetStatus} from "@/components/historical-dataset-status";
import {StatareaSemanticsStatus} from "@/components/statarea-semantics-status";
const sections:Record<string,string>={fuentes:"Fuentes",partidos:"Partidos",conciliacion:"Conciliación","analisis-historico":"Análisis histórico","semantica-statarea":"Semántica y calidad Statarea","mejores-partidos":"Mejores partidos",seguimiento:"Seguimiento",importaciones:"Importaciones",reportes:"Reportes","configuracion-asistida":"Configuración asistida"};
export function generateStaticParams(){return Object.keys(sections).map(section=>({section}))}
export default async function SectionPage({params}:{params:Promise<{section:string}>}){const {section}=await params;const title=sections[section];if(!title)notFound();if(section==="analisis-historico")return <HistoricalDatasetStatus/>;if(section==="semantica-statarea")return <StatareaSemanticsStatus/>;return <EmptyState title={title}/>}
