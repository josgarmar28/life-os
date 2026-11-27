# ADR-0003 — Armario virtual

- **Fecha:** 2026-11-27
- **Estado:** fase 1 escrita y probada en local; pendiente de su revisión y despliegue. Propuesta aprobada por el usuario el 27-nov (collage de fotos + análisis de Claude como «simulación», sin copia extra de fotos, carga de la ropa actual en modo ráfaga a su ritmo).
- **Complementa:** ADR-0002 (D-16, D-20, D-25/D-26).

## Contexto
El usuario quiere registrar cada prenda con foto y ficha, en dos armarios (Suiza y España), buscarla por categorías, filtros o tienda, saber cómo lavarla y pedir a Claude conjuntos, qué comprar o qué llevar de viaje. Lo consultará poco. Restricciones: plan gratuito de Supabase (1 GB de archivos, 50 MB por archivo, 5 GB de salida al mes, 500 MB de base de datos; verificado el 27-nov en supabase.com/pricing.md), coste cero y fotos de ropa en almacenamiento privado. Las fotos corporales no se suben a ningún sitio.

## Decisiones

| ID | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| D-30 | **Tablas propias** (`core.closet`, `garment`, `garment_photo`, `garment_move`) con la misma pauta que los planes (escritura por `api.*` security definer, lectura por vistas + RLS de dueño) | Un área más del motor genérico | El motor no maneja fotos ni relaciones prenda–armario–conjunto |
| D-31 | **Una prenda está en un armario** (o en tránsito: `closet_id` nulo); cada cambio queda en `garment_move` (solo anexado, idempotente por `request_id`). Armarios editables y archivables si están vacíos | Ubicación como etiqueta libre | Permite «qué hay en España ahora» y preparar maletas sin ambigüedad |
| D-32 | **Foto procesada en el teléfono**: lado largo 1024 px en JPEG, o, si es un recorte con transparencia («Levantar sujeto» del iPhone), **normalizada** (recorte al borde, centrada en un cuadrado de 800 px con margen fijo, PNG con transparencia). Miniatura propia. La recodificación elimina EXIF | Servicio de recorte de pago o modelo en WASM (decenas de MB, lento en iPhone) | Gratis, sin claves, y cabe: ≈250-500 KB por prenda |
| D-33 | **Cubo privado `wardrobe`** (2 MB por archivo, solo JPEG y PNG), sin URL públicas (URL firmadas de 1 h). Subir, sustituir y borrar: solo la sesión del dueño; Claude solo lee | Cubo público; subida desde el conector | Privacidad y D-07: la BD, no el prompt, limita al agente |
| D-34 | **Claude no crea ni edita la ficha**: mueve prendas, marca usadas/limpias y guarda el **análisis** (`api.save_garment_analysis`, siempre estimado, con autor y fecha). El dashboard no llama a Claude por su cuenta | API de pago automática al subir cada foto | Coste cero; él pide «analiza lo nuevo» y Claude lee las fotos por el conector (fase 2) |
| D-35 | **Lavado** = programa de la etiqueta por prenda + estado limpia/usada. Se marca por selección (como mover) y la lista de lavado se calcula por código: tandas por programa y tono, aviso de prendas sin secadora | Registrar cada día lo que se pone | Cero registro diario; sirve sobre todo en España para dejar la ropa lavada antes de volver |
| D-36 | **Búsqueda y filtros en el cliente** (texto sin acentos, armario, tipo, color, estación, tienda, marca, formalidad, estado, uso, análisis, precio, orden) con código compartido `supabase/functions/_shared/wardrobe.ts` para que Claude use los mismos en la fase 2 | Búsqueda en la BD | Unos cientos de prendas caben en memoria; funciona igual para los dos |

## Consecuencias
- **Las fotos no entran en la copia diaria cifrada** (esa es un volcado de la base de datos); decisión del usuario: sin copia extra, las fotos se pueden volver a hacer.
- Presupuesto: 400 prendas ≈ 100-200 MB (10-20 % del GB). La app avisa al 70 %.
- La CSP admite ahora `blob:` y `https://*.supabase.co` en `img-src` (vistas previas y URL firmadas).
- Límite conocido: el Storage real no se ha podido probar localmente. Las políticas se prueban en SQL contra un `storage.objects` simulado (`supabase/tests/95_wardrobe.test.sql`) y el recorrido de navegador usa un doble de prueba del Storage (`scripts/e2e/gateway.mjs`). La primera vez en su Supabase hay que comprobar el cubo y subir una foto (runbook).
- Fases siguientes: 2) herramientas del conector (lectura con imagen, análisis, mover, informe de huecos) tras comprobar que claude.ai muestra las imágenes devueltas por una herramienta; 3) conjuntos, maleta e informe de huecos.
