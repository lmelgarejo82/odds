# Conciliación de fixtures B004

La conciliación del 2026-07-21 se ejecuta exclusivamente sobre SQLite local con `npm run reconcile:fixtures -- --date=2026-07-21`. No importa clientes HTTP ni recaptura fuentes. Fija el snapshot Forebet y tres snapshots Statarea por ID y SHA-256; el primario es la captura HTTP real exitosa más reciente.

Versiones: `ou25-fixture-matcher/1.0.0` y `ou25-identity-normalizer/1.0.0`. La configuración DRAFT se serializa canónicamente y su hash es `b659064ddf02ce1c14bb30f40db4dd3609258f51e7639e380ac020ab2787e90b`. Umbrales fijados antes del run real: candidato 0.55 por lado, detección de conflicto 0.40, aceptación aproximada 0.84 por lado y 0.88 agregado, margen 0.08.

Se normalizan Unicode, diacríticos, entidades, espacios, apóstrofes, guiones y puntuación. Los tokens institucionales solo permiten equivalencia conservadora cuando ambos lados mantienen identidad suficiente. Género, juvenil, reservas, equipo B, academia y amateur están protegidos. No se incorporaron aliases. La hora permanece `UNVERIFIED` y no puntúa.

El matcher solo recibe equipos, orientación, competición, país y categoría dentro de snapshots de fecha fijada. No recibe predicciones Forebet, porcentajes, marcador previsto, averageGoals, resultados ni columnas raw Statarea. Cada lado supera su umbral independientemente; orientación invertida o categoría incompatible producen `CONFLICT`, nunca `MATCHED`.

## Ejecución real

- Primario `b5c18db1-c81a-483c-be12-786ae160c0cd`: 42/49 entradas, MATCHED 4, AMBIGUOUS 1, ONLY_FOREBET 37, ONLY_STATAREA 45, CONFLICT 0.
- Alternativo A `5d6c40b8-e9ce-45c4-8086-83568cebc464`: mismos conteos sobre el primer snapshot Statarea.
- Alternativo B `2917edcc-cdde-4a13-b965-dbb01e4ce0d8`: 42/50 entradas y ONLY_STATAREA 46; los demás conteos iguales.

Hay 48 identidades Statarea presentes en los tres snapshots, tres presentes solo en uno o dos y cuatro matches comunes a los tres runs. El replay reutilizó los tres runs sin duplicar sus 15 candidatos ni 262 decisiones. Los exports canónicos están fuera de Git en `var/exports/reconciliation/2026-07-21`.
