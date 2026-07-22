# Arquitectura

El proyecto usa Next.js App Router como capa de presentación y separa responsabilidades en `application`, `domain`, `infrastructure` y `contracts`. Prisma accede exclusivamente a una base SQLite local propia. No existe dependencia, importación ni referencia a la base de `x2-ht-lab`.

El dominio no depende de Next.js ni Prisma. La aplicación orquesta casos de uso; infraestructura encapsula persistencia; contratos contiene los límites JSON intercambiables. B002 incorpora Forebet y B003 un adaptador Statarea independiente. B004 agrega normalización conservadora, candidatos explicables, decisiones uno-a-uno, runs append-only y estabilidad entre snapshots, sin utilizar predicciones ni resultados.
