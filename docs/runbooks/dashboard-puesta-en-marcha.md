# Runbook: puesta en marcha del dashboard y del conector (plan gratuito)

Coste: **0 €**. Todo esto lo haces tú: las claves no pasan nunca por el chat, y lanzar a mano los workflows `deploy` y `bootstrap` es tu aprobación para tocar tu Supabase. Tiempo estimado: unos 30 minutos, una sola vez.

Todo lo que viene aquí se ha probado de principio a fin en local con las mismas piezas de Supabase (inicio de sesión, servidor OAuth, API y conector), en tamaño de iPhone: lo que queda por comprobar en tu proyecto está al final.

## Qué queda montado

| Pieza | Dónde | Coste |
|---|---|---|
| Base de datos, inicio de sesión y servidor OAuth | Tu proyecto de Supabase (plan gratuito, UE) | 0 |
| Conector de Claude (`mcp`) | Edge Function de ese mismo proyecto | 0 (500.000 llamadas/mes incluidas) |
| Dashboard (PWA para iPhone y ordenador) | Cloudflare Pages | 0 |
| Copia diaria cifrada y "latido" anti-pausa | GitHub Actions del repo, artefactos de 90 días | 0 (≈60 de los 2.000 min/mes gratuitos) |

Límites del plan gratuito que importan: 500 MB de base de datos (a tu ritmo, unos pocos MB al año), pausa del proyecto tras ~7 días sin actividad (el workflow `backup` lo usa a diario), y Supabase no hace copias en el plan gratuito (las hace `backup`).

## 1. Fusionar el PR
Dime "ok" en el hilo al PR abierto; con CI en verde lo fusiono. Los workflows solo se pueden lanzar desde `main`.

## 2. Clave de las copias de seguridad (en tu ordenador)
```bash
brew install age            # o: sudo apt install age
age-keygen -o lifeos-backup.key
```
- Guarda `lifeos-backup.key` en tu gestor de contraseñas. **Sin ese archivo las copias no se pueden abrir, ni por ti ni por nadie.**
- La línea `Public key: age1…` es la que va a GitHub (paso 4).

## 3. Cuentas y claves
**Cloudflare** (gratis, sin tarjeta): crea la cuenta en dash.cloudflare.com.
- *Account ID*: en la página de inicio de la cuenta (columna derecha, o en *Workers & Pages*).
- *API token*: My Profile → API Tokens → Create Token → *Custom token* → permiso **Account · Cloudflare Pages · Edit**, solo tu cuenta.

**Supabase** (supabase.com/dashboard):
- *Access token*: avatar → Account preferences → Access Tokens → Generate. Da acceso a tus proyectos: no lo compartas y revócalo si lo pierdes.
- *Contraseña de la base de datos*: la que pusiste al crear el proyecto. Si no la tienes: Project Settings → Database → Reset database password.
- *Project ref*: Project Settings → General → Project ID (el `xxxx` de `https://xxxx.supabase.co`).

## 4. Cargarlas en GitHub
Repositorio → Settings → Secrets and variables → Actions.

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `SUPABASE_ACCESS_TOKEN` | Access token de Supabase |
| Secret | `SUPABASE_DB_PASSWORD` | Contraseña de la base de datos |
| Secret | `LIFEOS_OWNER_EMAIL` | Tu correo. **El mismo de tu cuenta de Supabase**: el correo gratuito de Supabase solo envía a miembros de tu organización |
| Secret | `CLOUDFLARE_API_TOKEN` | Token del paso 3 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Account ID |
| Secret | `BACKUP_AGE_RECIPIENT` | La clave pública `age1…` del paso 2 |
| Variable | `SUPABASE_PROJECT_REF` | Project ref (no es secreto: va en la URL pública) |
| Variable (opcional) | `PAGES_PROJECT` | Nombre del sitio en Cloudflare; por defecto `lifeos-panel` |

## 5. Desplegar
Actions → **deploy** → Run workflow → escribe `DESPLEGAR`.
Hace, por orden: copia cifrada, migraciones, conector, compilación con pruebas y publicación. Al final, el resumen del run muestra la URL del dashboard (`https://….pages.dev`) y la del conector. Si Cloudflare añadió un sufijo al nombre, usa la URL que sale en el paso "Publicar en Cloudflare Pages".

## 6. Configurar
Actions → **bootstrap** → Run workflow → pega la URL del dashboard (sin barra final) y escribe `CONFIGURAR`.
- Crea tu usuario, te registra como dueño único y **cierra el registro** a cualquier otra persona.
- Fija la URL del dashboard, exige contraseñas de al menos 10 caracteres, expone el esquema `api`, **activa el servidor OAuth** para el conector y carga las 8 áreas con sus cuestionarios (solo estructura; si lo repites no pisa lo que hayas cambiado).
- El aviso "Plantilla no cambiada" es normal en el plan gratuito y no hace falta hacer nada.

## 7. Comprobar el servidor OAuth
Si el run de `bootstrap` terminó sin el aviso amarillo "No se pudo activar el servidor OAuth", no hay nada que hacer. Si salió, actívalo a mano en Supabase → Authentication → **OAuth Server** (beta): actívalo, activa el **registro dinámico de clientes** y pon *Authorization path* `/oauth/consent`. Si algo no cuadra, dímelo con una captura sin claves.

## 8. Primer acceso e instalación en el iPhone
1. En **Safari**, abre la URL del dashboard → *Primera vez u olvidé la contraseña* → *Enviarme un enlace*.
2. Abre el enlace del correo **en Safari** (el correo gratuito de Supabase permite muy pocos envíos por hora: pide uno y espera).
3. Ya dentro: **Ajustes → Contraseña**, crea una de al menos 10 caracteres (mejor una frase) y guárdala en el llavero del iPhone.
4. Compartir → **Añadir a pantalla de inicio**. Desde el icono entras con correo y contraseña; la sesión se mantiene.

Si un día olvidas la contraseña, repite los pasos 1 a 3.

## 9. Añadir el conector a Claude
claude.ai (web) → Settings → Connectors → **Add custom connector**:
- Nombre: `LIFE OS`
- URL: `https://<project-ref>.supabase.co/functions/v1/mcp`

Pulsa *Connect*: se abre tu dashboard, inicias sesión y apruebas el acceso. Si la página avisa de que la dirección de vuelta no es de claude.ai, no apruebes. Una vez añadido en la web, aparece también en la app del iPhone.

Qué puede hacer Claude con él: leer tus áreas y registros, añadir o corregir registros cuando se lo pidas (quedan marcados como "Claude") y **proponer** cambios de estructura, que solo se aplican si los apruebas en *Propuestas*. No puede crear, archivar ni borrar áreas por su cuenta, ni ver tus fotos (no están en el sistema).

## 10. Comprobación final (2 minutos)
1. Dashboard: aparecen las 8 áreas en la vista general, con lo pendiente de hoy.
2. En Claude: "¿Qué áreas tengo en LIFE OS?" → las enumera.
3. Registra un peso de prueba en el dashboard, pídele a Claude "revisa mi semana en LIFE OS" (debe salir en la pestaña *Semana* y en su respuesta) y bórralo después.
4. Actions → **backup** → Run workflow → termina en verde y deja un artefacto `lifeos-backup-…`.

## Cómo se usa a diario
- **Hoy**: lo pendiente de cada área y los últimos valores. **Semana**: cada indicador día a día con su media y el cambio frente a la semana anterior, y cuántos registros llevas de cada cuestionario.
- En el gimnasio, *Copiar de la última vez* rellena las series de la sesión anterior para que solo ajustes cargas y repeticiones. Sin cobertura, la app abre y guarda en el teléfono; lo envía sola al volver la red.
- Áreas → *Crear, modificar o archivar áreas*: cuestionarios y campos, también tablas con su editor de columnas.
- **Propuestas**: lo que Claude sugiere cambiar en la estructura, explicado en palabras. Solo se aplica si lo apruebas.

## Restaurar una copia
```bash
age -d -i lifeos-backup.key lifeos-AAAAMMDDTHHMMZ.tar.gz.age | tar xz   # schema.sql, data.sql, auth.sql
```
La restauración sobre un proyecto nuevo se hace conmigo, paso a paso; nunca sobre el proyecto en uso sin otra copia previa.

## Sin verificar todavía en tu proyecto (se comprueba en los pasos 5 a 10)
Verificado en local con Supabase Auth v2.186 (la versión actual): el flujo OAuth completo con consentimiento, que el token lleve `client_id` y que la base limite a Claude a registrar y proponer.
- Que la API de gestión acepte los campos del servidor OAuth (si no, aviso y paso 7 a mano).
- Que la pasarela de Supabase deje pasar el registro de Claude y el token sin clave `apikey` (es lo documentado; en local funciona).
- Que `supabase db dump` llegue a la base desde GitHub por el pooler (la conexión directa del plan gratuito es solo IPv6).
- Que la actividad diaria de `backup` evite la pausa del plan gratuito.
