import {notFound} from "next/navigation";
import {EmptyState} from "@/components/empty-state";
const sections:Record<string,string>={fuentes:"Fuentes",partidos:"Partidos",conciliacion:"Conciliación","analisis-historico":"Análisis histórico","mejores-partidos":"Mejores partidos",seguimiento:"Seguimiento",importaciones:"Importaciones",reportes:"Reportes","configuracion-asistida":"Configuración asistida"};
export function generateStaticParams(){return Object.keys(sections).map(section=>({section}))}
export default async function SectionPage({params}:{params:Promise<{section:string}>}){const {section}=await params;const title=sections[section];if(!title)notFound();return <EmptyState title={title}/>}
