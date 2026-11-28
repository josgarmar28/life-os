# ADR-0004 — Modo viaje a España

- **Fecha:** 2026-11-28
- **Estado:** parte 1 (viaje completo, sin maleta) escrita y probada en local; pendiente de su revisión y despliegue. Diseño v0.2 aprobado por el usuario el 28-nov.
- **Complementa:** ADR-0002 (D-25 a D-29: planes, semana, periodos en otro gimnasio) y ADR-0003 (armario, para la maleta de la parte 2).

## Contexto
Cada viaje a España (o visita de su novia) obligaba a tocar a mano varias cosas: el periodo en La Zona, los días fuera de casa, el teletrabajo de la semana, las noches (sueño) y recordar la maleta, el burrito y el pedido de Migros. El usuario trabaja en remoto desde España con el mismo horario y pausa, el gimnasio abre a las 07:00 y está a 10-15 min.

## Decisiones

| ID | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| D-37 | **Un viaje = una fila** (`core.trip`) con fechas, horas, vacaciones, gimnasio y lo que **añadió** (`added`), más los días deducidos (fuera, teletrabajo, noches). Se crea y se edita con `api.save_trip`, **atómica e idempotente** (`request_id`) | Varias pantallas sueltas (periodo, semana, etc.) | Un solo gesto; si algo falla no queda a medias |
| D-38 | **Cancelar deshace solo lo que añadió el viaje** (`core.trip_revert`): borra el periodo de gimnasio propio y quita de cada semana solo los días que el viaje puso, sin tocar lo que él cambió a mano | Borrar semanas enteras | No perder ajustes manuales |
| D-39 | **Reglas deterministas en código compartido** (`_shared/trip.ts`, sin IA): día fuera si sale antes de las 15:00 o llega después de las 16:00; gimnasio = dónde durmió la noche anterior (el de vuelta solo si sale de España a las 10:00 o más tarde); teletrabajo de lunes a viernes entre salida y vuelta, salvo vacaciones; vuelta normal si es domingo antes de las 16:00, si no «exprés»; más de 3 noches = viaje largo, cocina y pedido los decide nutrición. Todo editable en la vista previa | Que Claude lo deduzca cada vez | Dashboard y conector enseñan exactamente lo mismo; se prueba con tests |
| D-40 | **Agenda**: un día fuera oculta la cocina y la revisión de compra (cambio de comportamiento: antes solo cambiaba una etiqueta). Campos opcionales nuevos en los bloques del horario: `home_only`, `work`, `role`. Hasta que el usuario apruebe un horario v0.9 con esas marcas, el aviso de la vista previa lo dice | Cambiar su horario por mi cuenta | Sus planes solo cambian con su aprobación (Propuestas) |
| D-41 | **Conector**: `lifeos_trip` (lectura y vista previa sin guardar) y `lifeos_set_trip` (crear o cancelar, solo cuando él lo pide en el chat). `finish_trip` y el checklist son solo del dueño. Sin aviso push | Que Claude edite filas | La base de datos, no el prompt, limita al agente (D-07) |
| D-42 | **Checklist** por tipo de viaje (maleta, burrito, pedido de Migros; «comidas» si viene ella) con fecha desde la que toca; aparece en Hoy y se marca a mano | Aviso push programado | Él dijo que no quería avisos |

## Consecuencias
- Migración `20261128000001_trips.sql` (forward-only), prueba SQL 96, 23 tests unitarios de reglas, pruebas del conector y recorrido de navegador (`e2e/07-trip.spec.ts`).
- La carga de viajes es tolerante: si la migración aún no está aplicada, la agenda sigue funcionando sin viajes.
- Pendiente (parte 2): lista de maleta calculada por código desde los dos armarios (necesidades − lo que ya hay en España, «He llegado» / «He vuelto» con `move_garments`). Parte 3: revisión semanal en una pantalla, marcando los días de viaje como atípicos.
- Pendiente de datos del usuario: hora de salida de Pully del 3-ene y confirmar que el vuelo Barcelona-Ginebra del 10-ene es a las 15:30.
