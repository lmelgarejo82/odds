# Modelo de datos Market V2

Market V2 conserva por separado evidencia, decisión, hechos posteriores y evaluación.

```text
ImportBatch 1 ── * SourceArtifact
                       │
Team 1 ── * TeamAlias ─┘
  │
  └── Fixture 1 ── * ForebetSnapshot
          │
          ├── * OddsSnapshot * ── 1 Bookmaker
          │         │              1 MarketSelection * ── 1 MarketDefinition
          │         └── 1 OddsCaptureRun
          │
          ├── * MarketProbabilitySnapshot * ── * OddsSnapshot
          ├── * PreMatchDecision ── 0..1 OddsSnapshot
          └── * Outcome ── 0..1 superseded Outcome

PreMatchDecision 1 ── * Settlement * ── 1 Outcome
EvaluationRun 1 ── * DecisionEvaluation ── 1 PreMatchDecision + 1 Outcome
```

## Invariantes principales

- La base y el cliente Prisma de Market V2 están aislados del schema y SQLite legacy.
- Todo timestamp de entrada de dominio usa UTC normalizado con `Z`.
- Para una decisión prepartido: `oddsCapturedAtUtc <= decidedAtUtc < kickoffAtUtc`.
- `SELECTED` exige una cuota exacta del mismo fixture; `ABSTAINED` puede no tenerla.
- Cuotas elegibles: decimal mayor que 1, mercado activo y no in-play.
- Las probabilidades Forebet están en `[0, 1]` y suman 1 dentro de una tolerancia explícita.
- Un snapshot de probabilidad referencia cada cuota de entrada y conserva método, versión y hash del conjunto.
- `MarketDefinition` y `MarketSelection` versionan el catálogo: sus claves estables permiten representar inicialmente `1`, `X`, `2`, `1X`, `X2`, DNB local y DNB visitante, y añadir mercados sin cambiar `OddsSnapshot`.
- Las tablas de evidencia y hechos temporales son append-only a nivel SQLite.
- Una corrección de outcome crea una fila nueva que referencia la anterior; nunca la reemplaza.
- Decision solo ve inputs prepartido. Evaluation es la frontera autorizada para combinar decisiones y outcomes.

La futura base operativa es `var/market-v2/market-v2.sqlite`. Este lote no la crea ni la puebla. Para Prisma se usa siempre `--schema prisma/market-v2/schema.prisma`.
