# Contratos de fuentes

Los ocho schemas de `src/contracts/schemas` usan JSON Schema 2020-12, versión explícita y `additionalProperties: false` en sus objetos contractuales. AJV con `ajv-formats` los valida. Cada schema tiene un fixture válido y uno inválido.

El contrato `forebet-ou25-capture-report` v1 agrega el resultado controlado de B002 y se valida tanto con Zod como con AJV. Los contratos previos no cambiaron de forma incompatible.
El contrato `statarea-daily-capture` v1 de B003 conserva encabezados y valores raw con orden determinista. Los campos diferidos permanecen `UNVERIFIED`; el export se valida con Zod y AJV antes de escribirse.

El contrato `fixture-reconciliation` v1 fija IDs y hashes completos, configuración versionada, candidatos, decisiones, coberturas separadas y estabilidad. Excluye resultados y datos predictivos y aplica validación Zod y AJV.
