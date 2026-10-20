# Manual (español)

English version: [manual.md](manual.md). Las dos versiones describen los mismos pasos y comandos; un
cambio en una se hace también en la otra, en el mismo pull request.

Audit Hub es un servicio de registro de auditoría y de seguridad que instalas en tus propios
servidores. Las aplicaciones que conectas le envían sus eventos de seguridad, de auditoría, de
acceso y de sistema, firmados, mediante un conector instalado en cada una. Audit Hub guarda los
eventos sellados, en tablas de solo inserción, con retención y borrado, les aplica reglas de
detección, genera alertas y da a administradores, auditores y lectores sus propias páginas; toda
cuenta inicia sesión con una contraseña y una app de autenticación (TOTP).

Este manual es para el operador que ejecuta una instancia de Audit Hub para su empresa, y para los
desarrolladores que lo cambian. Explica cómo instalar, ejecutar, operar y cambiar Audit Hub, desde
una máquina vacía hasta una instancia en producción, con todos los comandos que trae. Cada paso
dice qué ejecutar, qué hace y qué deberías ver. Las demás páginas de `docs/` (en inglés) contienen
los motivos y el detalle; esta es el recorrido por ellas. Conectar una aplicación:
[audit/connection-guide.es.md](audit/connection-guide.es.md). Los documentos legales (el contrato
de encargo, los párrafos del aviso de privacidad, el procedimiento ARCO):
[privacy/](privacy/README.es.md).

Convenciones:

- Los comandos se ejecutan desde la raíz del repositorio salvo que un paso diga otra cosa. En
  Windows usa **Git Bash** (se instala con Git for Windows): todos los comandos están escritos para
  él.
- Lo que va entre `<ángulos>` es un valor que sustituyes. `OWNER/REPO` es tu repositorio de GitHub.
- **REQUIERE CONFIGURACIÓN** marca un paso que solo tu instancia puede completar (un proveedor, una
  cuenta, una decisión); Audit Hub lo deja preparado pero no puede hacerlo por ti.
- `pnpm <script>` ejecuta un script de la raíz; `pnpm --filter api <script>` y
  `pnpm --filter web <script>` ejecutan un script de una sola app.
- Los mensajes que imprimen las herramientas se citan tal cual, en inglés: así los encuentras al
  buscarlos.

## Contenido

1. [Antes de empezar](#1-antes-de-empezar)
2. [Prepara Audit Hub](#2-prepara-audit-hub)
3. [Desarrollo diario](#3-desarrollo-diario)
4. [Tests](#4-tests)
5. [Commits, pushes y pull requests](#5-commits-pushes-y-pull-requests)
6. [Configuración](#6-configuración)
7. [Referencia de comandos](#7-referencia-de-comandos)
8. [CI/CD](#8-cicd)
9. [Releases](#9-releases)
10. [Desplegar y hacer rollback](#10-desplegar-y-hacer-rollback)
11. [Infraestructura opcional](#11-infraestructura-opcional)
12. [Operar en producción](#12-operar-en-producción)
13. [Calendario de mantenimiento](#13-calendario-de-mantenimiento)
14. [Cuando algo falla](#14-cuando-algo-falla)
15. [Apéndice: puertos, cuentas y ficheros](#15-apéndice-puertos-cuentas-y-ficheros)

## 1. Antes de empezar

### 1.1 Instala las herramientas

| Herramienta           | Versión                                     | Comprobar                | Notas                                                                                                                                    |
| --------------------- | ------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js               | 24.15 o posterior, o 26+ (`.nvmrc`: 24)     | `node --version`         | nvm (`nvm install 24 && nvm use`), fnm (`fnm use`), Volta o el instalador oficial. Las versiones anteriores se rechazan.                 |
| pnpm                  | 12.5.1 (`packageManager` en `package.json`) | `pnpm --version`         | `corepack enable` una vez, y Corepack (incluido en Node) aporta la versión exacta. Sin Corepack: `npm install -g pnpm@12.5.1`.           |
| Docker con Compose v2 | cualquier versión actual                    | `docker compose version` | Docker Desktop (Windows, macOS) o Docker Engine (Linux). Hace falta para la base de datos, las imágenes y las herramientas de seguridad. |
| Git                   | cualquier versión actual                    | `git --version`          | Windows: Git for Windows, que trae Git Bash y `openssl`.                                                                                 |
| openssl               | cualquiera                                  | `openssl version`        | Genera secretos. Sin él: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.                                |
| GitHub CLI (opcional) | cualquier versión actual                    | `gh --version`           | Solo para los ajustes del repositorio de [2.9](#29-configura-github); todo se puede hacer también en la web.                             |

Disco: la imagen de la base de datos de desarrollo es pequeña; las imágenes de producción ocupan
alrededor de 1 GB cada una, el backend local de observabilidad (opcional) unos 3.7 GB y el escáner
DAST otros 3.7 GB.

### 1.2 Notas para Windows

- Si `pnpm db:up` falla con "port is already allocated" o "bind failed", Windows suele reservar el
  puerto de la base de datos (5452): usa otro ([2.4](#24-crea-los-ficheros-de-entorno)).
- Git Bash reescribe las rutas que empiezan por `/` cuando se las pasa a `docker`. Antepón
  `MSYS_NO_PATHCONV=1` a esos comandos (se indica donde hace falta).
- Docker Desktop tiene que estar arrancado antes de cualquier comando que use Docker.

## 2. Prepara Audit Hub

Una vez por instancia (también en la máquina de un desarrollador), en este orden.

### 2.1 Obtén el código

El repositorio de Audit Hub es privado por ahora: pide a su dueño acceso a
`<URL del repositorio de Audit Hub>`. Cada instancia necesita un repositorio de GitHub propio,
donde se ejecutan su CI, sus imágenes y sus despliegues ([2.9](#29-configura-github)). Haz un fork
en GitHub dentro de tu organización (el fork de un repositorio privado también es privado) y
clona el fork, o clónalo:

```
git clone <URL del repositorio de Audit Hub> audit-hub
cd audit-hub
```

Conserva su historial: `CHANGELOG.md` y la versión (`.release-please-manifest.json`) continúan
desde él, y `git log` sigue diciendo de dónde vino cada cambio.

### 2.2 Pon tus contactos (REQUIERE CONFIGURACIÓN)

| Dónde                | Qué cambiar                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `SECURITY.md`        | el contacto privado para reportar vulnerabilidades, y los tiempos de respuesta si los tuyos son otros |
| `.github/CODEOWNERS` | usuarios o equipos reales en lugar de los marcadores, sin comentar                                    |
| `README.md`          | el título y el primer párrafo, solo si cambias la marca de Audit Hub                                  |

Todo lo demás se queda como está: los nombres de los paquetes, los títulos de la página y de la
API, `CHANGELOG.md` y la versión son los de Audit Hub. Los contactos de los runbooks de incidentes
y los marcadores de los documentos de privacidad llegan más adelante
([2.8](#28-decisiones-de-tu-instancia-requiere-configuración),
[2.10](#210-antes-de-la-primera-release-en-producción)).

### 2.3 Instala

```
corepack enable        # una vez por máquina (Node.js 25+: antes npm install -g corepack)
pnpm install
```

Instala todas las apps, genera el cliente de Prisma (`prisma generate`) e instala los hooks de Git
(Husky configura `core.hooksPath`). Rechaza versiones de Node.js fuera de `engines`, paquetes
publicados hace menos de siete días y scripts de instalación nuevos que nadie ha revisado
([14](#14-cuando-algo-falla) lista los mensajes).

### 2.4 Crea los ficheros de entorno

```
cp apps/api/.env.example apps/api/.env
openssl rand -hex 32
```

Pega el valor impreso como `JWT_ACCESS_SECRET=` en `apps/api/.env`. Es el único valor que la API
necesita para arrancar en local; el fichero documenta todas las demás variables. Ya apunta el correo
al Mailpit local ([11.5](#115-correo)); borra `MAIL_SMTP_URL` para trabajar sin él.

Docker Compose lee el `.env` de la raíz. Créalo cuando necesites alguno de sus ajustes:

```
cp .env.example .env
```

- **Puerto 5452 ocupado:** la base de datos usa el 5452 y no el 5432 de PostgreSQL, para no chocar
  con un PostgreSQL instalado en la máquina. Si el 5452 también está ocupado: `DB_PORT=5443` en el
  `.env` de la raíz, y el mismo puerto en `DATABASE_URL` de `apps/api/.env`
  (`postgresql://app:app@localhost:5443/app`).
- **El stack tipo producción** ([2.7](#27-comprueba-que-pasan-todos-los-gates)): `JWT_ACCESS_SECRET`,
  `AUDIT_SECRETS_KEY` y `AUDIT_INTEGRITY_KEY` también en el `.env` de la raíz (un `openssl rand -hex 32` para cada uno).
- **Puertos 1045 u 8045 ocupados** (el SMTP y la web de Mailpit; no sus habituales 1025 y 8025,
  que puede tener el Mailpit de otro proyecto): `MAILPIT_SMTP_PORT` y `MAILPIT_UI_PORT` en el `.env`
  de la raíz, y el puerto SMTP en `MAIL_SMTP_URL` de `apps/api/.env`.
- **Redis local** ([11.1](#111-redis)): `REDIS_PASSWORD` en el `.env` de la raíz (la salida de
  `openssl rand -hex 24`, pegada como valor).

`apps/web/.env.example` lista los ajustes opcionales de la web; ninguno es necesario.

Nunca hagas commit de un fichero `.env`: `.gitignore`, el hook de pre-commit y los escaneos de
secretos los rechazan.

### 2.5 Crea la base de datos

```
pnpm db:up        # PostgreSQL 18 en Docker, solo en 127.0.0.1, datos en el volumen db_data
pnpm db:migrate   # aplica todas las migraciones y regenera el cliente de Prisma
pnpm db:seed      # cuentas de desarrollo (contraseñas públicas; rechaza bases de datos no locales)
```

El seed imprime las cuentas, una por rol: `admin@example.com` / `admin-password`,
`auditor@example.com` / `auditor-password`, `viewer@example.com` / `viewer-password` y
`member@example.com` / `member-password`, y su segundo factor: añade la clave
`JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` a una app de autenticación ("introducir una clave", basada en
tiempo) y escribe su código después de la contraseña. Es idempotente: vuelve a ejecutarlo cuando
quieras recuperarlas. El auditor y el lector inician sesión cuando ven una aplicación
(`pnpm dev:demo`, [2.6](#26-arráncalo), les asigna las suyas); el miembro nunca: muestra el rechazo
([11.7](#117-audit-hub-verificación-en-dos-pasos-acceso-y-exportaciones)).

### 2.6 Arráncalo

```
pnpm dev
```

Arranca la base de datos y Mailpit (`pnpm services:up`, si estaban parados) y después la API y la
web con recarga en caliente, e imprime estas direcciones en un recuadro bajo sus logs, también tras
cada reinicio:

| Qué                               | URL                                             |
| --------------------------------- | ----------------------------------------------- |
| Web                               | http://localhost:5273                           |
| API                               | http://127.0.0.1:3200/api                       |
| Documentación de la API (Swagger) | http://localhost:3200/api/docs                  |
| Liveness / readiness de la API    | http://127.0.0.1:3200/api/health/live, `/ready` |
| Correos que envió la API          | http://localhost:8045 (Mailpit)                 |

Abre la web e inicia sesión con una cuenta del seed y el código de tu app de autenticación (o el que
imprime `pnpm dev:totp`). La primera línea de log de la API dice qué está activo:
`Starting release unversioned in development: tracing and metrics off, error tracking off, Redis off, email on`.

Las páginas de administración están vacías hasta que las aplicaciones envían sus registros de
auditoría. `pnpm dev:demo` las llena por las interfaces reales de Audit Hub: registra tres
aplicaciones (como el administrador del seed), envía tres semanas de su actividad (con las alertas
que habría producido en esas semanas ya revisadas) y escenifica algunos ataques en el momento, para
que aparezcan las alertas (unas al instante, el resto en menos de cinco minutos). También asigna
esas aplicaciones al auditor y al lector del seed, para que puedan iniciar sesión. Ejecútalo una
vez, con `pnpm dev` en marcha; una segunda ejecución no cambia nada más (vuelve a dar al auditor y
al lector del seed las aplicaciones de la demo si las perdieron).

Para con `Ctrl+C`. `pnpm db:down` retira los contenedores de la base de datos y de Mailpit; los datos
de la base de datos se quedan en su volumen de Docker (los mensajes de Mailpit no), y los servicios
opcionales siguen funcionando hasta `docker compose --profile <perfil> down`.

### 2.7 Comprueba que pasan todos los gates

Ejecútalo una vez ahora, para saber que la máquina está preparada como CI:

```
pnpm verify                              # formato, lint, tipos, tests unitarios + cobertura, seguridad, build, presupuesto
pnpm test:integration                    # API contra PostgreSQL (y Redis, si está configurado)
pnpm exec playwright install chromium    # una vez por máquina
pnpm test:e2e                            # tests de navegador sobre el build (necesita pnpm build, que ya hace verify)
pnpm test:scripts                        # tests de los scripts del repositorio (selección de Semgrep, Doberman)
pnpm sast                                # Semgrep (Docker; unos minutos, ver 14)
pnpm lint:workflows                      # actionlint + zizmor + shellcheck (Docker)
pnpm observability:check                 # dashboards y reglas de alerta, promtool (Docker)
pnpm iac:check                           # Terraform, TFLint, Trivy, cloud-init, roles de la base de datos (Docker)
docker compose --profile stack up --build   # imágenes de producción en http://localhost:8180
```

Para el último, el `.env` de la raíz necesita `JWT_ACCESS_SECRET`, `AUDIT_SECRETS_KEY` y `AUDIT_INTEGRITY_KEY`. En otra terminal,
`pnpm smoke --url http://localhost:8180` debe terminar con
`Smoke test passed (public URL only).` Páralo con `Ctrl+C` y después
`docker compose --profile stack down`.

### 2.8 Decisiones de tu instancia (REQUIERE CONFIGURACIÓN)

Tómalas antes de producción; la hoja de trabajo de la guía paso a paso reúne las respuestas
([fase 0](step-by-step.es.md#fase-0-información-y-decisiones)).

- **Las aplicaciones que vas a conectar**, y en qué entornos: una aplicación por backend y por
  entorno ([Qué aplicaciones registrar](audit/connection-guide.es.md#qué-aplicaciones-registrar)).
- **Quién inicia sesión:** los administradores (al menos dos: nadie restablece su propio segundo
  factor, y una acción de respuesta necesita por defecto la aprobación de un segundo
  administrador), los auditores y lectores, y las aplicaciones que ve cada auditor o lector
  ([11.7](#117-audit-hub-verificación-en-dos-pasos-acceso-y-exportaciones)). Las personas llegan
  por invitación (con correo, [11.5](#115-correo)), con su rol y, para auditores y lectores, sus
  aplicaciones; cada cuenta configura su app de autenticación en su primer inicio de sesión. No
  hay registro público: `SIGN_UP_ENABLED=true` detiene el arranque.
- **La retención de cada aplicación:** los mínimos, que también son los valores por defecto
  (seguridad 730 días, auditoría 365, acceso 180, sistema 30, acceso a la auditoría 730, datos
  personales 90, coordenadas 30: [database.md](database.md#audit-hubs-audit-tables)), o más donde
  lo pida el contrato de un cliente o una ley (Retention, en las páginas de administración).
- **Los canales de alertas:** el correo a los administradores y auditores ([11.5](#115-correo)),
  un canal de Slack o un flujo de Teams
  ([11.6](#116-audit-hub-avisos-de-alertas-y-geolocalización-por-ip)), y quién los lee.
- **Geolocalización por IP** (opcional): los ficheros de DB-IP Lite, descargados cada mes
  ([11.6](#116-audit-hub-avisos-de-alertas-y-geolocalización-por-ip),
  [deploy-vps.md](deploy-vps.md#ip-geolocation)); sin ellos no corren las reglas de país, viaje y
  hosting.
- **Dónde se guardan los resúmenes (digests) de los checkpoints de integridad:** fuera de Audit
  Hub, lejos del alcance de quien tenga su base de datos y `AUDIT_INTEGRITY_KEY`
  ([security.md](security.md#audit-log-integrity-retention-and-erasure)). Cada día se hace un
  checkpoint; la página Integrity muestra el último, y `audit checkpoint` hace uno en el momento
  ([7.2](#72-scripts-de-la-api-pnpm---filter-api-script)).
- **La figura legal** ([privacy/README.es.md](privacy/README.es.md#figuras)): si operas Audit Hub
  para las aplicaciones de otras empresas, eres su encargado y cada una es el responsable, con un
  [contrato de encargo](privacy/processor-contract.es.md) con cada una; si lo operas para las
  aplicaciones de tu propia empresa, ese contrato se convierte en una política interna. Para los
  usuarios de Audit Hub eres el responsable, con un aviso de privacidad propio. Cada aplicación
  conectada añade a su aviso los párrafos de [privacy-notice.es.md](privacy/privacy-notice.es.md).
  Un abogado revisa cada documento antes de usarlo.
- **Las integraciones opcionales:** Redis (más de una instancia de la API), Sentry, OpenTelemetry
  ([11](#11-infraestructura-opcional)).

Para los desarrolladores que cambian Audit Hub:

- Los umbrales de las reglas de detección (`apps/api/src/rules/rules.constants.ts`) son puntos de
  partida, que se ajustan con tráfico real en un cambio revisado
  ([security.md](security.md#detection-rules)).
- Los umbrales de cobertura y el presupuesto de rendimiento son mínimos; ajústalos de forma
  deliberada ([testing.md](testing.md#coverage)).
- La política de licencias de las dependencias (`scripts/dependency-policy.json`), si la forma de
  distribuir Audit Hub exige una más estricta o más laxa.
- `docs/template/` conserva la historia de la plantilla web de la que partió Audit Hub.

### 2.9 Configura GitHub

El primer commit y el único push directo a `main` que recibirá de ti el repositorio (el hook de
pre-push rechaza cualquier otro):

```
git add -A
git commit -m "chore: set the security contact and code owners"
git remote rename origin upstream
git remote add origin <URL de tu repositorio>
git push --no-verify -u origin main
```

El commit pasa el hook de pre-commit por los ficheros que cambiaste. Las dos líneas `git remote`
conservan el repositorio de Audit Hub como `upstream` y apuntan `origin` al tuyo; con un fork,
`origin` ya es tu fork: sáltalas, y activa los workflows del fork en su pestaña **Actions** (GitHub
los deja apagados en un fork). Los mensajes de commit van en inglés, como el resto del repositorio
([commits.md](commits.md)).

Después, los ajustes del repositorio (REQUIERE CONFIGURACIÓN), en la web o con `gh`:

| Ajuste                                                                                                      | Dónde / comando                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solo squash merge, mensaje por defecto = título del pull request, borrar ramas tras el merge                | Settings → General → Pull Requests                                                                                                                                            |
| Ruleset de `main`: pull requests, **CI passed** y **Conventions**, code owners, sin force push              | `gh api repos/OWNER/REPO/rulesets --method POST --input .github/rulesets/main.json` (repositorio público o plan de pago)                                                      |
| Tags de release `v*` inmutables                                                                             | `gh api repos/OWNER/REPO/rulesets --method POST --input .github/rulesets/tags.json`                                                                                           |
| Token por defecto de solo lectura para los workflows                                                        | Settings → Actions → General → Workflow permissions → Read repository contents; marca "Allow GitHub Actions to create and approve pull requests" (el pull request de release) |
| Entornos `staging` y `production`, ramas de despliegue "solo `main`", revisores en producción               | Settings → Environments                                                                                                                                                       |
| Token opcional para los pull requests de release (todos los workflows de pull request se ejecutan en ellos) | `gh secret set RELEASE_PLEASE_TOKEN` (token de una GitHub App o fine-grained: contents, pull requests, issues)                                                                |
| Registro de las imágenes                                                                                    | `gh variable set IMAGE_PREFIX --body ghcr.io/OWNER/REPO`                                                                                                                      |
| DAST pasivo de staging, cuando exista                                                                       | `gh variable set DAST_STAGING_URL --body https://<host de staging>`                                                                                                           |
| CodeQL y dependency review (repositorio público o GitHub Advanced Security)                                 | `gh variable set ENABLE_CODEQL --body true`, `gh variable set ENABLE_DEPENDENCY_REVIEW --body true`                                                                           |
| Alertas y actualizaciones de seguridad de Dependabot, reporte privado de vulnerabilidades, push protection  | Settings → Code security                                                                                                                                                      |
| Secretos de despliegue de un entorno                                                                        | `gh secret set <NOMBRE> --env production` (o el gestor de secretos de la plataforma)                                                                                          |

Detalles y motivos: [ci-cd.md](ci-cd.md#repository-settings-requiere-configuración).

### 2.10 Antes de la primera release en producción

Recorre [production-readiness.md](production-readiness.md): backups y un simulacro de restore,
alertas y SLOs, el job de despliegue, los contactos de los runbooks de incidentes. Las secciones
[10](#10-desplegar-y-hacer-rollback) y [12](#12-operar-en-producción) de este manual los explican.
Audit Hub añade los suyos: las claves (`AUDIT_SECRETS_KEY`, `AUDIT_INTEGRITY_KEY`) en el gestor de
secretos, los resúmenes de los checkpoints guardados fuera, las políticas de retención definidas,
una aplicación de prueba conectada de punta a punta, los canales de alertas probados y los
documentos de privacidad revisados por un abogado
([step-by-step.es.md](step-by-step.es.md#fase-11-antes-de-los-usuarios-reales)).

## 3. Desarrollo diario

### 3.1 Empieza el día

```
git switch main
git pull
pnpm install          # cuando cambió pnpm-lock.yaml
pnpm db:migrate       # cuando cambió apps/api/prisma/migrations/
pnpm dev
```

Si `apps/api/.env.example` tiene una variable nueva, cópiala a tu `apps/api/.env`. Si el editor
muestra tipos antiguos después de un pull, ejecuta "TypeScript: Restart TS Server" (VS Code).

### 3.2 Empieza un cambio

1. El issue cumple la [Definition of Ready](definition-of-ready.md) (la plantilla de feature pide
   cada punto).
2. Una rama desde `main` actualizado, con el nombre `<tipo>/<descripción>`:

   ```
   git switch -c feat/ABC-123-user-invitations
   ```

   Tipos: `feat`, `fix`, `hotfix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`,
   `release`. Comprueba un nombre con `node scripts/check-branch-name.mjs <nombre>`.

### 3.3 Haz el cambio

Recetas paso a paso, con código que pasa todos los gates, en [how-to.md](how-to.md):

| Cambio                                           | Receta                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Una tabla o una columna                          | [Add a table or a column](how-to.md#add-a-table-or-a-column)                               |
| Un recurso nuevo de la API                       | [Add an API module](how-to.md#add-an-api-module)                                           |
| Una ruta más                                     | [Add an endpoint](how-to.md#add-an-endpoint-to-an-existing-module)                         |
| Un cambio de contrato                            | [Change the API contract](how-to.md#change-the-api-contract)                               |
| Una pantalla                                     | [Add a screen](how-to.md#add-a-screen-to-the-web-app)                                      |
| Un test de navegador                             | [Add an end-to-end test](how-to.md#add-an-end-to-end-test)                                 |
| Un valor de configuración                        | [Add an environment variable](how-to.md#add-an-environment-variable)                       |
| Un rol                                           | [Add a role](how-to.md#add-a-role)                                                         |
| Una dependencia                                  | [Add a dependency](how-to.md#add-a-dependency)                                             |
| Una lectura cacheada                             | [Cache a read](how-to.md#cache-a-read)                                                     |
| Una llamada a una API de terceros                | [Call an external service](how-to.md#call-an-external-service)                             |
| Un job en una sola instancia, un mensaje una vez | [Run a job on one instance](how-to.md#run-a-job-on-one-instance-or-process-a-message-once) |
| Otra app o un worker                             | [Add another app](how-to.md#add-another-app-or-a-background-worker)                        |

Las reglas que sigue todo cambio: [ENGINEERING_STANDARDS.md](../ENGINEERING_STANDARDS.md).

### 3.4 Cambia el contrato de la API

Primero el contrato: escribe los esquemas Zod y las firmas del controlador, y después

```
pnpm contract
```

Regenera los JSON Schema del contrato de integración (`packages/audit-contract/schema/v1`, desde
sus esquemas Zod), exporta `openapi/openapi.json` desde el código y regenera
`apps/web/src/api/schema.d.ts`. Revisa los diffs, haz commit de los ficheros generados y no los
edites nunca a mano. Swagger UI
muestra el resultado en http://localhost:3200/api/docs mientras corre `pnpm dev`
([openapi/README.md](../openapi/README.md)).

### 3.5 Cambia la base de datos

1. Edita `apps/api/prisma/schema.prisma`.
2. Crea y aplica la migración, y regenera el cliente:

   ```
   pnpm db:migrate --name add_invitations
   ```

3. Lee el SQL generado en `apps/api/prisma/migrations/<timestamp>_add_invitations/migration.sql`:
   bloqueos en tablas grandes, valores por defecto, avisos de pérdida de datos.
4. Mantenla compatible con la versión que corre ahora (expand and contract) y sigue las reglas de
   migraciones seguras: [database.md](database.md#safe-migrations).

Otros comandos de base de datos:

| Comando                                        | Qué hace                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm --filter api exec prisma migrate status` | qué migraciones tiene aplicadas la base de datos de `DATABASE_URL`                   |
| `pnpm --filter api db:deploy`                  | `prisma migrate deploy`: aplica las migraciones pendientes, nunca crea una           |
| `pnpm --filter api exec prisma migrate reset`  | **solo desarrollo**: borra la base de datos y vuelve a aplicar todas las migraciones |
| `pnpm --filter api exec prisma generate`       | regenera el cliente (los comandos dev, lint, typecheck y test ya lo hacen)           |
| `pnpm --filter api exec prisma studio`         | una interfaz web sobre la base de datos de desarrollo                                |
| `docker compose exec db psql -U app -d app`    | una consola SQL en la base de datos de desarrollo                                    |

Nunca edites una migración que ya llegó a `main`; corrige hacia delante con una nueva.

### 3.6 Antes de hacer push

```
pnpm verify
```

Ejecuta, en orden y parando en el primer fallo: comprobación de formato, lint, typecheck, tests
unitarios y de componentes con cobertura, `pnpm security` (auditoría de dependencias, política de
dependencias, escaneo de secretos), build y presupuesto de rendimiento. Ejecuta también
`pnpm test:integration` si cambió la API y `pnpm test:e2e` si cambió un flujo de usuario.
Arreglos rápidos:

```
pnpm format        # reescribe los ficheros al estilo de Prettier
pnpm lint:fix      # aplica los arreglos automáticos de ESLint
```

## 4. Tests

| Tipo                       | Comando                                                             | Necesita                                       | Ficheros                                 |
| -------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------- |
| Unitarios y de componentes | `pnpm test`                                                         | nada                                           | `*.spec.ts`, `*.spec.tsx`                |
| Con cobertura              | `pnpm test:coverage`                                                | nada                                           | informes en `apps/*/coverage/index.html` |
| Modo watch                 | `pnpm --filter api test:watch`, `pnpm --filter web test:watch`      | nada                                           |                                          |
| Un fichero                 | `pnpm --filter api exec vitest run src/users/users.service.spec.ts` | nada                                           |                                          |
| Integración                | `pnpm test:integration`                                             | `pnpm db:up`; Redis opcional                   | `apps/api/src/**/*.int.spec.ts`          |
| End-to-end                 | `pnpm test:e2e`                                                     | `pnpm db:up`, `pnpm build`, Chromium instalado | `e2e/*.e2e.ts`                           |
| End-to-end, interactivo    | `pnpm exec playwright test --ui`                                    | lo mismo                                       |                                          |
| Un solo test end-to-end    | `pnpm exec playwright test --grep "keeps members out"`              | lo mismo                                       |                                          |
| Último informe end-to-end  | `pnpm exec playwright show-report`                                  | una ejecución anterior                         | `playwright-report/`                     |

- **Los tests de integración** crean y migran `<db>_test` en el servidor de `DATABASE_URL`, nunca
  tocan la base de datos de desarrollo y se ejecutan de fichero en fichero.
- **Los specs de Redis** se ejecutan cuando hay una URL de Redis: arranca Redis
  ([11.1](#111-redis)) con `REDIS_URL` en `apps/api/.env`, o pásala para una ejecución:
  `REDIS_TEST_URL=redis://:<contraseña>@127.0.0.1:6389 pnpm test:integration`. Sin ella se saltan
  en local; `CI=true` los hace obligatorios, como en CI.
- **Los tests end-to-end** usan `<db>_e2e` (se vuelve a sembrar en cada ejecución), la API compilada
  en el puerto 3300 y la web compilada en el 4273: para cualquier otra cosa que use esos puertos.

Cómo escribir tests, mocks, fixtures y el trinquete de cobertura: [testing.md](testing.md).

## 5. Commits, pushes y pull requests

### 5.1 Commit

```
git add <ficheros>
git commit -m "feat(api): paginate the user list"
```

El mensaje es un Conventional Commit, en inglés: `<type>(<scope opcional>): <resumen>`, con los
tipos `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`,
`revert`; `!` y un pie `BREAKING CHANGE:` para los cambios incompatibles ([commits.md](commits.md)).
Para comprobar un mensaje sin hacer commit:
`printf 'feat(api): paginate the user list\n' | pnpm exec commitlint`.

Los hooks se ejecutan solos:

| Hook         | Ejecuta                                                                                                                                                          | Tarda        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `pre-commit` | sobre los ficheros en stage: rechaza ficheros `.env`, secretlint, `eslint --fix`, `prettier --write`, la comprobación de pasos de contracción de las migraciones | segundos     |
| `commit-msg` | commitlint                                                                                                                                                       | menos de 1 s |
| `pre-push`   | rechaza pushes a `main`/`master` y ramas mal nombradas, después `pnpm typecheck` y `pnpm test`                                                                   | unos 30 s    |

`--no-verify` se los salta: solo para el primer push de un repositorio nuevo o una emergencia real,
y diciéndolo en el pull request ([git-hooks.md](git-hooks.md)). CI ejecuta las mismas
comprobaciones igualmente.

### 5.2 Push y pull request

```
git push -u origin HEAD
gh pr create --fill        # o ábrelo en GitHub
```

- Rellena la plantilla del pull request; su título es un Conventional Commit (se convierte en el
  commit de `main` y en la línea del changelog).
- Espera a **CI passed** y **Conventions** ([8](#8-cicd)); si falla, lee el log del job y arréglalo
  en la rama.
- Consigue una revisión ([code-review.md](code-review.md)) y responde a cada comentario.
- Squash merge y borra la rama. El cambio está terminado cuando se cumple la
  [Definition of Done](../DEFINITION_OF_DONE.md).

## 6. Configuración

### 6.1 Dónde vive la configuración

| Fichero                 | Lo lee                                                                | En git |
| ----------------------- | --------------------------------------------------------------------- | ------ |
| `apps/api/.env`         | la API y el CLI de Prisma, en desarrollo                              | nunca  |
| `apps/api/.env.example` | documentación de todas las variables de la API                        | sí     |
| `.env` (raíz)           | Docker Compose: puertos, el secreto del stack, la contraseña de Redis | nunca  |
| `.env.example` (raíz)   | documentación de las variables de Compose                             | sí     |
| `apps/web/.env.example` | los ajustes opcionales de la web                                      | sí     |

Las variables definidas en el entorno ganan a los ficheros `.env`; los despliegues las toman del
gestor de secretos de la plataforma. La API valida todo al arrancar y se detiene nombrando la
variable si un valor es incorrecto: `Environment variable JWT_ACCESS_SECRET is invalid: ...`.

### 6.2 Variables de la API

Obligatorias: `NODE_ENV`, `DATABASE_URL`, `JWT_ACCESS_SECRET`; en producción también `TRUST_PROXY`,
`AUDIT_SECRETS_KEY` y `AUDIT_INTEGRITY_KEY`.
Todo lo demás tiene un valor por defecto seguro. La tabla completa con cada regla:
[environment.md](environment.md).

| Grupo             | Variables (valor por defecto)                                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ejecución         | `NODE_ENV` (ninguno), `HOST` (127.0.0.1; todas las interfaces en producción), `PORT` (3000; 3200 en `apps/api/.env.example`, la API de desarrollo)                                                                                                                                                       |
| Base de datos     | `DATABASE_URL` (ninguno), `DB_SLOW_QUERY_MS` (500), `DB_POOL_MAX` (10), `DB_STATEMENT_TIMEOUT_MS` (30000)                                                                                                                                                                                                |
| Autenticación     | `JWT_ACCESS_SECRET` (ninguno), `JWT_ACCESS_SECRET_PREVIOUS` (sin definir), `AUTH_COOKIE_SAMESITE` (strict)                                                                                                                                                                                               |
| Audit Hub         | `AUDIT_SECRETS_KEY` (obligatoria en producción; fuera de producción se deriva de `JWT_ACCESS_SECRET`), `AUDIT_SECRETS_KEY_PREVIOUS` (sin definir), `AUDIT_INTEGRITY_KEY` (obligatoria en producción; fuera de producción se deriva de `JWT_ACCESS_SECRET`), `AUDIT_INTEGRITY_KEY_PREVIOUS` (sin definir) |
| HTTP              | `CORS_ORIGINS` (vacío), `APP_ORIGIN` (sin definir; defínela en producción; obligatoria con correo), `TRUST_PROXY` (loopback; obligatoria en producción), `RATE_LIMIT_MAX` (100), `RATE_LIMIT_WINDOW_SEC` (60)                                                                                            |
| Logs e identidad  | `LOG_LEVEL` (log), `LOG_FORMAT` (json en producción, si no text), `APP_ENVIRONMENT` (NODE_ENV), `APP_RELEASE` (de la imagen, si no unversioned)                                                                                                                                                          |
| Error tracking    | `SENTRY_DSN` (sin definir: apagado), `SENTRY_SAMPLE_RATE` (1)                                                                                                                                                                                                                                            |
| Trazas y métricas | `OTEL_EXPORTER_OTLP_ENDPOINT` (sin definir: apagado), `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SDK_DISABLED` (false), `OTEL_SERVICE_NAME` (api), `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`, `OTEL_METRIC_EXPORT_INTERVAL` (60000), `OTEL_RESOURCE_ATTRIBUTES`                                          |
| Redis             | `REDIS_URL` (sin definir: apagado), `REDIS_KEY_PREFIX` (app:), `REDIS_REQUIRED` (false), `REDIS_COMMAND_TIMEOUT_MS` (500), `RATE_LIMIT_STORE` (memory), `CACHE_STORE` (memory)                                                                                                                           |
| Correo            | `MAIL_SMTP_URL` (sin definir: apagado), `MAIL_FROM` (obligatoria con ella), `MAIL_MAX_ATTEMPTS` (8), `MAIL_DAILY_LIMIT_PER_ADDRESS` (10), `SIGN_UP_ENABLED` (false; `true` detiene el arranque: no hay registro público)                                                                                 |

### 6.3 Variables de la web

Se definen en el contenedor web (la imagen de producción) y la app las recibe en
`/app-config.json`; los servidores de desarrollo y preview de Vite leen los mismos nombres de su
entorno:

`API_UPSTREAM` (http://api:3000, la API a la que el servidor web reenvía `/api`), `APP_ENVIRONMENT`
(production), `APP_RELEASE` (lo fija el build de la imagen), `WEB_SENTRY_DSN` (vacío: apagado),
`WEB_SENTRY_SAMPLE_RATE` (1), `WEB_VITALS_SAMPLE_RATE` (1, la proporción de cargas de página que
informan de sus Web Vitals; 0: apagado). Solo en desarrollo: `API_PROXY_TARGET`
(http://127.0.0.1:3200).
Todo lo que se llame `VITE_*` se compila en el bundle público: nunca un secreto.

### 6.4 Variables de Compose (`.env` de la raíz)

`DB_PORT` (5452), `MAILPIT_SMTP_PORT` (1045), `MAILPIT_UI_PORT` (8045), `JWT_ACCESS_SECRET`,
`AUDIT_SECRETS_KEY` y `AUDIT_INTEGRITY_KEY` (la API del stack), `WEB_PORT` (8180), `REDIS_PASSWORD`
(solo la exige el perfil `redis`), `REDIS_PORT` (6389), `OTLP_HTTP_PORT` (4328), `GRAFANA_PORT`
(3201), `PROMETHEUS_PORT` (9190), `APP_RELEASE` (la release de las imágenes del stack, por defecto `local`) y las
integraciones opcionales del stack: `STACK_REDIS_URL`, `STACK_RATE_LIMIT_STORE`,
`STACK_CACHE_STORE`, `STACK_OTEL_EXPORTER_OTLP_ENDPOINT`, `STACK_SENTRY_DSN`,
`STACK_WEB_SENTRY_DSN`.

### 6.5 Por entorno

| Ajuste                   | desarrollo                    | CI                                       | staging                  | producción               |
| ------------------------ | ----------------------------- | ---------------------------------------- | ------------------------ | ------------------------ |
| `NODE_ENV`               | `development`                 | `test`                                   | `production`             | `production`             |
| `APP_ENVIRONMENT`        | por defecto                   | por defecto                              | `staging`                | `production`             |
| `TRUST_PROXY`            | por defecto                   | por defecto                              | el número real de saltos | el número real de saltos |
| Secretos                 | `apps/api/.env`, `.env` raíz  | generados en cada ejecución              | gestor de secretos       | gestor de secretos       |
| Integraciones opcionales | apagadas, o servicios locales | apagadas (servicio Redis para sus specs) | según se decida          | según se decida          |

## 7. Referencia de comandos

Todos los comandos que trae Audit Hub.

### 7.1 Scripts de la raíz (`pnpm <script>`)

| Comando                                                                     | Qué hace                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install`                                                              | instala el workspace; ejecuta `prepare` (instala los hooks de Git) y el `postinstall` de la API (`prisma generate`)                                                                                          |
| `pnpm dev`                                                                  | `pnpm services:up`, y después la API (`nest start --watch`) y la web (Vite) en paralelo; sus URLs en un recuadro bajo los logs                                                                               |
| `pnpm dev:totp`                                                             | el código actual del segundo factor de las cuentas de desarrollo (la clave pública del seed), para iniciar sesión sin app de autenticación                                                                   |
| `pnpm dev:demo`                                                             | datos de demostración para las páginas de administración: tres aplicaciones, tres semanas de actividad y algunos ataques, por la API real (con `pnpm dev` en marcha; [2.6](#26-arráncalo))                   |
| `pnpm build`                                                                | compila todas las apps (`apps/*/dist`)                                                                                                                                                                       |
| `pnpm lint`                                                                 | ESLint sobre todo el repositorio, sin warnings permitidos                                                                                                                                                    |
| `pnpm lint:fix`                                                             | lo mismo, aplicando los arreglos automáticos                                                                                                                                                                 |
| `pnpm format`                                                               | Prettier reescribe todos los ficheros                                                                                                                                                                        |
| `pnpm format:check`                                                         | Prettier informa de los ficheros sin formatear                                                                                                                                                               |
| `pnpm typecheck`                                                            | TypeScript en todas las apps, la comprobación de los tipos del contrato y los scripts del repositorio                                                                                                        |
| `pnpm test`                                                                 | tests unitarios y de componentes de todas las apps                                                                                                                                                           |
| `pnpm test:coverage`                                                        | lo mismo con los umbrales de cobertura                                                                                                                                                                       |
| `pnpm test:integration`                                                     | la API contra PostgreSQL (y Redis y Mailpit si están configurados)                                                                                                                                           |
| `pnpm test:e2e`                                                             | Playwright sobre la app compilada                                                                                                                                                                            |
| `pnpm test:scripts`                                                         | los tests de los scripts del repositorio (`scripts/*.test.mjs`: selección de ficheros de Semgrep, motor de Doberman)                                                                                         |
| `pnpm security`                                                             | `pnpm audit --audit-level=high`, después `pnpm deps:check`, después `pnpm secrets:scan`                                                                                                                      |
| `pnpm deps:check`                                                           | política de dependencias: orígenes del registro con integridad, licencias y los ajustes de supply chain de `pnpm-workspace.yaml`                                                                             |
| `pnpm secrets:scan`                                                         | secretlint sobre todos los ficheros que git sigue o añadiría                                                                                                                                                 |
| `pnpm sast`                                                                 | Semgrep con la imagen fijada (Docker)                                                                                                                                                                        |
| `pnpm lint:workflows`                                                       | actionlint, zizmor y shellcheck con las imágenes fijadas (Docker)                                                                                                                                            |
| `pnpm observability:check`                                                  | los dashboards y las reglas de alerta de `observability/` (fuentes de datos, runbooks, nombres de métricas), después promtool y los tests unitarios de las reglas (Docker)                                   |
| `pnpm iac:check`                                                            | las comprobaciones de `infra/terraform`: fmt, validate, tests, TFLint, Trivy, cloud-init, roles de la base de datos (Docker)                                                                                 |
| `pnpm iac:database`                                                         | los roles de la base de datos de un entorno de DigitalOcean hecho con Terraform (`deploy-vps.md`)                                                                                                            |
| `pnpm sbom:generate`                                                        | SBOM CycloneDX de las dependencias de producción en `dist/sbom/sbom.cdx.json`                                                                                                                                |
| `pnpm perf:check`                                                           | tamaño gzip de los assets web compilados frente a `apps/web/performance-budget.json` (después de `pnpm build`)                                                                                               |
| `pnpm smoke --url <URL pública> --api <URL de la API> [--release <sha>]`    | smoke test de solo lectura de un despliegue en marcha ([10.3](#103-smoke-test))                                                                                                                              |
| `pnpm contract`                                                             | regenera los JSON Schema del contrato, exporta `openapi/openapi.json` y regenera los tipos del cliente web                                                                                                   |
| `pnpm connector <add\|status\|diff\|update\|migration> --target <proyecto>` | instala el conector de Audit Hub en un proyecto creado desde project-template-web, y lo mantiene al día ([11.9](#119-audit-hub-conectar-un-proyecto))                                                        |
| `pnpm examples <generate\|save> --kind web\|app [--force]`                  | los proyectos de ejemplo conectados en `.examples/web` y `.examples/app`: los genera desde las plantillas fijadas y sus parches, o guarda sus cambios en `examples/<kind>/template-patch/` y `overlay.patch` |
| `pnpm services:up`                                                          | `docker compose up --detach --wait db mailpit`: la base de datos y el capturador de correo                                                                                                                   |
| `pnpm db:up`                                                                | `docker compose up --detach --wait db`                                                                                                                                                                       |
| `pnpm db:down`                                                              | `docker compose down`: retira los contenedores de la base de datos y de Mailpit y conserva los datos de la base de datos; los servicios opcionales se paran con su perfil                                    |
| `pnpm db:migrate [--name <nombre>]`                                         | crea una migración a partir de los cambios del esquema, aplica las pendientes y regenera el cliente (desarrollo)                                                                                             |
| `pnpm db:seed`                                                              | cuentas de desarrollo (solo bases de datos locales; `--allow-remote-database` para una remota desechable)                                                                                                    |
| `pnpm verify`                                                               | `format:check` → `lint` → `typecheck` → `test:coverage` → `security` → `build` → `perf:check`                                                                                                                |

### 7.2 Scripts de la API (`pnpm --filter api <script>`)

| Script             | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`              | `prisma generate`, después `nest start --watch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `build`            | `prisma generate`, después `nest build` en `apps/api/dist`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `start`            | `node dist/main.js` (después de `build`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `typecheck`        | `prisma generate`, después `tsc --noEmit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `test`             | tests unitarios con Vitest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `test:watch`       | Vitest en modo watch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `test:coverage`    | tests unitarios con los umbrales de cobertura de `vitest.config.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `test:integration` | la suite de integración (`vitest.config.int.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `openapi:export`   | compila y escribe `openapi/openapi.json` (la mitad de `pnpm contract`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `db:migrate`       | `prisma migrate dev` + `prisma generate` (`scripts/migrate.mjs`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `db:deploy`        | `prisma migrate deploy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `db:seed`          | compila y ejecuta el seed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `user:create`      | crea una cuenta en la base de datos de `DATABASE_URL`, en cualquier entorno, con la contraseña por la entrada estándar: `printf '%s' "$PASSWORD" \| pnpm --filter api user:create --email <email> --name <nombre> --role admin` (`--role` es obligatorio: `admin`, o `auditor` o `viewer`, que inician sesión cuando un administrador les asigna una aplicación; [deploy-vps.md](deploy-vps.md#9-create-the-first-administrator) en un servidor)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `user:reset-mfa`   | quita el segundo factor de una cuenta y cierra sus sesiones, cuando perdió el teléfono y los códigos de recuperación: `pnpm --filter api user:reset-mfa --email <email> --reason "<motivo>"`; el siguiente inicio de sesión configura uno nuevo. Queda en el registro propio de Audit Hub ([security.md](security.md#second-factor-and-recent-authentication))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `dev:totp`         | el código actual del segundo factor del seed (`pnpm dev:totp` en la raíz), o el de la clave base32 que se le pase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `mail`             | los comandos de operación de la bandeja de salida del correo ([11.5](#115-correo)): `mail test --to <dirección>` (encola un mensaje de prueba y espera su entrega), `mail status [--to <dirección>]`, `mail retry --id <id> \| --failed [--kind <tipo>]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `audit`            | los comandos de integridad de Audit Hub, sobre la base de datos de `DATABASE_URL` (sin `--` antes de las opciones): `audit status` (flujos, sellos, últimas verificaciones), `audit verify [--app <slug>] [--since <fecha>]` (código de salida 1 si algo falla, nombrado por su id), `audit seal`, `audit checkpoint` (imprime el resumen que se guarda fuera de Audit Hub), `audit retention` (el barrido de retención ahora), `audit geoip [--ip <dirección>]` (los ficheros de geolocalización cargados, y una consulta), `audit export --app <slug> --from <fecha> --to <fecha> [--out <fichero>]`, `audit verify-export --file <fichero>` (sin conexión), `audit secrets:reencrypt` (tras rotar `AUDIT_SECRETS_KEY`), `audit app:delete --app <slug> --confirm <slug>` (el fin del servicio de una aplicación suspendida, [11.10](#1110-audit-hub-solicitudes-de-privacidad-sus-cuentas-y-el-fin-de-una-aplicación)) |
| `e2e:server`       | prepara `<db>_e2e` y arranca la API compilada para Playwright (lo lanza `pnpm test:e2e`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 7.3 Scripts de la web (`pnpm --filter web <script>`)

| Script          | Qué hace                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- |
| `dev`           | servidor de desarrollo de Vite en http://localhost:5273, con `/api` reenviado a la API    |
| `build`         | `tsc -b`, después `vite build` en `apps/web/dist`                                         |
| `preview`       | sirve el build en http://localhost:4273, con `/api` reenviado                             |
| `typecheck`     | comprueba `schema.d.ts` contra el contrato, después `tsc -b`                              |
| `test`          | tests de componentes y unitarios con Vitest                                               |
| `test:watch`    | modo watch                                                                                |
| `test:coverage` | con los umbrales de cobertura de `vite.config.ts`                                         |
| `api:types`     | regenera `src/api/schema.d.ts` desde `openapi/openapi.json` (la mitad de `pnpm contract`) |

### 7.4 Scripts del repositorio que se ejecutan directamente

| Comando                                                                                                         | Qué hace                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/check-branch-name.mjs [rama]`                                                                     | comprueba el nombre de una rama (por defecto, la actual)                                                                                                         |
| `node scripts/tool-image.mjs <nombre>`                                                                          | imprime la imagen fijada de una herramienta: `actionlint`, `zizmor`, `semgrep`, `gitleaks`, `trivy`, `terraform`, `tflint`, `ubuntu`, `postgres`, `redis`, `zap` |
| `node scripts/smoke-test.mjs ...`                                                                               | el smoke test (`pnpm smoke`)                                                                                                                                     |
| `node apps/web/scripts/api-types.mjs [--check]`                                                                 | regenera, o comprueba, los tipos del cliente web                                                                                                                 |
| `scripts/git/pre-push.mjs`, `scripts/forbid-env-files.mjs`                                                      | los usan los hooks de Git                                                                                                                                        |
| `node scripts/check-migrations.mjs [<migration.sql>...]`                                                        | pasos de contracción sin motivo en las migraciones ([database.md](database.md#expand-and-contract)); lo ejecutan `pnpm test:scripts` y el hook de pre-commit     |
| `scripts/check-dependencies.mjs`, `scan-secrets.mjs`, `sast.mjs`, `lint-workflows.mjs`, `check-bundle-size.mjs` | están detrás de los scripts de la raíz con el mismo propósito                                                                                                    |
| `scripts/check-iac.mjs`, `scripts/iac-database.mjs`                                                             | están detrás de `pnpm iac:check` y `pnpm iac:database`                                                                                                           |

### 7.5 Docker Compose

| Comando                                                                             | Qué arranca                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:up`                                                                        | `db`: PostgreSQL 18, `127.0.0.1:${DB_PORT:-5452}`                                                                                                                                       |
| `pnpm services:up`                                                                  | `db`, y `mailpit`: el capturador de correo, SMTP en `127.0.0.1:${MAILPIT_SMTP_PORT:-1045}`, web en http://localhost:8045 (`MAILPIT_UI_PORT`), mensajes en memoria                       |
| `docker compose --profile redis up -d`                                              | `redis`: Redis 8 con contraseña, `127.0.0.1:${REDIS_PORT:-6389}`, datos en el volumen `redis_data`                                                                                      |
| `docker compose --profile observability up -d`                                      | `otel-lgtm`: collector, Prometheus, Tempo, Loki y Grafana con los dashboards y las reglas de `observability/`; OTLP en el 4328, Grafana en http://localhost:3201, Prometheus en el 9190 |
| `docker compose --profile stack up --build`                                         | `migrate` (se ejecuta una vez), `api`, `web`: las imágenes de producción en http://localhost:8180                                                                                       |
| `docker compose --profile stack --profile redis --profile observability up --build` | el stack con todos los servicios opcionales (define las variables `STACK_*`, [6.4](#64-variables-de-compose-env-de-la-raíz))                                                            |
| `docker compose ps`                                                                 | qué está corriendo, con su estado de salud                                                                                                                                              |
| `docker compose logs -f <servicio>`                                                 | sigue el log de un servicio (`api`, `web`, `db`, `mailpit`, `redis`, `migrate`)                                                                                                         |
| `docker compose --profile <perfil> down`                                            | para y retira esos contenedores; los volúmenes se quedan                                                                                                                                |
| `docker compose down -v`                                                            | **borra también los volúmenes**: se pierden los datos de la base de datos de desarrollo y de Redis                                                                                      |
| `docker compose exec db psql -U app -d app`                                         | consola SQL                                                                                                                                                                             |
| `docker compose exec redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli'`       | consola de Redis (la contraseña no aparece en la línea de comandos)                                                                                                                     |

### 7.6 Imágenes sin Compose

```
docker build -f apps/api/Dockerfile -t api --build-arg APP_RELEASE=$(git rev-parse HEAD) .
docker build -f apps/api/Dockerfile --target migrate -t api-migrate .
docker build -f apps/web/Dockerfile -t web --build-arg APP_RELEASE=$(git rev-parse HEAD) .
```

El contexto de build es la raíz del repositorio (una lista de permitidos en `.dockerignore`). La
imagen de migraciones ejecuta `prisma migrate deploy` por defecto, después de rechazar una base de
datos cuyas migraciones aplicadas se editaron después (`apps/api/scripts/migrate-deploy.mjs`); la
misma imagen responde a los demás comandos de migración ([7.7](#77-comandos-de-operación)).

### 7.7 Comandos de operación

| Comando                                                                                                                                                   | Uso                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `curl http://<api>:3000/api/health/ready`                                                                                                                 | readiness de una instancia, desde dentro de la plataforma                                                                                                                                                                                                                                      |
| `docker compose ... run --rm -T api node dist/infrastructure/mail/mail.cli.js status` (`test --to <dirección>`, `retry --failed`)                         | la bandeja de salida del correo: qué espera, qué falló y por qué; una prueba de entrega; reenviar los fallidos ([11.5](#115-correo))                                                                                                                                                           |
| `docker compose ... run --rm -T api node dist/integrity/audit.cli.js status` (`verify`, `checkpoint`, `retention`, `export …`)                            | la integridad de Audit Hub: el estado de los sellos, una verificación, un checkpoint para guardar fuera, el barrido de retención, una exportación (el script `audit` de [7.2](#72-scripts-de-la-api-pnpm---filter-api-script); runbooks 20–23 de [incident-response.md](incident-response.md)) |
| `pnpm smoke --url <URL pública> --api <URL de la API> --release <sha>`                                                                                    | después de un despliegue, un restore o un incidente                                                                                                                                                                                                                                            |
| `docker run --rm -e DATABASE_URL=<url> <imagen api-migrate>`                                                                                              | rechaza una base de datos cuyas migraciones aplicadas se editaron y después aplica las pendientes                                                                                                                                                                                              |
| `docker run --rm -e DATABASE_URL=<url> <imagen api-migrate> node node_modules/prisma/build/index.js migrate status`                                       | qué migraciones tiene un entorno                                                                                                                                                                                                                                                               |
| `... migrate resolve --rolled-back <migración>` / `--applied <migración>`                                                                                 | registra el resultado de una migración fallida ([database.md](database.md#when-a-migration-fails))                                                                                                                                                                                             |
| `... migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`                                                                  | compara el esquema de un entorno con el de la imagen, después de un restore ([disaster-recovery.md](disaster-recovery.md#restore-procedure))                                                                                                                                                   |
| `pg_dump`, `pg_restore`, `createdb`                                                                                                                       | backups y restores ([disaster-recovery.md](disaster-recovery.md#rehearsal-on-a-development-machine))                                                                                                                                                                                           |
| `BEGIN; SELECT id FROM users WHERE id = '<id>' FOR UPDATE; UPDATE sessions SET revoked_at = now() WHERE user_id = '<id>' AND revoked_at IS NULL; COMMIT;` | termina todas las sesiones de un usuario (incidente de seguridad); el bloqueo del usuario impide que un refresh en curso la sobreviva                                                                                                                                                          |

## 8. CI/CD

### 8.1 Workflows

| Workflow                    | Se ejecuta                                                                                                                      | Hace                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml` (**CI**)           | en cada pull request, en cada push a `main`, a mano                                                                             | dependency review (opcional), todos los gates, las imágenes; un check: **CI passed**                                                                                                                                                                                                                                                                       |
| `conventions.yml`           | en cada pull request, y otra vez al editar su título                                                                            | nombre de la rama y título (Conventional Commits); su check **Conventions** es obligatorio                                                                                                                                                                                                                                                                 |
| `quality-gates.yml`         | lo llaman CI y Deploy                                                                                                           | formato, lint, tipos, workflows, Semgrep, infraestructura como código, tests con cobertura, integración, seguridad, build, E2E, imágenes                                                                                                                                                                                                                   |
| `docker-images.yml`         | lo llaman los gates (build y escaneo) y un despliegue (push)                                                                    | construye `api`, `api-migrate`, `web` y las escanea con Trivy; las publica con SBOM y provenance cuando se le pide                                                                                                                                                                                                                                         |
| `codeql.yml`                | pull requests, `main`, semanal, si `ENABLE_CODEQL=true`                                                                         | análisis de seguridad entre ficheros (ADVISORY)                                                                                                                                                                                                                                                                                                            |
| `dast.yml`                  | los lunes a las 04:41 UTC, a mano                                                                                               | imágenes de producción en el runner, smoke test, ZAP baseline y API scan; o el escaneo pasivo de staging (ADVISORY)                                                                                                                                                                                                                                        |
| `examples.yml`              | pull requests y pushes a `main` que tocan el conector, el contrato, la ingesta o `examples/`; los lunes a las 05:23 UTC; a mano | genera los ejemplos conectados desde las plantillas fijadas; del ejemplo web, su `pnpm verify`, su suite de integración, `pnpm connector status --check` y la suite cruzada con Audit Hub (`pnpm test:e2e:examples`); del ejemplo de la app, su `pnpm verify` y sus flujos de Maestro en un emulador Android ([11.9](#119-audit-hub-conectar-un-proyecto)) |
| `release.yml`               | pushes a `main`                                                                                                                 | el pull request de release y el CI en él; una vez mergeado, el tag, la GitHub release y el SBOM                                                                                                                                                                                                                                                            |
| `main-guard.yml`            | en cada push a `main`                                                                                                           | comprueba que cada commit subido es un pull request mergeado; si no, falla y abre un issue                                                                                                                                                                                                                                                                 |
| `dependabot-auto-merge.yml` | al aprobar un pull request de Dependabot                                                                                        | mergea una actualización patch o minor cuando **CI passed** pasa (comprueba él mismo la aprobación y el CI)                                                                                                                                                                                                                                                |
| `deploy.yml` (**Deploy**)   | a mano, desde `main`                                                                                                            | resuelve la ref a un commit de `main`, repite los gates y publica la release (el destino VPS, o un job propio)                                                                                                                                                                                                                                             |

Dependabot abre cada semana pull requests de actualización agrupados (npm, GitHub Actions, imágenes
base, imágenes de herramientas, proveedores de Terraform), con el mismo retraso de siete días que la
política de instalación.
Tú apruebas cada uno; una actualización patch o minor se mergea sola cuando pasa el CI, y las
majors o las de workflows las mergeas a mano ([ci-cd.md](ci-cd.md#dependency-updates)).

### 8.2 Ejecutarlos y leerlos

```
gh run list                              # ejecuciones recientes
gh run watch                             # sigue la ejecución en curso
gh run view <id de la ejecución> --log-failed   # los logs de los pasos que fallaron
gh run rerun <id de la ejecución> --failed      # repite solo los jobs fallidos
gh workflow run ci.yml --ref <rama>      # CI a mano
gh workflow run dast.yml -f target=local-stack
gh workflow run dast.yml -f target=staging
```

Los informes quedan adjuntos a la ejecución como artefactos (cobertura, informe de Playwright,
informes de ZAP). Qué es BLOCKING y qué es ADVISORY, y por qué:
[ci-cd.md](ci-cd.md#quality-gates-blocking-and-advisory). Cada mensaje de fallo con su arreglo:
[troubleshooting.md](troubleshooting.md).

Las mismas comprobaciones en local: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`,
`pnpm sast`, `pnpm lint:workflows`, `pnpm observability:check`, `pnpm iac:check`.

## 9. Releases

1. Mergea pull requests con títulos Conventional Commit. `fix:`/`perf:` generan un patch, `feat:` un
   minor, `!` o `BREAKING CHANGE:` un major (antes de 1.0.0: un minor).
2. **Release** mantiene abierto un pull request de release con la siguiente versión y la entrada de
   `CHANGELOG.md`. Revísalo como cualquier pull request.
3. Mergéalo: el workflow crea el tag `vX.Y.Z` (inmutable), publica la GitHub release con las notas y
   adjunta `sbom.cdx.json`.
4. Despliega el tag ([10](#10-desplegar-y-hacer-rollback)): publicar una release y desplegarla son
   pasos separados.

La versión continúa desde la de `.release-please-manifest.json` (ahora `0.1.0`): antes de 1.0.0,
un `fix` da el siguiente patch (0.1.1) y un `feat` el siguiente minor (0.2.0); el pie
`Release-As: <versión>` en un commit mergeado elige otra. El workflow de release lanza
él mismo el CI y **Conventions** en el pull request de release; con `RELEASE_PLEASE_TOKEN`
configurado, en cambio, se ejecutan en él todos los workflows de pull request
([ci-cd.md](ci-cd.md#release-pull-requests)).

## 10. Desplegar y hacer rollback

### 10.1 Implementa el job de release una vez (REQUIERE CONFIGURACIÓN)

**Destino listo para usar:** un servidor Linux por entorno con Docker y un PostgreSQL gestionado.
Define la variable del repositorio `DEPLOY_TARGET=vps` y sigue [deploy-vps.md](deploy-vps.md) (paso a
paso: [step-by-step.es.md](step-by-step.es.md#fase-7-servidores-de-producción)); no hay que escribir nada
de lo que sigue. En DigitalOcean, Terraform (`infra/terraform/digitalocean`) puede crear los
servidores y las bases de datos en lugar de los pasos manuales, con el mismo resultado
([deploy-vps.md](deploy-vps.md#provision-with-terraform-digitalocean)). Para cualquier otra
plataforma:

`.github/workflows/deploy.yml` repite todos los gates sobre el commit exacto y después pasa al
entorno protegido, donde el job de release falla a propósito hasta que se escribe para tu
plataforma. Impleméntalo en este orden (los comentarios del fichero lo repiten):

1. Publica las imágenes una vez por commit (`docker-images.yml` con `push: true`, después del paso de
   login al registro marcado en ese fichero), escanea los digests que informa la publicación y
   guárdalos; reutiliza los digests que guardó staging, para que producción ejecute lo que staging
   verificó, y vuelve a escanearlos antes de producción.
2. Despliega solo `<imagen>@<digest>`, con los digests del build o de ese registro: nunca los
   busques por el tag `<imagen>:<sha>`, que cualquier workflow con `packages: write` puede publicar.
3. Guarda los digests que estaban corriendo antes del cambio: son el destino del rollback.
4. Ejecuta la imagen `api-migrate` contra la base de datos del entorno; para si falla.
5. Despliega `api` y después `web`, esperando a que estén ready.
6. `node scripts/smoke-test.mjs --url <URL pública> --api <URL de la API> --release <sha>`.
7. Si algo falla, vuelve a desplegar los digests guardados.

La secuencia completa, las reglas de compatibilidad entre versiones y la tabla de rollback:
[ci-cd.md](ci-cd.md#deployment).

### 10.2 Despliega

```
gh workflow run deploy.yml --ref main -f environment=staging -f ref=v1.4.0
gh run watch
```

O en GitHub → Actions → **Deploy** → Run workflow (desde `main`), con el entorno y la ref (un tag
de release, una rama o un SHA de commit de `main`). Primero staging; verifica; después la misma ref
a `production` (el entorno pide la aprobación de sus revisores).

### 10.3 Smoke test

```
pnpm smoke --url https://<host público> --api http://<api dentro de la plataforma>:3000 --release <sha>
```

| Comprobación               | Pasa cuando                                                                      |
| -------------------------- | -------------------------------------------------------------------------------- |
| web server health          | `/healthz` responde 200                                                          |
| app shell                  | `/` es la app, con las cabeceras CSP y `X-Content-Type-Options`                  |
| runtime configuration      | `/app-config.json` responde, con la release esperada si se pasa `--release`      |
| API through the web server | una ruta `/api/...` desconocida responde el 404 JSON de la API con un request id |
| probes not public          | `/api/health/ready` responde 404 por la URL pública                              |
| API liveness y readiness   | 200 en la propia API (`degraded` se informa, no es un fallo)                     |

No inicia sesión ni escribe nada; cualquier fallo sale con código 1. Se puede omitir cualquiera de
las dos URLs para comprobar solo un lado.

### 10.4 Rollback

- **Falló la aplicación** (errores, latencia, smoke test): vuelve a desplegar los digests guardados
  antes del despliegue. Nunca reconstruyas un commit antiguo para hacer rollback, y nunca reviertas
  una migración.
- **Falló la migración:** la versión en marcha sigue sirviendo; repara la base de datos y resuelve
  la migración ([incident-response.md](incident-response.md#10-failed-database-migration)).
- **Rollback planificado:** ejecuta Deploy con el tag anterior (repite los gates sobre ese commit).

[ci-cd.md](ci-cd.md#rollback) tiene la tabla completa.

## 11. Infraestructura opcional

Apagada por defecto; encender cada pieza es configuración. Nada de esto hace falta para
desarrollar, probar o desplegar. El correo es la excepción en local: viene encendido, contra Mailpit
([11.5](#115-correo)).

### 11.1 Redis

Rate limits compartidos entre instancias, una caché compartida, locks y claims de idempotencia.

1. `.env` de la raíz: `REDIS_PASSWORD=<salida de openssl rand -hex 24>`.
2. `docker compose --profile redis up -d`
3. `apps/api/.env`: `REDIS_URL=redis://:<esa contraseña>@127.0.0.1:6389`, y las funciones que
   quieras mover: `RATE_LIMIT_STORE=redis`, `CACHE_STORE=redis`.
4. `pnpm dev`: el log dice `Redis connected (redis://127.0.0.1:6389)`; readiness muestra
   `"redis": "ok"`. Para el contenedor (`docker compose stop redis`) para ver el modo degradado y
   arráncalo (`docker compose --profile redis start redis`) para ver la recuperación.
5. Producción (REQUIERE CONFIGURACIÓN): un Redis privado con TLS y un usuario ACL, `rediss://` desde
   el gestor de secretos, `REDIS_KEY_PREFIX` por entorno; `REDIS_REQUIRED=true` solo si tu instancia
   no puede funcionar sin él ([security.md](security.md#redis), [architecture.md](architecture.md#redis)).

### 11.2 Error tracking (Sentry)

1. Crea dos proyectos de Sentry: Node.js (API) y JavaScript de navegador (web).
2. API: `SENTRY_DSN` (gestor de secretos; en local en `apps/api/.env`). Web: `WEB_SENTRY_DSN` en el
   contenedor web (en local, en el entorno de `pnpm dev`). `APP_ENVIRONMENT` en ambos.
3. Comprueba: la línea de arranque dice `error tracking on`; `/app-config.json` muestra el DSN; la
   CSP permite el host de ingesta de Sentry.
4. Reglas de alerta en Sentry ([alerting.md](alerting.md)). Lo que nunca se envía:
   [security.md](security.md#error-tracking-data).

### 11.3 Trazas y métricas (OpenTelemetry)

1. En local: `docker compose --profile observability up -d`, después
   `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4328` en `apps/api/.env` y reinicia `pnpm dev`.
2. Haz unas cuantas peticiones; Grafana en http://localhost:3201: Dashboards → Application
   ("API service", "API SLOs"), Alerting → Alert rules, Explore → Tempo (trazas), Prometheus
   (métricas).
3. Desplegado (REQUIERE CONFIGURACIÓN): el endpoint del collector o del proveedor, sus credenciales
   en `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_TRACES_SAMPLER=parentbased_traceidratio` y
   `OTEL_TRACES_SAMPLER_ARG=0.1`. Interruptor de emergencia: `OTEL_SDK_DISABLED=true`.
4. Dashboards y reglas de alerta: los ficheros de `observability/`, importados en tu Grafana y
   cargados en tu Prometheus o Grafana Cloud
   ([observability.md](observability.md#use-them-with-your-backend)); el enrutado según
   [alerting.md](alerting.md).

### 11.4 El stack tipo producción con todo

`.env` de la raíz:

```
JWT_ACCESS_SECRET=<openssl rand -hex 32>
AUDIT_SECRETS_KEY=<openssl rand -hex 32>
AUDIT_INTEGRITY_KEY=<openssl rand -hex 32>
REDIS_PASSWORD=<openssl rand -hex 24>
STACK_REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379
STACK_RATE_LIMIT_STORE=redis
STACK_CACHE_STORE=redis
STACK_OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-lgtm:4318
```

```
docker compose --profile stack --profile redis --profile observability up --build
```

Web en http://localhost:8180, Grafana en http://localhost:3201. Para con
`docker compose --profile stack --profile redis --profile observability down`.

### 11.5 Correo

La API envía correo a través de una bandeja de salida: una funcionalidad escribe el mensaje en la
misma transacción que el cambio que comunica, y un worker dentro de cada instancia de la API lo
entrega por SMTP, con reintentos ([architecture.md](architecture.md#email)). Sin `MAIL_SMTP_URL` el
correo está apagado: no se encola nada, readiness dice `checks.mail: "disabled"` y el resto de la
API funciona.

**En local**, `pnpm dev` arranca Mailpit, un capturador de correo: la API le envía
(`MAIL_SMTP_URL=smtp://localhost:1045`, en `apps/api/.env.example`), nada sale de la máquina, y cada
mensaje está en http://localhost:8045. El recuadro que imprime `pnpm dev` lo muestra en su fila
`Mail`, con lo que dice readiness (`ok`, `degraded`). Comprueba el camino completo:

```
pnpm --filter api mail test --to tu@example.test   # se encola y lo envía la API en marcha
```

y el mensaje aparece en Mailpit. Los mensajes viven en la memoria de Mailpit: `pnpm db:down` los
borra.

**En producción** sirve el servidor SMTP de cualquier proveedor (Amazon SES, Postmark, Resend,
Brevo...). En el entorno de la API ([deploy-vps.md](deploy-vps.md#6-the-files-on-the-server) en un
servidor):

```
MAIL_SMTP_URL=smtps://<usuario>:<contraseña, codificada con %>@<host del proveedor>:465
MAIL_FROM="Audit Hub <no-reply@<tu dominio>>"
APP_ORIGIN=https://<tu dominio>
```

o `smtp://...:587`: producción exige STARTTLS en ese caso y rechaza un servidor sin TLS (Mailpit
entre ellos), salvo uno en la propia máquina (`localhost`, `127.0.0.1`, `[::1]`). `APP_ORIGIN` es
adonde apuntan los enlaces de los mensajes: nunca el Host de una petición. Antes del primer mensaje, autentica el dominio remitente en el proveedor (SPF, DKIM,
DMARC): sin ellos los mensajes acaban en spam o se rechazan. Después, con la imagen de la API:

```
docker compose ... run --rm -T api node dist/infrastructure/mail/mail.cli.js test --to <tú>
```

**Operarlo:** `mail status` muestra qué espera, qué falló y por qué (nunca una dirección: los
mensajes se nombran por id; `--to <dirección>` encuentra los mensajes de una dirección);
`mail retry --failed` reenvía los fallidos una vez corregida la causa, cada uno con una validez
nueva (una caída más larga que ella no los descarta; los enlaces empiezan su propia validez al
enviarse). Alertas `ApiMailBacklog` y
`ApiMailDeliveryFailed`, y el runbook: [incident-response.md](incident-response.md#16-email-not-delivered).
Para rotar las credenciales SMTP, crea las nuevas en el proveedor, actualiza `MAIL_SMTP_URL`,
redespliega y después revoca las antiguas; los mensajes que esperaban salen en su siguiente intento.

**Recuperar y cambiar la contraseña.** Con el correo encendido, la página de inicio de sesión
ofrece "Forgot your password?": la persona escribe su dirección, recibe un enlace válido 30
minutos y una sola vez, y elige una contraseña nueva (15 caracteres o más; las reglas:
[security.md](security.md#passwords)). Con la sesión iniciada, la página Account (menú superior) la
cambia pidiendo la actual. En ambos casos se cierran al instante las demás sesiones de la cuenta y
el titular recibe un aviso de que su contraseña cambió. Pruébalo en local: `pnpm dev`, cierra
sesión, "Forgot your password?" con `member@example.com`, y abre el enlace desde Mailpit
(http://localhost:8045). Sin correo el enlace no aparece y las rutas de recuperación responden 503;
cambiarla con la sesión iniciada sigue funcionando.

**Sin registro público.** El "Create an account" de la plantilla nunca se abre en Audit Hub: sus
cuentas vienen de la invitación de un administrador (abajo) o de `user:create`, y
`SIGN_UP_ENABLED=true` detiene el arranque. La página de inicio de sesión no ofrece el enlace,
`/sign-up` explica cómo se crean las cuentas y `POST /api/auth/sign-ups` responde 403. Por qué:
[security.md](security.md#sign-up).

**Cambio de correo.** Con el correo encendido, la página Account ofrece también "Change your
email": una dirección nueva y la contraseña actual. Llega un enlace a la dirección nueva y nada
cambia hasta abrirlo; entonces se cierran todas las sesiones (inicia sesión con la dirección nueva)
y la dirección anterior recibe un aviso con un enlace que deshace el cambio durante 7 días, pidiendo
una contraseña nueva. Pruébalo en local con dos direcciones cualesquiera y Mailpit. El diseño:
[security.md](security.md#change-of-email).

**Invitaciones.** Con el correo encendido, los administradores ven "Invitations" en el menú
superior: una dirección, un rol (admin, auditor o viewer) y, para un auditor o un lector, las
aplicaciones que verá (al menos una: sin ninguna no podría iniciar sesión) envían un enlace válido
7 días; la persona lo abre, elige su nombre y contraseña, configura su segundo factor y queda con
la sesión iniciada con ese rol y esas aplicaciones. No se invita a miembros: un miembro no puede
iniciar sesión. Las invitaciones pendientes se pueden reenviar o revocar; una que ya no da acceso
(todas sus aplicaciones se retiraron, o invita a un miembro de antes) no se puede aceptar:
revócala e invita de nuevo. Pruébalo en local: inicia sesión como `admin@example.com`, invita
cualquier dirección y abre el enlace desde Mailpit. El diseño:
[security.md](security.md#invitations).

### 11.6 Audit Hub: avisos de alertas y geolocalización por IP

Las reglas de detección funcionan en todos los entornos ([security.md](security.md#detection-rules)):
las alertas aparecen en las páginas de administración y van al webhook de la aplicación. Tres
integraciones se suman, todas apagadas hasta configurarlas:

- **Correo:** con el correo encendido (11.5), cada alerta nueva de severidad high o critical se
  envía a los administradores y a los auditores asignados a su aplicación (solo ids y la regla);
  la que nadie reconoce se vuelve a enviar como dice el escalamiento de su severidad (en Detection
  rules: por defecto, critical a los 15 minutos, high a la hora).
- **Slack o Teams:** `AUDIT_SLACK_WEBHOOK_URL` (un webhook entrante de un canal de Slack) o
  `AUDIT_TEAMS_WEBHOOK_URL` (un flujo de Teams que empieza con "cuando se recibe una solicitud de
  webhook de Teams" y publica la Adaptive Card que recibe): alertas nuevas desde severidad medium,
  con un enlace a la alerta cuando `APP_ORIGIN` está definido, y sus escalamientos. Las dos son
  secretos; solo https.
- **Geolocalización por IP:** `GEOIP_CITY_DB_PATH` y `GEOIP_ASN_DB_PATH` apuntan a ficheros
  `.mmdb` (DB-IP Lite City y ASN, mensuales, CC BY 4.0; [deploy-vps.md](deploy-vps.md#ip-geolocation)
  explica cómo descargarlos), y `GEOIP_HOSTING_ASNS_PATH` a una lista opcional de ASN de hosting
  y VPN. Sin ellos no corren las reglas de país, viaje y hosting. Para ver qué está cargado, y qué
  dice de una dirección: `pnpm --filter api audit geoip --ip 8.8.8.8`.

Un silencio (desde la página de una alerta, [11.8](#118-audit-hub-las-páginas-de-administración))
detiene por un tiempo el correo, el chat y el escalamiento; la alerta se sigue creando, contando y
mostrando. Nada de esto necesita variables nuevas, tampoco las alertas en vivo del panel.

Los webhooks de una aplicación se prueban desde su página en la administración, o con
`POST /api/connected-apps/:id/webhook-test`; cada entrega, con su último estado HTTP y el motivo
del fallo, está en `GET /api/connected-apps/:id/webhook-deliveries`. En local, los webhooks a
`localhost` necesitan `AUDIT_WEBHOOKS_ALLOW_PRIVATE_NETWORKS=true` (si no, se rechaza toda
dirección que no esté en internet público).

### 11.7 Audit Hub: verificación en dos pasos, acceso y exportaciones

Toda cuenta inicia sesión con su contraseña y un código de una app de autenticación (Google
Authenticator, Microsoft Authenticator, 1Password, Bitwarden...). El primer inicio de sesión, y el
final de un registro o de una invitación, la configuran: escanea el código QR (o escribe la clave
que aparece en "Can't scan it?"), introduce el código y guarda los 10 códigos de recuperación, que
se muestran una sola vez y sirven cada uno para un inicio de sesión sin el teléfono
([security.md](security.md#second-factor-and-recent-authentication)).

- **Teléfono perdido:** inicia sesión con un código de recuperación ("Use a recovery code
  instead") y genera otros nuevos. Sin códigos tampoco, un administrador restablece el factor
  desde la administración, o un operador en el servidor:
  `pnpm --filter api user:reset-mfa --email <email> --reason "<motivo>"` (en producción
  `docker compose ... run --rm -T api node dist/users/reset-mfa.cli.js ...`, como
  [deploy-vps.md](deploy-vps.md#9-create-the-first-administrator) ejecuta `user:create`).
- **Acciones sensibles** (exportaciones, claves de aplicaciones, acciones de respuesta, retenciones
  legales, retención, roles y asignaciones, desactivar y quitar cuentas, borrado, el fin del
  servicio de una aplicación, restablecer MFA) piden de nuevo la contraseña
  y un código cuando la última reautenticación tiene más de 5 minutos.
- **Quién puede iniciar sesión:** los administradores, y los auditores y lectores que ven al
  menos una aplicación todavía en servicio. A cualquier otra cuenta (un miembro, un auditor o un
  lector sin aplicación) se le dice "Your account does not have administrative access to this
  panel" en cuanto la contraseña es correcta, antes de pedir el código; una sesión ya abierta
  termina en su siguiente renovación (en menos de 15 minutos) cuando el rol pasa a member o se le
  quita o se retira su última aplicación ([security.md](security.md#who-may-sign-in)).
- **Quién ve qué:** los administradores ven todas las aplicaciones; auditores y lectores, las que
  un administrador les asigna (`PUT /api/users/:id/apps`, o con su invitación); los miembros,
  ninguna, y no pueden iniciar sesión. Los roles cambian con `PATCH /api/users/:id/role`; el
  último administrador que puede iniciar sesión no puede perder su rol. Una cuenta se desactiva,
  se reactiva o se quita desde su página
  ([11.10](#1110-audit-hub-solicitudes-de-privacidad-sus-cuentas-y-el-fin-de-una-aplicación)).
- **Exportaciones** (administradores y auditores): CSV o JSON Lines con los filtros del
  explorador, como máximo 100 000 filas, sin datos personales. Cada una guarda el SHA-256 de su
  cuerpo: `GET /api/exports/<Audit-Export-Id>` lo devuelve, para comprobar una copia más tarde
  (`sha256sum fichero | xxd -r -p | base64`).
- Toda lectura de datos de auditoría (búsquedas, vistas, exportaciones) queda en el registro
  propio de Audit Hub, en la aplicación `audit-hub`.

### 11.8 Audit Hub: las páginas de administración

Lo que ve cada rol al iniciar sesión ([ADR 0014](adr/0014-build-the-admin-pages-lazily-with-own-svg-charts.md)):

| Página                                                                   | Quién                  | Qué hace                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview (`/`)                                                           | viewer, auditor, admin | de un vistazo: la integridad del registro, las alertas abiertas, los eventos de alto riesgo en 24 h; acciones de respuesta rápidas sobre el usuario de una aplicación (admin); después, cada aplicación visible: eventos en 24 h con su tendencia, rechazos, alertas abiertas, heartbeat, huecos                                                                                   |
| Events (`/events`)                                                       | viewer, auditor, admin | el explorador: cada evento de un vistazo (fecha y hora, actor, acción en palabras, aplicación, resultado, riesgo) y todo su detalle en un panel lateral, que se carga al abrirlo; filtros en la URL (el riesgo entre ellos), lo más reciente primero, por páginas; exportar (auditor, admin)                                                                                       |
| Un evento (`/events/:id`)                                                | viewer, auditor, admin | todas sus secciones (actor, red y ubicación, solicitud, cliente, auditoría e integridad con su hash de contenido y su sello, recurso), el cambio y los detalles como JSON resaltado, la misma solicitud                                                                                                                                                                            |
| Un usuario (`/apps/:app/actors/:id`)                                     | viewer, auditor, admin | lo que hizo y lo que le hicieron; borrado de sus datos personales o de sus eventos (admin, reautenticación)                                                                                                                                                                                                                                                                        |
| Un recurso (`/apps/:app/resources/...`)                                  | viewer, auditor, admin | su historial                                                                                                                                                                                                                                                                                                                                                                       |
| Security (`/security`)                                                   | viewer, auditor, admin | inicios de sesión fallidos por día, direcciones, países, mapa de calor día × hora, anomalías abiertas                                                                                                                                                                                                                                                                              |
| Alerts (`/alerts`)                                                       | viewer, auditor, admin | el centro de alertas: búsqueda (un id, una regla, palabras del título, el id de un usuario), filtros (aplicación, estado, severidad, regla, vista por última vez desde y hasta, silenciadas), orden, todo en la URL, por páginas; a quién se refiere cada una por su nombre, si se escaló o está silenciada; todo su detalle en un panel lateral; al día según cambian las alertas |
| Una alerta (`/alerts/:id`)                                               | viewer, auditor, admin | por qué saltó en palabras, lo que muestran sus eventos (cómo terminaron y por qué, cuentas, países, dispositivos), a quién se refiere y quién la trabaja por su nombre, los eventos que la causaron, su historial; reconocerla, revisarla (con un motivo para cerrarla), reabrirla y silenciarla (auditor, admin), pedir a la aplicación que actúe (admin); al día según cambia    |
| SOC view (`/soc`)                                                        | viewer, auditor, admin | una sola pantalla para vigilar, a pantalla completa si se pide: alertas sin resolver por severidad, las critical y high que esperan, lo que acaba de cambiar, el estado de las fuentes, la integridad del registro; por aplicación o entorno                                                                                                                                       |
| Detection rules (`/detection-rules`)                                     | viewer, auditor, admin | lo que busca cada regla, su severidad, agrupación y umbrales, y el escalamiento por severidad; ajustarlas (admin, reautenticación)                                                                                                                                                                                                                                                 |
| Response actions, Applications, Retention, Integrity, Users, Invitations | admin                  | aprobaciones, claves y webhooks, el fin de un servicio, retención y retenciones legales, sellos, cuentas                                                                                                                                                                                                                                                                           |
| Exports (`/exports`)                                                     | auditor, admin         | las exportaciones hechas, con el resumen (digest) para comprobar una copia                                                                                                                                                                                                                                                                                                         |
| Account (`/account`)                                                     | todos                  | contraseña, correo, segundo factor y códigos de recuperación nuevos                                                                                                                                                                                                                                                                                                                |
| Notifications (`/account/notifications`)                                 | viewer, auditor, admin | tus sonidos de alertas, notificaciones del navegador, tiempo de silencio y las aplicaciones de las que nunca quieres saber                                                                                                                                                                                                                                                         |

Una acción sensible (una exportación, una clave, un rol, un borrado, una retención legal, una
acción de respuesta) vuelve a pedir tu contraseña y un código nuevo si la última vez fue hace más
de 5 minutos. Los valores de los eventos de las aplicaciones se muestran siempre como texto.

**Las cifras de Overview.** La integridad del registro es la última verificación que cubrió tus
aplicaciones: verificada, fallida (un administrador abre Integrity), sin terminar o todavía sin
verificar. Los eventos de alto riesgo son los de las últimas 24 horas con una puntuación de riesgo
de 60 o más (el peso de una severidad alta: [security.md](security.md#risk-score)); "See them" los
abre en el explorador. Los administradores tienen además **Respond quickly**: una aplicación, el id
de un usuario en ella y un motivo, y después "Revoke sessions", "Force a password change" o
"Disable the account". Pide la reautenticación y, donde la aplicación lo exige (por defecto), un
segundo administrador la aprueba en Response actions.

**El detalle de un evento.** "View details" en una fila abre su detalle junto a la tabla: quién
(nombre, el seudónimo del correo: Audit Hub nunca guarda direcciones, id, rol, tipo), desde dónde
(dirección IP, lugar, coordenadas, agente de usuario, dispositivo, sistema operativo), la solicitud
(ruta, método, estado, duración, ids de solicitud y de traza), el cliente, sus datos de auditoría e
integridad (riesgo sobre 100, severidad, categoría, el hash de contenido, el hash, la firma y la
clave de su sello), y el cambio y los detalles como JSON resaltado. Escape o Close vuelven a la
fila; "Open as a page" le da su propia dirección, con los demás eventos de la misma solicitud.

Lo que puede decir depende de lo que envía la aplicación ([guía de conexión](audit/connection-guide.es.md)):

- **Nombre y teléfono:** el nombre completo de la persona cuando la aplicación lo da (si no, su
  correo, enmascarado); su teléfono, si su cuenta tiene uno, solo con sus últimos cuatro dígitos
  (`•••• 1234`). Audit Hub nunca guarda una dirección de correo ni un número de teléfono.
- **Navegador y sistema:** se leen del agente de usuario y, en los navegadores Chromium (Chrome,
  Edge, Brave, Opera), de sus client hints: la marca y versión reales, Windows 11 distinto de 10, el
  modelo de un teléfono. Firefox y Safari no envían hints: su agente de usuario dice menos
  ("Windows 10 or 11", "macOS 10.15.7 or later": lo que los navegadores congelan).
- **Lugar:** desde la dirección IP, la ciudad y unas coordenadas aproximadas, una vez configurada
  la geolocalización por IP ([11.6](#116-audit-hub-avisos-de-alertas-y-geolocalización-por-ip));
  nunca exactas. Desde un teléfono, con el consentimiento de la persona, la posición al empezar una
  sesión (al iniciarla, o al abrir la app con la sesión iniciada): precisa (cinco decimales, la precisión en metros) si la permitió en el diálogo del
  teléfono, aproximada (cerca de 1 km) si no. Se conserva 30 días.

**El detalle de una alerta.** "View details" en una alerta la abre junto a la lista, igual:

- **Por qué saltó**, en palabras: lo que la regla vio esta vez ("12 failed sign-ins of Ann Example
  (user-42) within 15 minutes", "New device: one this account had not used before (Microsoft Edge
  on Linux)", "Impossible travel: 9,050 km from where the account was 2 hours before") y lo que
  busca la regla, con su umbral.
- **Quién y cuándo:** la persona a la que se refiere por su nombre, después su id; ocurrencias,
  primera y última vez; a quién está asignada y quién la resolvió, por su nombre.
- **Lo que muestran los eventos:** lo que tienen en común los eventos que la causaron, contado:
  cómo terminaron y por qué (sus motivos, los errores: "invalid credentials × 9, mfa failed × 3"),
  las acciones, cuántas cuentas, los países y los dispositivos.
- **Los eventos que la causaron** (en su página, como en el explorador, cada uno con su propio
  detalle), su **historial** por nombre, y lo que guardó la regla, como JSON resaltado.

Revisarla y pedir a la aplicación que actúe están en su página ("Open as a page"). Las alertas
guardan solo ids y conteos: los nombres se buscan al leer una alerta, y cada lectura queda en el
registro propio de Audit Hub, como una búsqueda de eventos.

**Alertas en vivo.** Con la sesión iniciada como viewer, auditor o administrador, el panel escucha
a Audit Hub (la cabecera lo dice en palabras: Live, Connecting…, Reconnecting…, Offline): los
contadores, las listas y la página de una alerta cambian según cambian las alertas, sin recargar.
Una alerta nueva, una cuya severidad subió y una escalada otra vez muestran un aviso abajo a la
derecha (uno critical se queda hasta cerrarlo), anunciado también a los lectores de pantalla. Con
el panel abierto en varias pestañas, una sola reproduce el sonido y muestra la notificación del
navegador: cada alerta se oye una vez
([ADR 0016](adr/0016-deliver-alerts-live-tunable-and-escalating.md)).

- **Sonidos:** un patrón distinto por severidad (por defecto suenan critical y high). Los
  navegadores solo reproducen sonido después de un clic o una tecla en la página: hasta entonces la
  cabecera ofrece "Enable sound". En Notifications: las severidades que suenan, el volumen, cada
  sonido para probarlo, y el sonido de una alerta critical otra vez mientras nadie la reconoce
  (cada 60 segundos, 3 veces por defecto).
- **Notificaciones del navegador:** apagadas hasta que las enciendes en Notifications y el
  navegador las permite ("Allow browser notifications"); solo mientras hay una pestaña del panel
  abierta, con la severidad, la aplicación y el título de la alerta. Si el navegador las bloquea:
  permítelas en su configuración del sitio; los avisos propios del panel siguen funcionando.
- **Silencio:** "Quiet for an hour" en la cabecera (u 8 horas, un día, en Notifications) detiene
  sonidos y notificaciones hasta entonces; ahí también se eligen las aplicaciones de las que nunca
  quieres saber. Silenciar nunca reconoce, resuelve ni oculta una alerta.

**Trabajar una alerta.** En su página, **Acknowledge** dice que la tomaste (pasas a ser su
responsable si no tiene) y detiene su escalamiento; pasarla a In review hace lo mismo. Resolverla,
o cerrarla como falso positivo, pide cómo o por qué (10 caracteres o más), que queda en su
historial; **Reopen** reabre una cerrada, y su escalamiento empieza de nuevo. **Silence** detiene
las notificaciones de su regla, o de todas las reglas de su aplicación, de 15 minutos a una
semana, con un motivo: correo, chat, escalamiento, sonidos y notificaciones del navegador. Los
silencios vigentes se listan ahí, cada uno con **Lift**. Una alerta silenciada se sigue creando,
contando y mostrando ("Silenced" en la lista).

**La vista SOC y las fuentes.** Una sola pantalla para vigilar ("Full screen" para una pantalla de
pared): alertas sin resolver por severidad (abiertas, en revisión, silenciadas, la que más espera),
las critical y high que esperan, lo que cambió desde que se abrió la página, y cada fuente: Active;
Idle (heartbeats, sin eventos recientes: no es un problema); Delayed (eventos en cola);
Disconnected (sin heartbeat dentro del plazo de la aplicación); Never connected; con su cola, los
eventos rechazados en 15 minutos y los que faltan. Una fuente desconectada o retrasada, los eventos
rechazados y los que faltan también generan alertas, que se resuelven solas cuando se corrige
([security.md](security.md#the-rules)).

**Reglas de detección.** Cada regla como la ejecuta esta instancia, y el escalamiento de cada
severidad. Un administrador, tras la reautenticación, apaga una regla, cambia su severidad o sus
umbrales dentro de sus límites, y define el escalamiento de cada severidad: tras cuánto tiempo,
cada cuánto, cuántas veces, por correo y chat (la página dice cuáles puede enviar este despliegue).
Los cambios se aplican en 30 segundos y quedan en el registro propio de Audit Hub.

### 11.9 Audit Hub: conectar un proyecto

Un proyecto creado desde project-template-web envía su registro de auditoría con el conector de
NestJS, copiado en él como código fuente
([ADR 0009](adr/0009-distribute-connectors-as-vendored-source.md)). El procedimiento completo,
las variables y dónde se registra cada flujo:
[docs/audit/connection-guide.es.md](audit/connection-guide.es.md). En resumen:

1. En Audit Hub, registra la aplicación (Applications → Register an application; un
   administrador, con reautenticación) y guarda las variables que muestra una sola vez. Una
   aplicación por backend y por entorno: una web y una app móvil sobre la misma API son una sola
   aplicación; producción y staging son dos
   ([Qué aplicaciones registrar](audit/connection-guide.es.md#qué-aplicaciones-registrar) en la
   guía). Audit Hub nunca se conecta a la base de datos del proyecto: el conector, dentro de su
   API, le envía los eventos.
2. Desde un checkout de Audit Hub en un tag de release: `pnpm connector add --target <proyecto>`.
   En el proyecto: `pnpm db:migrate`, las cuatro ediciones de conexión que imprime el comando y los
   flujos que hay que registrar
   ([Puntos de integración](audit/connection-guide.es.md#puntos-de-integración) en la guía).
3. Define las variables `AUDIT_HUB_*` en el entorno del proyecto y vuelve a desplegar. En menos de
   un minuto el Overview muestra el último heartbeat de la aplicación, y el explorador sus eventos.
   Con una app móvil, `AUDIT_HUB_PUSH=expo` envía además "¿Fuiste tú?" a los teléfonos del usuario
   como notificación push
   ([Notificaciones push](audit/connection-guide.es.md#notificaciones-push) en la guía).
4. Más adelante, `pnpm connector status --target <proyecto>` muestra las ediciones locales y la
   versión disponible; `pnpm connector update --target <proyecto>` fusiona una nueva y escribe la
   migración cuando cambia las tablas del conector: después, `pnpm db:migrate`.

Un proyecto creado desde las plantillas después de aplicarles sus parches ya trae el conector,
instalado y apagado: solo define las variables (paso 3). Los parches son `examples/web/template-patch/` y
`examples/app/template-patch/`, series de `git format-patch` que el dueño de las plantillas aplica
(`git am examples/<kind>/template-patch/*.patch`): además del conector, cubren los huecos de la
plantilla que lista el diseño (roles, cuentas desactivadas, una contraseña nueva exigida, la
eliminación de cuentas, tres defectos de pruebas de la plantilla web y el aviso sin conexión de la
app debajo de la barra de estado).

Un proyecto conectado así, para probarlo o cambiarlo: `pnpm examples generate --kind web` construye
`.examples/web` (la plantilla en su commit fijado, sus parches como commits, el conector llevado a
la versión de este checkout y `examples/web/overlay.patch` si el ejemplo agrega algo encima) con
su propia base de datos, `example_web`, y sus propios puertos: 3400 para la API, 5373 para la web.
Después de cambiarlo allí, `pnpm examples save --kind web` vuelve a escribir tanto el overlay (los
cambios desde el commit base) como los parches (los commits anteriores a él): para cambiar un
parche, reescribe su commit en el ejemplo ([ADR 0010](adr/0010-generate-the-example-projects-in-ci.md)).

La app móvil del proyecto, creada desde project-template-app, recibe el conector Expo:
`pnpm connector add --kind expo --target <app>`. Envía los eventos propios del teléfono (una sesión
iniciada, con la ubicación aproximada solo con su propio consentimiento; una sesión caducada; un
enlace rechazado) a la API del proyecto, nunca a Audit Hub; los guarda por usuario mientras no hay
red y nunca envía los eventos de un usuario como los de otro; y muestra la actividad de la cuenta y
"¿Fuiste tú?" ([la app móvil en la guía](audit/connection-guide.es.md#la-app-móvil)). Su ejemplo:
`pnpm examples generate --kind app` construye `.examples/app` contra la API mock de la plantilla, con
flujos de Maestro para sin red, cierre de sesión entre usuarios y "¿Fuiste tú?". La web recibe el
conector SPA, `pnpm connector add --kind spa --target <proyecto>/apps/web`: lo que solo ve la página
(una violación de CSP, una ruta de retorno rechazada, una sesión caducada), desde un chunk lazy que
se carga solo cuando el conector de la API está activo, y la actividad de la cuenta
([la web en la guía](audit/connection-guide.es.md#la-app-web)); `.examples/web` tiene los dos.

### 11.10 Audit Hub: solicitudes de privacidad, sus cuentas y el fin de una aplicación

Lo que hace Audit Hub con cada solicitud que una persona o un cliente hace sobre sus datos; quién
las responde y en cuánto tiempo está en [docs/privacy/](privacy/README.es.md) (el procedimiento
ARCO).

- **Un usuario de una aplicación pide que lo borren** (cancelación): lo pide el conector de la
  aplicación, o un administrador en la página del usuario (Right to erasure, con reautenticación).
  "Their personal data" borra las direcciones, dispositivos, etiquetas y lugares de sus eventos y
  conserva los eventos, seudónimos, hasta su retención; "Their events too", una vez que la
  aplicación canceló sus datos, borra también los eventos: los sellados al momento, el resto en un
  día. Lo que conserva una retención legal nunca se borra.
- **Después de un borrado el usuario queda bloqueado** (art. 24 de la LFPDPPP): su página dice
  desde cuándo, y su página, una búsqueda por su id o su correo, su exportación y la vista de
  actividad de la propia aplicación dejan fuera lo ocurrido hasta su último borrado; lo que hizo
  después (una cuenta que se conserva) se muestra como siempre. Las búsquedas por cualquier otra
  cosa siguen encontrando los eventos bloqueados, seudónimos (el registro de un incidente queda
  completo), y la página de un evento dice que su usuario está bloqueado. Una retención legal que
  lo nombre levanta el bloqueo mientras está activa.
- **Alguien deja el equipo** (o pide que lo quiten de Audit Hub): en su página, en Users,
  "Disable their account…" cierra su sesión en todas partes a la vez y rechaza su siguiente inicio
  de sesión; "Enable their account" lo deja volver. "Remove from Audit Hub…" borra todo lo de la
  persona (correo, nombre, contraseña, segundo factor, sesiones, aplicaciones) y conserva solo el
  id de la cuenta, para que el registro propio de Audit Hub siga diciendo quién hizo qué; las
  alertas abiertas asignadas a ella quedan sin asignar. Nadie desactiva ni quita su propia cuenta
  ni la del último administrador.
- **Termina el servicio de una aplicación** (terminó el contrato con el cliente, se apagó el
  sistema): suspéndela (su página, Settings), luego "End of service" → "Delete its audit log…",
  escribe su slug y confirma. Cada clic borra durante hasta 10 segundos y sigue solo; "waiting"
  son eventos aún sin sellar (en menos de 2 minutos), "held" una retención legal que hay que
  liberar antes. Cuando no queda nada la aplicación queda retirada: su página lo dice y no se
  acepta nada de lo que envíe. En el servidor, para un registro grande:
  `pnpm --filter api audit app:delete --app <slug> --confirm <slug>` (en producción
  `docker compose ... run --rm -T api node dist/integrity/audit.cli.js app:delete ...`), que espera
  los sellos por sí mismo.

Cada una queda en el registro propio de Audit Hub (`hub.subject.erased`, `hub.user.disabled`,
`hub.user.enabled`, `hub.user.removed`, `hub.app.deleted`) y la verificación de integridad sigue
pasando ([security.md](security.md#audit-log-integrity-retention-and-erasure)).

## 12. Operar en producción

| Antes y durante la operación               | Dónde                                                         |
| ------------------------------------------ | ------------------------------------------------------------- |
| La checklist antes de la primera release   | [production-readiness.md](production-readiness.md)            |
| Backups, restores, RPO y RTO               | [disaster-recovery.md](disaster-recovery.md)                  |
| SLOs, error budget, el catálogo de alertas | [alerting.md](alerting.md)                                    |
| Qué significa cada señal                   | [observability.md](observability.md)                          |
| Qué hacer cuando salta una alerta          | [incident-response.md](incident-response.md): 14 runbooks     |
| Capacidad                                  | [load-testing.md](load-testing.md) (OPCIONAL)                 |
| Ajustes de seguridad por instancia         | [security.md](security.md#per-project-requiere-configuración) |
| Los documentos legales                     | [privacy/](privacy/README.es.md)                              |

Lo mínimo antes de recibir tráfico de producción (REQUIERE CONFIGURACIÓN): backups automáticos con
un simulacro de restore hecho, el job de despliegue con digests y smoke test, checks de uptime, las
alertas CRITICAL dirigidas a alguien, `TRUST_PROXY` para la topología real, TLS en el borde y la
tabla de contactos de incident-response.md rellena. Para Audit Hub, además: `AUDIT_SECRETS_KEY` y
`AUDIT_INTEGRITY_KEY` en el gestor de secretos, los resúmenes de los checkpoints guardados fuera de
Audit Hub y el contrato de encargo firmado
([2.8](#28-decisiones-de-tu-instancia-requiere-configuración)).

Ensaya un restore en tu máquina (tarda unos minutos; en Windows, antepón `MSYS_NO_PATHCONV=1`):

```
docker compose exec -T db pg_dump -U app -d app --format=custom --no-owner --no-privileges --file=/tmp/app.dump
docker compose exec -T db createdb -U app app_restore_check
docker compose exec -T db pg_restore -U app -d app_restore_check --no-owner --no-privileges --exit-on-error /tmp/app.dump
DATABASE_URL=postgresql://app:app@localhost:5452/app_restore_check pnpm --filter api exec prisma migrate status
docker compose exec -T db dropdb -U app app_restore_check
docker compose exec -T db rm /tmp/app.dump
```

## 13. Calendario de mantenimiento

| Cuándo                                   | Qué                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cada semana                              | Revisa y aprueba los pull requests de Dependabot: las actualizaciones patch y minor se mergean solas cuando pasa el CI; las majors y las de workflows las mergeas a mano ([ci-cd.md](ci-cd.md#dependency-updates)). En el destino VPS, si uno cambia `deploy/vps` (la imagen de Caddy), copia además los ficheros a cada servidor antes de su siguiente despliegue ([deploy-vps.md](deploy-vps.md#update-the-server-files)). |
| Cada semana (automático)                 | El DAST se ejecuta los lunes: lee los informes de ZAP de las ejecuciones fallidas.                                                                                                                                                                                                                                                                                                                                           |
| Cada release                             | Primero staging, smoke test, después producción con los mismos digests.                                                                                                                                                                                                                                                                                                                                                      |
| Cada mes                                 | Con geolocalización por IP: los ficheros nuevos de DB-IP en cada servidor ([deploy-vps.md](deploy-vps.md#ip-geolocation)).                                                                                                                                                                                                                                                                                                   |
| Según lo decidido en 2.8                 | Copia el resumen del último checkpoint (la página Integrity, o `audit checkpoint`) a su lugar fuera de Audit Hub.                                                                                                                                                                                                                                                                                                            |
| Cada trimestre                           | Un simulacro de restore con la [checklist](disaster-recovery.md#checklist); una revisión de las alertas (ruido, huecos) y una alerta de prueba por todo el enrutado; un repaso de la política de error budget; lo que Dependabot nunca propone: una major LTS de Node.js (cada octubre), pnpm, las majors de PostgreSQL y Redis ([ci-cd.md](ci-cd.md#keeping-the-stack-current)).                                            |
| Cuando sube la cobertura                 | Sube los umbrales en el mismo pull request ([testing.md](testing.md#coverage)).                                                                                                                                                                                                                                                                                                                                              |
| Cuando un secreto puede haberse filtrado | Rótalo de inmediato ([security.md](security.md#secret-rotation)).                                                                                                                                                                                                                                                                                                                                                            |
| Después de cada incidente                | El postmortem, y las actualizaciones del runbook y de las alertas que dejó en evidencia.                                                                                                                                                                                                                                                                                                                                     |

## 14. Cuando algo falla

Busca unas palabras del mensaje en [troubleshooting.md](troubleshooting.md): lista los mensajes
que imprimen las herramientas, con causa y arreglo, agrupados por instalación, base de datos, API,
infraestructura opcional, quality gates, despliegue, hooks de Git y tests end-to-end. Los primeros
que suelen aparecer:

| Mensaje                                                            | Arreglo                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PNPM_UNSUPPORTED_ENGINE`                                      | Node.js 24.15+ ([1.1](#11-instala-las-herramientas))                                                                                                        |
| `port is already allocated` en `pnpm db:up`                        | `DB_PORT=5443` en el `.env` de la raíz y en `DATABASE_URL`                                                                                                  |
| `Environment variable JWT_ACCESS_SECRET is invalid`                | `openssl rand -hex 32` en `apps/api/.env`                                                                                                                   |
| `Cannot reach PostgreSQL at localhost:5452` (tests de integración) | `pnpm db:up`                                                                                                                                                |
| No llega correo a Mailpit (http://localhost:8045)                  | la fila `Mail` del recuadro de `pnpm dev`: `off` (define `MAIL_SMTP_URL`), o un aviso sobre su puerto ([11.5](#115-correo))                                 |
| `Executable doesn't exist ... playwright install`                  | `pnpm exec playwright install chromium`                                                                                                                     |
| `pre-push: Direct pushes to "main" are not allowed`                | haz push de una rama y abre un pull request                                                                                                                 |
| `Could not start Docker` en `pnpm sast` o `pnpm lint:workflows`    | arranca Docker                                                                                                                                              |
| `pnpm sast` tarda muchos minutos                                   | la primera vez descarga la imagen; si no, revisa la CPU y la memoria de Docker y los ficheros grandes sin seguimiento (tarda unos minutos; en CI, unos dos) |

## 15. Apéndice: puertos, cuentas y ficheros

### 15.1 Puertos y URLs

| Puerto | Qué                                    | Lo arranca                                     |
| ------ | -------------------------------------- | ---------------------------------------------- |
| 3200   | API (desarrollo)                       | `pnpm dev`                                     |
| 5273   | web (desarrollo)                       | `pnpm dev`                                     |
| 5452   | PostgreSQL (`DB_PORT`)                 | `pnpm db:up`                                   |
| 1045   | SMTP de Mailpit (`MAILPIT_SMTP_PORT`)  | `pnpm services:up` (y `pnpm dev`)              |
| 8045   | web de Mailpit (`MAILPIT_UI_PORT`)     | `pnpm services:up` (y `pnpm dev`)              |
| 3300   | API (tests end-to-end)                 | `pnpm test:e2e`                                |
| 4273   | web (tests end-to-end, `vite preview`) | `pnpm test:e2e`, `pnpm --filter web preview`   |
| 8180   | stack tipo producción (`WEB_PORT`)     | `docker compose --profile stack up`            |
| 6389   | Redis (`REDIS_PORT`)                   | `docker compose --profile redis up -d`         |
| 4328   | OTLP/HTTP (`OTLP_HTTP_PORT`)           | `docker compose --profile observability up -d` |
| 3201   | Grafana (`GRAFANA_PORT`)               | `docker compose --profile observability up -d` |
| 9190   | Prometheus (`PROMETHEUS_PORT`)         | `docker compose --profile observability up -d` |

Todos los puertos publicados escuchan solo en 127.0.0.1. Son distintos de los de la plantilla web
(3000, 5173, 5442, 1035, 8035...): los dos proyectos funcionan a la vez en la misma máquina.

### 15.2 Cuentas

| Cuenta                                                                 | Dónde                                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `admin@example.com` / `admin-password`                                 | base de datos de desarrollo (`pnpm db:seed`), base de datos end-to-end             |
| `auditor@example.com` / `auditor-password`                             | las mismas; inicia sesión cuando ve una aplicación (`pnpm dev:demo` se las asigna) |
| `viewer@example.com` / `viewer-password`                               | las mismas; inicia sesión cuando ve una aplicación (`pnpm dev:demo` se las asigna) |
| `member@example.com` / `member-password`                               | las mismas; nunca inicia sesión: muestra el rechazo                                |
| Segundo factor de las cuatro: clave `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` | las mismas                                                                         |
| PostgreSQL `app` / `app`                                               | solo el contenedor de desarrollo                                                   |

Son públicas: no las crees nunca en ningún otro sitio.

### 15.3 Dónde está cada cosa

```
apps/api/                 API NestJS
  src/main.ts             punto de entrada (manejadores de crash, telemetría, después el servidor)
  src/env/                la configuración validada
  src/ingest/ integrity/ rules/ alerts/ retention/ ...   las funcionalidades de Audit Hub, una carpeta cada una
  src/auth/ account/ users/ invitations/ health/        cuentas, segundo factor, salud
  src/common/             filtro de errores, request ids, guard CSRF, cliente HTTP externo, pipes
  src/observability/      redacción, error tracking, telemetría, métricas
  src/infrastructure/     Redis, store de rate limit, caché, locks e idempotencia
  src/lifecycle/          apagado ordenado
  prisma/                 schema.prisma y migraciones
  Dockerfile              imágenes api y api-migrate
apps/web/                 app React
  src/api/                el cliente tipado (schema.d.ts es generado)
  src/auth/               sesión, guards, gestión del refresh
  src/monitoring/         configuración en runtime, error tracking
  src/pages/audit/        las páginas de administración
  nginx/                  configuración del servidor web de producción
  Dockerfile              imagen web
packages/                 el contrato de integración y los conectores (NestJS, Expo, SPA)
examples/                 los proyectos de ejemplo conectados: plantillas fijadas y sus parches
openapi/openapi.json      el contrato de la API (generado, en git)
e2e/                      tests de Playwright
scripts/                  utilidades del repositorio (comprobaciones, smoke test, imágenes de herramientas, conector)
docs/                     este manual y las guías
  audit/ privacy/         la guía de conexión, las plantillas de privacidad
infra/terraform/          infraestructura como código: el servidor y la base de datos en DigitalOcean (opcional)
.github/                  workflows, rulesets, Dependabot, plantillas, imágenes de herramientas fijadas
docker-compose.yml        base de datos, servicios opcionales, stack tipo producción
```

### 15.4 Los demás documentos (en inglés)

Salvo la guía de conexión y los documentos de privacidad, que también están en español.

| Documento                                                                                                                                                                                                                                            | Léelo para                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [ENGINEERING_STANDARDS.md](../ENGINEERING_STANDARDS.md)                                                                                                                                                                                              | las reglas, en una página                 |
| [CONTRIBUTING.md](../CONTRIBUTING.md), [DEFINITION_OF_DONE.md](../DEFINITION_OF_DONE.md), [definition-of-ready.md](definition-of-ready.md)                                                                                                           | cómo llega un cambio a `main`             |
| [architecture.md](architecture.md), [api-conventions.md](api-conventions.md), [error-handling.md](error-handling.md), [database.md](database.md)                                                                                                     | cómo está organizado el código            |
| [how-to.md](how-to.md)                                                                                                                                                                                                                               | recetas para los cambios habituales       |
| [testing.md](testing.md)                                                                                                                                                                                                                             | tests, cobertura, presupuesto             |
| [security.md](security.md), [authorization.md](authorization.md), [SECURITY.md](../SECURITY.md)                                                                                                                                                      | controles, límites, ajustes por proyecto  |
| [environment.md](environment.md)                                                                                                                                                                                                                     | todas las variables                       |
| [ci-cd.md](ci-cd.md), [branching.md](branching.md), [commits.md](commits.md), [git-hooks.md](git-hooks.md), [code-review.md](code-review.md)                                                                                                         | entrega                                   |
| [observability.md](observability.md), [alerting.md](alerting.md), [incident-response.md](incident-response.md), [disaster-recovery.md](disaster-recovery.md), [load-testing.md](load-testing.md), [production-readiness.md](production-readiness.md) | operación                                 |
| [audit/connection-guide.es.md](audit/connection-guide.es.md)                                                                                                                                                                                         | conectar una aplicación                   |
| [privacy/](privacy/README.es.md)                                                                                                                                                                                                                     | las plantillas legales                    |
| [design/audit-hub/](design/audit-hub/README.md)                                                                                                                                                                                                      | el diseño de Audit Hub                    |
| [troubleshooting.md](troubleshooting.md)                                                                                                                                                                                                             | mensajes y arreglos                       |
| [adr/](adr/)                                                                                                                                                                                                                                         | por qué se tomaron las grandes decisiones |
