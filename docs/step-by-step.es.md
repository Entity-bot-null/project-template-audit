# Paso a paso: de cero a producción

English version: [step-by-step.md](step-by-step.md). Las dos versiones tienen los mismos pasos; un
cambio en una se hace también en la otra, en el mismo pull request.

Audit Hub es un servicio de registro de auditoría y de seguridad que instalas en tus propios
servidores: las aplicaciones que conectas le envían sus eventos de seguridad, de auditoría, de
acceso y de sistema mediante un conector instalado en cada una, y él los guarda sellados, les
aplica reglas de detección, genera alertas y da a tus administradores, auditores y lectores sus
propias páginas.

Este es el **instructivo**: qué hacer, en orden, para operar una instancia de Audit Hub para tu
empresa, desde la información que tienes que reunir antes de empezar hasta Audit Hub funcionando
en producción con su primera aplicación conectada, y después el ciclo diario. Es para el operador
que ejecuta la instancia y para los desarrolladores que lo cambian. Cada paso dice qué hacer, el
comando exacto, qué deberías ver si funcionó y qué hacer si no funcionó. El [manual](manual.es.md)
explica cómo funciona todo; esta página solo te dice qué hacer a continuación. Conectar cada
aplicación, en detalle: [audit/connection-guide.es.md](audit/connection-guide.es.md). Los
documentos legales: [privacy/](privacy/README.es.md).

Cómo usar esta guía:

- Sigue las fases en orden. No te saltes ninguna comprobación (**Comprueba**): cada una demuestra
  que los pasos anteriores funcionaron, así un problema aparece donde empieza, no tres fases después.
- Los comandos se ejecutan en una terminal, en la carpeta raíz del proyecto. En Windows usa
  **Git Bash** (se instala con Git for Windows).
- Lo que va entre `<ángulos>` es un valor que sustituyes. Apunta tus valores en la
  [hoja de trabajo](#la-hoja-de-trabajo) a medida que avanzas.
- Marca las casillas (`[ ]` → `[x]`) en tu propia copia si te ayuda.

## La línea de tiempo

| Fase                                                                                  | Con qué terminas                                                       | Tiempo                                |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| [0. Información y decisiones](#fase-0-información-y-decisiones)                       | la hoja de trabajo rellena, las cuentas creadas                        | 1–2 h, más la espera de las cuentas   |
| [1. Tu equipo](#fase-1-tu-equipo)                                                     | todas las herramientas instaladas y comprobadas                        | 30–60 min                             |
| [2. Obtén Audit Hub](#fase-2-obtén-audit-hub)                                         | tu propia copia, con tus contactos                                     | 15 min                                |
| [3. Ejecútalo en local](#fase-3-ejecútalo-en-local)                                   | Audit Hub corriendo en tu máquina, con la sesión iniciada              | 20 min                                |
| [4. Comprueba que pasan todos los gates](#fase-4-comprueba-que-pasan-todos-los-gates) | las mismas comprobaciones que CI, en verde en tu máquina               | 30–45 min                             |
| [5. Súbelo a GitHub](#fase-5-súbelo-a-github)                                         | el repositorio protegido, CI en verde en un pull request               | 1 h                                   |
| [6. Prepara tu instancia](#fase-6-prepara-tu-instancia)                               | los documentos legales con un abogado; tus cambios, si los hay         | de días a semanas (la revisión legal) |
| [7. Servidores de producción](#fase-7-servidores-de-producción)                       | servidores de staging y producción, bases de datos y dominios listos   | 2–3 h por entorno                     |
| [8. El primer despliegue](#fase-8-el-primer-despliegue)                               | Audit Hub en marcha en staging, después en producción; tu equipo       | 1 h                                   |
| [9. Conecta la primera aplicación](#fase-9-conecta-la-primera-aplicación)             | una aplicación de prueba enviando eventos, su heartbeat a la vista     | 1–2 h                                 |
| [10. Monitorización y alertas](#fase-10-monitorización-y-alertas)                     | los errores reportados, el uptime vigilado, alguien recibe las alertas | 1–2 h                                 |
| [11. Antes de los usuarios reales](#fase-11-antes-de-los-usuarios-reales)             | la checklist de preparación para producción, firmada                   | medio día                             |
| [12. El ciclo diario](#fase-12-el-ciclo-diario)                                       | cómo llega cada cambio de la idea a producción                         | cada día                              |
| [13. El calendario de mantenimiento](#fase-13-el-calendario-de-mantenimiento)         | qué hacer cada semana, cada mes y cada trimestre                       | recurrente                            |

---

## Fase 0. Información y decisiones

Todavía no hay nada que instalar. Reúne esto primero: la mayoría de los retrasos vienen de una
cuenta o de una decisión que nadie tenía cuando hizo falta.

### 0.1 Decide

- [ ] **Nombre del repositorio** para tu copia de Audit Hub (en minúsculas, con guiones:
      `acme-audit-hub`).
- [ ] **Dominios** para Audit Hub: uno para producción y otro para staging. Esta guía escribe
      `app.acme.com` y `staging.acme.com`; usa los tuyos (`audit.acme.com`, por ejemplo).
      Necesitas acceso a los ajustes de DNS del dominio.
- [ ] **Dónde se ejecuta.** Esta guía usa el destino listo para usar: **un servidor Linux por
      entorno** con Docker y un PostgreSQL gestionado ([deploy-vps.md](deploy-vps.md)). Sirve para
      un primer despliegue (una sola instancia de la API). Para Kubernetes o una plataforma de
      contenedores, las fases 0–6 son iguales y la fase 7 la sustituye tu plataforma
      ([ci-cd.md](ci-cd.md#deployment)).
- [ ] **Quién** aprueba los despliegues a producción (al menos una persona además del autor), quién
      revisa el código (CODEOWNERS), quién recibe los reportes de seguridad y las alertas.
- [ ] **Las aplicaciones que vas a conectar**, y en qué entornos: una aplicación en Audit Hub por
      backend y por entorno (producción y staging son dos), como explica
      [Qué aplicaciones registrar](audit/connection-guide.es.md#qué-aplicaciones-registrar) en la
      guía de conexión. Elige la primera: una aplicación de prueba, o el entorno de staging de una
      real (fase 9).
- [ ] **Quién inicia sesión en Audit Hub:** los administradores (al menos dos: nadie restablece su
      propio segundo factor, y una acción de respuesta necesita por defecto la aprobación de un
      segundo administrador), los auditores y los lectores, y las aplicaciones que ve cada auditor
      o lector. Llegan por invitación (fase 8), los auditores y lectores con sus aplicaciones, y
      cada cuenta configura una app de autenticación (TOTP) en su primer inicio de sesión. No hay
      registro público.
- [ ] **La retención de cada aplicación:** se aplican los mínimos salvo que definas más (seguridad
      730 días, auditoría 365, acceso 180, sistema 30, acceso a la auditoría 730, datos personales
      90, coordenadas 30: [database.md](database.md#audit-hubs-audit-tables)). Apunta las
      aplicaciones cuyo contrato o ley pide más.
- [ ] **Los canales de alertas:** el correo (un proveedor SMTP: el mismo envía las invitaciones), y
      un canal de Slack o un flujo de Teams si usas alguno
      ([manual 11.6](manual.es.md#116-audit-hub-avisos-de-alertas-y-geolocalización-por-ip)); quién
      los lee.
- [ ] **Geolocalización por IP** (opcional): los ficheros gratuitos de DB-IP Lite, descargados cada
      mes en cada servidor ([deploy-vps.md](deploy-vps.md#ip-geolocation)). Sin ellos no corren las
      reglas de país, viaje imposible y hosting.
- [ ] **Dónde se guardan los resúmenes (digests) de los checkpoints de integridad:** un lugar fuera
      de Audit Hub que quien tenga su servidor, su base de datos y `AUDIT_INTEGRITY_KEY` no pueda
      cambiar por sí solo (cada día se hace un checkpoint;
      [security.md](security.md#audit-log-integrity-retention-and-erasure)), y cada cuánto copias
      allí el último.
- [ ] **La figura legal** ([privacy/README.es.md](privacy/README.es.md#figuras)): para las
      aplicaciones de tus clientes eres su encargado y cada cliente es el responsable, con un
      contrato de encargo ([processor-contract.es.md](privacy/processor-contract.es.md)) con cada
      uno; para las aplicaciones de tu propia empresa ese contrato se convierte en una política
      interna. Para los usuarios de Audit Hub eres el responsable, con un aviso de privacidad
      propio. Un abogado revisa cada documento (fase 6).

### 0.2 Crea las cuentas

| Cuenta                                                  | Para                                                         | Notas                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub (mejor una organización que una cuenta personal) | código, CI, imágenes, despliegues                            | Acceso al repositorio de Audit Hub (privado por ahora). Un repositorio **privado** necesita **GitHub Team** (organización) o **Pro** (personal): de ello dependen los entornos con revisores obligatorios y sus secretos, los rulesets y la protección de ramas. En el plan Free solo existen para repositorios públicos |
| Un proveedor cloud o de VPS                             | los servidores (2 vCPU, 4 GB de RAM cada uno)                | cualquier proveedor con Ubuntu 24.04 y una IPv4 pública                                                                                                                                                                                                                                                                  |
| Un PostgreSQL gestionado                                | las bases de datos (16 o posterior)                          | a menudo el mismo proveedor; backups automáticos y point-in-time recovery obligatorios                                                                                                                                                                                                                                   |
| El DNS del dominio                                      | registros `A` hacia los servidores                           | el registrador o un servicio de DNS                                                                                                                                                                                                                                                                                      |
| Un proveedor de correo (SMTP)                           | invitaciones, recuperación de contraseña, correos de alertas | Amazon SES, Postmark, Resend, Brevo...; SPF, DKIM y DMARC en el dominio remitente                                                                                                                                                                                                                                        |
| Slack o Microsoft Teams (opcional)                      | mensajes de alertas                                          | un webhook entrante de un canal de Slack, o un flujo de Teams que empieza con "cuando se recibe una solicitud de webhook de Teams"                                                                                                                                                                                       |
| Una app de autenticación, para cada persona             | el segundo factor de cada cuenta                             | Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden...                                                                                                                                                                                                                                                   |
| Sentry (opcional)                                       | informes de errores de la API y del navegador                | el plan gratuito basta para empezar                                                                                                                                                                                                                                                                                      |
| Un monitor de uptime (opcional pero recomendado)        | una alerta cuando el sitio está caído                        | cualquier servicio que compruebe una URL desde varios lugares                                                                                                                                                                                                                                                            |
| Un gestor de contraseñas                                | los secretos de esta guía                                    | una bóveda compartida para el equipo                                                                                                                                                                                                                                                                                     |

### La hoja de trabajo

Copia esto en tu gestor de contraseñas o en tus notas y rellénalo a medida que avanzas. Los secretos
van solo en el gestor de contraseñas.

| Dato                                                                                                 | Valor                 | Fase  |
| ---------------------------------------------------------------------------------------------------- | --------------------- | ----- |
| Propietario / repositorio de GitHub                                                                  | `OWNER/REPO`          | 0     |
| Dominio de producción / dominio de staging                                                           |                       | 0     |
| El operador: razón social y contacto de privacidad (para los documentos legales)                     |                       | 0, 6  |
| Primeras aplicaciones que vas a conectar (nombre, slug, entorno)                                     |                       | 0, 9  |
| Administradores (al menos dos), auditores y lectores, con las aplicaciones que ve cada uno           |                       | 0, 8  |
| Aplicaciones con una retención mayor que los mínimos, y cuánta                                       |                       | 0, 9  |
| Dónde se guardan los resúmenes de los checkpoints, y cada cuánto se copian                           |                       | 0, 11 |
| IP del servidor de producción / IP del servidor de staging                                           |                       | 7     |
| Host de la base de datos (producción / staging)                                                      |                       | 7     |
| Contraseña de `app_migrator` (por entorno)                                                           | gestor de contraseñas | 7     |
| Contraseña de `app_runtime` (por entorno)                                                            | gestor de contraseñas | 7     |
| `JWT_ACCESS_SECRET` (por entorno, y uno para tu máquina)                                             | gestor de contraseñas | 3, 7  |
| `AUDIT_SECRETS_KEY` (por entorno; perderla pierde los secretos que guarda Audit Hub)                 | gestor de contraseñas | 3, 7  |
| `AUDIT_INTEGRITY_KEY` (por entorno; firma los sellos del registro de auditoría)                      | gestor de contraseñas | 3, 7  |
| SMTP: `MAIL_SMTP_URL` (proveedor, usuario, contraseña) y `MAIL_FROM`                                 | gestor de contraseñas | 7     |
| URL del webhook de Slack o de Teams (`AUDIT_SLACK_WEBHOOK_URL`, `AUDIT_TEAMS_WEBHOOK_URL`; opcional) | gestor de contraseñas | 7     |
| Clave SSH de despliegue (por entorno)                                                                | gestor de contraseñas | 7     |
| `RELEASE_PLEASE_TOKEN` (opcional)                                                                    | gestor de contraseñas | 5     |
| Email del primer administrador                                                                       |                       | 8     |
| Las variables de cada aplicación (`AUDIT_HUB_*`, se muestran una sola vez)                           | gestor de contraseñas | 9     |
| DSNs de Sentry (API, web)                                                                            |                       | 10    |

**Comprueba:** todas las cuentas de arriba existen y puedes iniciar sesión en cada una; las
decisiones de 0.1 tienen respuesta.

---

## Fase 1. Tu equipo

### 1.1 Instala las herramientas

| Herramienta        | Instalación                                                                                                                                                                | Comando de comprobación  | Esperado                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| Git                | Windows: [Git for Windows](https://git-scm.com/download/win) (incluye Git Bash y `openssl`); macOS: `xcode-select --install`; Linux: tu gestor de paquetes                 | `git --version`          | cualquier versión actual                                                  |
| Node.js 24         | [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux): `nvm install 24`; Windows: [fnm](https://github.com/Schniz/fnm) o el [instalador oficial](https://nodejs.org) (24 LTS) | `node --version`         | `v24.15.0` o posterior                                                    |
| pnpm               | `corepack enable` (una vez; Node.js 24 incluye Corepack, desde Node.js 25 instálalo antes: `npm install -g corepack`)                                                      | `pnpm --version`         | `12.5.1` (dentro del proyecto)                                            |
| Docker             | [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS) o Docker Engine (Linux)                                                                 | `docker compose version` | `Docker Compose version v2` o posterior                                   |
| GitHub CLI         | [cli.github.com](https://cli.github.com)                                                                                                                                   | `gh --version`           | cualquier versión actual                                                  |
| VS Code (sugerido) | [code.visualstudio.com](https://code.visualstudio.com)                                                                                                                     |                          | la primera vez que abres el proyecto, ofrece sus extensiones recomendadas |

**Comprueba:** cada comando de comprobación imprime el valor esperado. Docker Desktop está arrancado
(su icono muestra "Docker Desktop is running").

**Si falla:**

- `node` imprime una versión anterior: `nvm use 24` / `fnm use 24`, y después abre una terminal
  nueva.
- `pnpm` no se encuentra: ejecuta otra vez `corepack enable` en una terminal abierta como
  administrador (Windows) o con `sudo` (macOS/Linux). `corepack` no se encuentra (Node.js 25 o
  posterior): `npm install -g corepack`, o `npm install -g pnpm@12.5.1`.
- `docker compose version` falla: arranca Docker Desktop y espera hasta que diga que está en marcha.

### 1.2 Inicia sesión en GitHub desde la terminal

```
gh auth login
```

Elige GitHub.com, HTTPS, e inicia sesión con el navegador.

**Comprueba:** `gh auth status` dice `Logged in to github.com account <tu usuario>`.

### 1.3 Configura Git (una vez por equipo)

```
git config --global user.name "<Tu Nombre>"
git config --global user.email "<tu@acme.com>"
git config --global init.defaultBranch main
```

**Comprueba:** `git config --global --list` muestra los tres valores.

---

## Fase 2. Obtén Audit Hub

### 2.1 Obtén el código de Audit Hub

El repositorio de Audit Hub es privado por ahora: pide a su dueño acceso a
`<URL del repositorio de Audit Hub>`. Tu instancia necesita un repositorio de GitHub propio (fase
5): allí se ejecutan su CI, sus imágenes y sus despliegues.

Lo más fácil, si ves el repositorio de Audit Hub en GitHub: **Fork**, propietario `OWNER`, nombre
`REPO` (el fork de un repositorio privado también es privado). Después clona tu fork:

```
gh repo clone OWNER/REPO
cd REPO
```

Si no, clona el repositorio de Audit Hub; la fase 5 le da un repositorio tuyo:

```
git clone <URL del repositorio de Audit Hub> REPO
cd REPO
```

En los dos casos conserva el historial: `CHANGELOG.md` y la versión
(`.release-please-manifest.json`) continúan desde él.

**Comprueba:** `ls` muestra `apps`, `packages`, `docs`, `package.json`, `docker-compose.yml`.

### 2.2 Pon tus contactos

Abre el proyecto en tu editor (`code .`) y cambia:

| Fichero              | Cambio                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `SECURITY.md`        | `security@example.com` → tu contacto de seguridad; los tiempos de respuesta, si los tuyos son otros |
| `.github/CODEOWNERS` | sustituye `@your-org/...` por usuarios o equipos reales y quita el `#`                              |
| `README.md`          | el título y el primer párrafo, solo si cambias la marca de Audit Hub                                |

Deja el resto como está: los nombres de los paquetes, los títulos de la página y de la API,
`CHANGELOG.md` y la versión son los de Audit Hub.

**Comprueba:** al buscar `example.com` en el proyecto solo aparecen ejemplos y marcadores para más
adelante: los ficheros `.env.example` (también los de `deploy/vps`), tests, las cuentas del seed de
desarrollo, comentarios y documentación, y los valores por defecto de `infra/`, `dast.yml` y el smoke
test (fases 7 a 10); al buscar `REQUIERE CONFIGURACIÓN` aparecen los puntos que siguen pendientes
(la mayoría están en fases posteriores).

---

## Fase 3. Ejecútalo en local

### 3.1 Instala las dependencias

```
corepack enable
pnpm install
```

**Comprueba:** `pnpm install` termina con `Done in …`, y `git config core.hooksPath` imprime
`.husky/_` (los hooks de Git están instalados).

**Si falla:** `ERR_PNPM_UNSUPPORTED_ENGINE` → Node.js es anterior a 24.15 (fase 1).
`ERR_PNPM_NO_MATURE_MATCHING_VERSION` → una dependencia se publicó hace menos de siete días (la
política de supply chain): espera un día o consulta [troubleshooting.md](troubleshooting.md).

### 3.2 Crea tu configuración local

```
cp apps/api/.env.example apps/api/.env
openssl rand -hex 32
```

Abre `apps/api/.env` y pega el valor impreso después de `JWT_ACCESS_SECRET=`. En local no hace
falta nada más.

**Comprueba:** `grep -cE '^JWT_ACCESS_SECRET=[0-9a-f]{64}$' apps/api/.env` imprime `1` (el secreto
está puesto, sin imprimirlo). `git status` **no** lista `apps/api/.env` (está ignorado: nunca hagas
commit de él).

### 3.3 Arranca la base de datos

```
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

**Comprueba:** `db:up` termina con `Container … Healthy`; `db:migrate` dice que se aplicaron las
migraciones; `db:seed` imprime las cuentas de desarrollo, una por rol, y su segundo factor:

```
Seeded:
  admin   admin@example.com / admin-password
  auditor auditor@example.com / auditor-password
  viewer  viewer@example.com / viewer-password
  member  member@example.com / member-password
Second factor of every account (authenticator app, "enter a key"): JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
```

Añade esa clave a una app de autenticación en tu teléfono (Google Authenticator, Microsoft
Authenticator, 1Password, Bitwarden...: "introducir una clave", basada en tiempo). Cada inicio de
sesión pide su código después de la contraseña. Sin teléfono, `pnpm dev:totp` en otra terminal
imprime el código actual. Inicia sesión como administrador: el auditor y el lector inician sesión
cuando ven una aplicación (`pnpm dev:demo` les asigna las suyas), y el miembro nunca (muestra el
rechazo: "Your account does not have administrative access to this panel").

**Si falla:** `port is already allocated` (el puerto 5452 está ocupado o, en Windows, reservado) →
crea el `.env` de la raíz con `cp .env.example .env`, pon `DB_PORT=5443` en él, cambia el puerto de
`DATABASE_URL` en `apps/api/.env` a `5443` y repite.

### 3.4 Arranca la app

```
pnpm dev
```

**Comprueba**, en tu navegador:

| Abre                                                                                                 | Deberías ver                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| http://localhost:5273                                                                                | la página de inicio de sesión                            |
| inicia sesión como `admin@example.com` / `admin-password`, luego el código de la app                 | el Overview de las páginas de administración             |
| cierra la sesión, inicia sesión como `member@example.com` / `member-password`, luego un código nuevo | solo la página Home: un miembro no ve datos de auditoría |
| http://localhost:3200/api/docs                                                                       | la documentación de la API (Swagger)                     |
| http://127.0.0.1:3200/api/health/ready                                                               | una respuesta JSON con `"status":"ok"`                   |
| http://localhost:8045                                                                                | Mailpit, adonde llegan los correos de la app             |

La terminal muestra la primera línea de la API:
`Starting release unversioned in development: … error tracking off, Redis off, email on`, y un
recuadro con estas direcciones bajo los logs. `pnpm --filter api mail test --to tu@example.test`
encola un mensaje de prueba: aparece en Mailpit en unos segundos.

Las páginas de administración siguen vacías hasta que una aplicación envía eventos. Para verlas
llenas, ejecuta una vez `pnpm dev:demo` en otra terminal mientras corre `pnpm dev`: registra tres
aplicaciones de demostración y envía tres semanas de su actividad, y unos ataques generan alertas
en menos de cinco minutos ([manual 2.6](manual.es.md#26-arráncalo)).

Para con `Ctrl+C`. Mañana basta con `pnpm dev`.

---

## Fase 4. Comprueba que pasan todos los gates

Ejecútalo una vez ahora: si tu máquina pasa lo que ejecuta CI, un CI en rojo más adelante significa
un problema real en un cambio, no un problema de configuración.

### 4.1 El gate principal

```
pnpm verify
```

Ejecuta, en orden: formato, lint, tipos, tests unitarios y de componentes con cobertura, las
comprobaciones de seguridad (vulnerabilidades, licencias, secretos), el build y el presupuesto de
rendimiento. Tarda unos minutos.

**Comprueba:** termina sin errores; aparece el resumen de cobertura y las líneas del presupuesto
dicen `ok`.

### 4.2 Tests de integración y de navegador

```
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

**Comprueba:** los dos informan de que pasaron sus tests (`passed`, ningún `failed`); la ejecución
de integración además lista como saltada la suite de los adaptadores de Redis, que se ejecuta donde
`REDIS_TEST_URL` está definida (CI). Los tests end-to-end usan los puertos 3300 y 4273: para
`pnpm dev` antes.

### 4.3 Las comprobaciones con Docker

```
pnpm sast
pnpm lint:workflows
pnpm observability:check
```

**Comprueba:** Semgrep termina con `0 findings`; la comprobación de los workflows imprime
`No findings to report`; la de observabilidad imprime una línea que empieza por `ok` (dashboards,
alertas, nombres de métricas) y después el `SUCCESS` de promtool en cada uno de sus pasos.
`pnpm sast` tarda unos minutos (analiza una copia temporal de los ficheros que git versiona); la
primera vez también descarga la imagen de Semgrep.

### 4.4 Las imágenes de producción en tu máquina

Pon tres secretos para el stack de producción local en el `.env` de la raíz (créalo con
`cp .env.example .env` si no lo has hecho): ábrelo y pega los valores que imprimen los tres primeros
comandos después de `JWT_ACCESS_SECRET=`, `AUDIT_SECRETS_KEY=` y `AUDIT_INTEGRITY_KEY=`, y después arranca el stack:

```
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
docker compose --profile stack up --build
```

En una segunda terminal:

```
pnpm smoke --url http://localhost:8180
```

**Comprueba:** el smoke test termina con `Smoke test passed (public URL only).` y
http://localhost:8180 muestra la app. El stack usa la base de datos de desarrollo (el mismo servicio
`db` y su volumen), así que las cuentas de 3.3 también inician sesión ahí.

Páralo: `Ctrl+C`, y después `docker compose --profile stack down`.

---

## Fase 5. Súbelo a GitHub

### 5.1 Primer commit y push

Si hiciste un fork del repositorio de Audit Hub (2.1), `origin` ya es tu fork. En GitHub, abre la
pestaña **Actions** del fork y activa sus workflows (GitHub los deja apagados en un fork). Si no,
conserva el repositorio de Audit Hub como `upstream` y crea el tuyo:

```
git remote rename origin upstream
gh repo create OWNER/REPO --private --source . --remote origin
```

Después:

```
git add -A
git commit -m "chore: set the security contact and code owners"
git push --no-verify -u origin main
```

El commit pasa las comprobaciones de pre-commit por los ficheros que cambiaste (unos segundos).
`--no-verify` es solo para este primer push: a partir de ahora el hook rechaza los pushes a `main`.

**Comprueba:** el repositorio en GitHub muestra tus ficheros y el historial de Audit Hub; la
pestaña **Actions** muestra una ejecución de **CI** en `main` (debería terminar en verde).

### 5.2 Ajustes del repositorio

En GitHub → **Settings**:

1. **General → Pull Requests**: permite solo **squash merging**; mensaje de commit por defecto
   "**Pull request title**"; marca **Automatically delete head branches**.
2. **Actions → General → Workflow permissions**: **Read repository contents and packages
   permissions**, y marca **Allow GitHub Actions to create and approve pull requests** (el
   workflow **Release** abre el pull request de release con el token del workflow).
3. **Environments → New environment** `staging`: **Deployment branches and tags → Selected
   branches and tags → Add rule `main`**.
4. **Environments → New environment** `production`: la misma regla para `main`, y **Required
   reviewers** (las personas de 0.1; marca **Prevent self-review**).
5. **Code security**: activa **Dependabot alerts**, **Dependabot security updates**, **Secret
   scanning** con **Push protection** (si tu plan los ofrece), **Private vulnerability
   reporting**.
6. **Rules → Rulesets**: importa los dos ficheros, o con la CLI:

   ```
   gh api repos/OWNER/REPO/rulesets --method POST --input .github/rulesets/main.json
   gh api repos/OWNER/REPO/rulesets --method POST --input .github/rulesets/tags.json
   ```

   Los rulesets necesitan un repositorio público o GitHub Team. Con GitHub Pro (una cuenta
   personal), usa en su lugar **Branches → Add branch protection rule** para `main`: exige un pull
   request con una aprobación y los status checks **CI passed** y **Conventions**. En el plan Free
   con un repositorio privado no está disponible nada de esto (ni ninguno de los entornos de los
   pasos 3–4): haz público el repositorio o cambia a un plan superior antes de seguir; si no, las
   protecciones de esta guía solo existen sobre el papel. Dos workflows compensan una parte en
   cualquier plan: `main-guard.yml` avisa de un push a `main` que no es un pull request mergeado, y
   `dependabot-auto-merge.yml` comprueba él mismo la aprobación y el CI. Nada reemplaza a los
   revisores obligatorios de un despliegue ([ci-cd.md](ci-cd.md#required-check)).

**Comprueba:** **Settings → Environments** lista `staging` y `production`, los dos limitados a
`main`; **Rules** (o la protección de ramas) muestra la regla de `main`.

### 5.3 El token para los pull requests de release

Opcional, el token de release: sin él, el workflow **Release** lanza él mismo el CI en el pull
request de release, y la comprobación de convenciones (**CI passed** y **Conventions**, los dos
checks que pide el ruleset). Con un token de una GitHub App o un **fine-grained personal access
token**, guardado como `RELEASE_PLEASE_TOKEN`, el pull request de release ejecuta todos los
workflows de pull request, como el de una persona ([ci-cd.md](ci-cd.md#release-pull-requests)). El
token fine-grained:

1. GitHub → tu avatar → **Settings → Developer settings → Personal access tokens → Fine-grained
   tokens → Generate new token**.
2. Resource owner `OWNER`; **Only select repositories** → `REPO`; la caducidad que diga tu
   política.
3. Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**,
   **Issues: Read and write**.
4. Genéralo, cópialo y después:

   ```
   gh secret set RELEASE_PLEASE_TOKEN
   ```

   y pégalo cuando te lo pida.

**Comprueba:** si configuraste el token de release, `gh secret list` muestra
`RELEASE_PLEASE_TOKEN`; apunta su fecha de caducidad en el
[calendario de mantenimiento](#fase-13-el-calendario-de-mantenimiento).

### 5.4 Comprueba el flujo de pull request

```
git switch -c chore/check-pipeline
printf '\nThis instance is operated by Acme.\n' >> README.md
git commit -am "docs: check the pipeline"
git push -u origin HEAD
gh pr create --fill
gh pr checks --watch
```

**Comprueba:** el pull request muestra **CI passed** en verde (unos 15 minutos la primera vez) y,
con el ruleset, no se puede mergear sin una aprobación. Mergéalo (**Squash and merge**).

Un cambio `docs` o `chore` no publica nada por sí solo: el workflow **Release** abre un pull
request de release en cuanto `main` tiene un `feat` o un `fix` que ninguna release incluye
todavía, y lanza en él el CI y Conventions (**CI passed** y **Conventions** en verde en ese pull request unos minutos después).
Déjalo abierto: mergéalo cuando quieras publicar tu primera release (fase 8).

---

## Fase 6. Prepara tu instancia

Casi toda esta fase es esperar al abogado: empiézala ahora y sigue con las fases 7 a 9 mientras
tanto.

1. **Los documentos legales.** [privacy/](privacy/README.es.md) contiene plantillas, no asesoría
   legal: el contrato de encargo, los párrafos que cada aplicación conectada añade a su aviso de
   privacidad, una evaluación de impacto y el procedimiento ARCO. En tus propias copias, rellena
   cada marcador entre [corchetes] con la figura decidida en 0.1, y entrégalas a un abogado, que
   responde cada punto marcado "Requiere revisión legal" y prepara el texto vinculante en español
   ([Antes de usarlas](privacy/README.es.md#antes-de-usarlas)). Los usuarios de Audit Hub también
   necesitan un aviso de privacidad tuyo.
2. **Cómo se crean las cuentas.** Audit Hub tiene inicio de sesión con segundo factor en toda
   cuenta, los roles `member` (que no puede iniciar sesión), `viewer`, `auditor` y `admin`,
   invitaciones de los administradores (con correo; auditores y lectores con las aplicaciones que
   verán), recuperación y cambio de contraseña, y cambio de correo. No hay registro público
   (`SIGN_UP_ENABLED=true` detiene el arranque). El primer administrador, y todas las cuentas
   mientras el correo esté apagado, se crean con el comando `create-user`
   ([fase 8](#84-crea-el-primer-administrador)).
3. **Cambios en Audit Hub** (opcionales; la mayoría de las instancias lo ejecutan tal cual). Cada
   uno sigue [el ciclo diario](#fase-12-el-ciclo-diario): una rama, un pull request, CI, revisión,
   merge. Los umbrales de las reglas de detección (`apps/api/src/rules/rules.constants.ts`) son
   puntos de partida, que se ajustan con tráfico real ([security.md](security.md#detection-rules));
   cualquier otro cambio sigue las recetas de [how-to.md](how-to.md), y
   [el paquete de diseño](design/audit-hub/README.md) explica por qué Audit Hub está hecho así.
4. **Servicios opcionales**, solo si hacen falta: Redis (más de una instancia de la API),
   OpenTelemetry (trazas y métricas): [manual.es.md](manual.es.md#11-infraestructura-opcional).

**Comprueba:** los documentos están con el abogado; en cada cambio tuyo, `pnpm verify` pasa en
local y **CI passed** está en verde en su pull request.

Haz las fases 7 y 8 pronto: así cada cambio mergeado se puede probar en un servidor real.

---

## Fase 7. Servidores de producción

Haz esta fase dos veces: una para **staging** y otra para **producción**. Los comandos usan
`app.acme.com`; usa el dominio del entorno que estás configurando.

Los pasos 7.1 a 7.5 construyen el servidor y la base de datos a mano, con cualquier proveedor. En
DigitalOcean, Terraform puede construir los mismos: haz el 7.0, sáltate del 7.1 al 7.5 y sigue en
el 7.6.

### 7.0 En DigitalOcean, del 7.1 al 7.5 con Terraform (opcional)

Qué crea Terraform, cuánto cuesta y por qué:
[deploy-vps.md](deploy-vps.md#provision-with-terraform-digitalocean). Necesitas Terraform 1.16.5 o un
1.16 posterior ([developer.hashicorp.com/terraform/install](https://developer.hashicorp.com/terraform/install);
`terraform version` imprime `Terraform v1.16.` y un número de parche de 5 o más) y un token de la API de
DigitalOcean con permiso de escritura (**API → Tokens**).

En tu equipo, la clave de despliegue de este entorno (como en el 7.4) y después el fichero de
ajustes:

```
ssh-keygen -t ed25519 -N "" -C "github-deploy-production" -f deploy_production
cd infra/terraform/digitalocean
cp terraform.tfvars.example production.tfvars
```

Edita `production.tfvars`: `project_name`, `environment`, `domain`, tu clave pública SSH
(`admin_ssh_public_key`, el contenido de tu `~/.ssh/id_ed25519.pub`), el contenido de
`deploy_production.pub` (`deploy_ssh_public_key`) y `alert_emails` (miembros verificados de tu
equipo de DigitalOcean). Deja `admin_cidrs = ["0.0.0.0/0"]`: los runners de GitHub se conectan por
SSH desde direcciones que cambian. Después (pega el token cuando `read` espere, y pulsa Enter):

```
read -rs DIGITALOCEAN_TOKEN && export DIGITALOCEAN_TOKEN
terraform init
terraform workspace new production
terraform plan -var-file=production.tfvars -out=production.tfplan
terraform apply production.tfplan
rm production.tfplan
ssh "$(terraform output -raw ssh_admin)" cloud-init status --wait
```

La primera conexión SSH pregunta si confías en la clave del servidor: compara su huella con la que
muestra el servidor en la **Droplet Console** de DigitalOcean (entra como `ops` y ejecuta
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`). Después apunta el dominio al servidor, salvo
que lo haya hecho `manage_dns = true`: el registro que muestra `terraform output dns_record`, en
tu proveedor de DNS. Por último, los roles de la base de datos y la clave del servidor para GitHub:

```
cd ../../..
pnpm iac:database
ssh-keyscan -t ed25519 app.acme.com > known_hosts_production
```

**Comprueba:** `cloud-init status --wait` termina con `status: done`; `pnpm iac:database` termina
con `Done: the database app (owner app_migrator) and the role app_runtime.`;
`ssh -i deploy_production deploy@app.acme.com 'docker ps'` imprime una tabla vacía (solo las
cabeceras); `ssh-keygen -lf known_hosts_production` muestra la huella que comparaste.

**Si falla:**

| Mensaje                                              | Causa y solución                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`, `Unable to authenticate you`                  | `DIGITALOCEAN_TOKEN` no está exportado en esta terminal, o el token no puede escribir                                                                                                                                                     |
| `Invalid value for variable`                         | el valor que nombra en `production.tfvars`; `variables.tf` dice qué acepta cada uno                                                                                                                                                       |
| `SSH Key is already in use on your account`          | esta clave de despliegue ya está en DigitalOcean (otro entorno, un intento anterior): una clave de despliegue por entorno, o borra la antigua allí (**Settings → Security**)                                                              |
| `Provider produced inconsistent result after apply`  | la nueva IP reservada tardó en aparecer en la API de DigitalOcean: `terraform import -var-file=production.tfvars digitalocean_reserved_ip.app <dirección>` (la dirección en **Networking → Reserved IPs**), después plan y apply de nuevo |
| `The workspace (...) is not the environment (...)`   | `terraform workspace select production`                                                                                                                                                                                                   |
| `status: error`                                      | `/var/log/cloud-init-output.log` en el servidor dice qué comando falló                                                                                                                                                                    |
| `pnpm iac:database`: `Permission denied (publickey)` | tu clave SSH no es la de `admin_ssh_public_key`                                                                                                                                                                                           |

### 7.1 Crea el servidor

En la consola de tu proveedor: un servidor con **Ubuntu 24.04 LTS**, 2 vCPU y 4 GB de RAM o más,
una IPv4 pública y tu clave pública SSH personal para el primer acceso. Si el proveedor tiene
firewall, permite TCP 22, 80 y 443, y UDP 443.

**Comprueba:** `ssh root@<IP del servidor>` (o el usuario que indique el proveedor) abre una shell
en el servidor.

### 7.2 Apunta el dominio al servidor

En tu proveedor de DNS: un registro **A** `app.acme.com` → la IPv4 del servidor. Ningún registro
**AAAA**: el despliegue sirve solo IPv4 ([deploy-vps.md](deploy-vps.md#2-create-the-server) explica
por qué).

**Comprueba**, después de unos minutos: `nslookup app.acme.com` responde con la dirección del
servidor.

### 7.3 Instala Docker y cierra el firewall

Conectado al servidor, copia estas líneas, un bloque cada vez:

```
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

```
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

**Comprueba:** `docker compose version` imprime `Docker Compose version v2` o posterior; `sudo ufw status`
lista OpenSSH, 80 y 443 como `ALLOW`.

### 7.4 Crea el usuario de despliegue

En el servidor:

```
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo install -d -m 755 -o deploy -g deploy /srv/app
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
```

En **tu equipo**, una clave para que GitHub se conecte (una por entorno; sin frase de contraseña):

```
ssh-keygen -t ed25519 -N "" -C "github-deploy-production" -f deploy_production
scp deploy_production.pub <tu usuario>@app.acme.com:/tmp/deploy.pub
ssh <tu usuario>@app.acme.com 'sudo install -m 600 -o deploy -g deploy /tmp/deploy.pub /home/deploy/.ssh/authorized_keys && rm /tmp/deploy.pub'
ssh-keyscan -t ed25519 app.acme.com > known_hosts_production
```

**Comprueba:** `ssh -i deploy_production deploy@app.acme.com 'docker ps'` imprime una tabla vacía
(solo las cabeceras). Compara la clave de `known_hosts_production` con la clave de host que muestra
la consola de tu proveedor (o ejecuta `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` en el
servidor y `ssh-keygen -lf known_hosts_production` en tu equipo: las huellas tienen que coincidir).

### 7.5 Crea la base de datos

En la consola de tu proveedor, un **PostgreSQL 16 o posterior** gestionado: en la misma región que
el servidor, con **backups automáticos** y **point-in-time recovery** activados, **protección contra
borrado** (deletion protection) activada, y acceso solo desde la IP del servidor (o una red
privada). Apunta su nombre de host.

Genera dos contraseñas (`openssl rand -hex 24`, dos veces) y guárdalas en el gestor de contraseñas.
Después, conectado como el administrador del proveedor
(`psql "<cadena de conexión del administrador>"`):

```sql
CREATE ROLE app_migrator LOGIN PASSWORD '<contraseña de app_migrator>';
GRANT app_migrator TO CURRENT_USER;
CREATE DATABASE app OWNER app_migrator;
CREATE ROLE app_runtime LOGIN PASSWORD '<contraseña de app_runtime>' CONNECTION LIMIT 50;
```

Después, conectado **como `app_migrator`** a la base de datos `app`
(`psql "postgresql://app_migrator:<contraseña de app_migrator>@<host>:5432/app?sslmode=require"`):

```sql
GRANT CONNECT ON DATABASE app TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
```

**Comprueba:** cada sentencia responde `CREATE ROLE`, `GRANT ROLE`, `CREATE DATABASE`, `GRANT` o
`ALTER DEFAULT PRIVILEGES`, sin errores. Sin `GRANT app_migrator TO CURRENT_USER`, PostgreSQL 16 y
posteriores rechazan `CREATE DATABASE` (`must be able to SET ROLE "app_migrator"`): los
administradores de los proveedores no son superusuarios. El migrador será el propietario del
esquema y quien lo cambie; la API se conecta como `app_runtime`, que solo lee y escribe datos.

### 7.6 Copia los ficheros de despliegue al servidor

Desde la carpeta del proyecto en tu equipo:

```
scp deploy/vps/* deploy@app.acme.com:/srv/app/
```

Más adelante, cuando una release cambie alguno de estos ficheros (Dependabot actualiza la imagen de
Caddy en `deploy/vps`), el workflow Deploy se detiene en **Check the server's deploy files** hasta
que los vuelvas a copiar ([deploy-vps.md](deploy-vps.md#update-the-server-files)).

En el servidor, como `deploy` (`ssh -i deploy_production deploy@app.acme.com`):

```
cd /srv/app
chmod 755 deploy.sh rollback.sh
cp server.env.example server.env
cp api.env.example api.env
cp migrate.env.example migrate.env
cp web.env.example web.env
chmod 600 api.env migrate.env
openssl rand -hex 32
```

Edita cada fichero (`nano <fichero>`, guarda con `Ctrl+O`, sal con `Ctrl+X`):

| Fichero       | Define                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server.env`  | `APP_DOMAIN=app.acme.com`                                                                                                                                                                                                                                                                                                                              |
| `api.env`     | `DATABASE_URL=postgresql://app_runtime:<contraseña de app_runtime>@<host de la base de datos>:5432/app?sslmode=require`, `JWT_ACCESS_SECRET=<el valor que imprimió openssl>`, `AUDIT_SECRETS_KEY=<otro valor que imprimió openssl>`, `AUDIT_INTEGRITY_KEY=<un tercero>`, `APP_ENVIRONMENT=production` (o `staging`), `APP_ORIGIN=https://app.acme.com` |
| `migrate.env` | `DATABASE_URL=postgresql://app_migrator:<contraseña de app_migrator>@<host de la base de datos>:5432/app?sslmode=require`                                                                                                                                                                                                                              |
| `web.env`     | `APP_ENVIRONMENT=production` (o `staging`)                                                                                                                                                                                                                                                                                                             |

Con Terraform (7.0), los dos valores de `DATABASE_URL` ya están completos: en
`infra/terraform/digitalocean` en tu equipo, `terraform output -raw database_runtime_url`
(`api.env`) y `terraform output -raw database_migrator_url` (`migrate.env`).

En DigitalOcean o Amazon RDS, cuyos certificados vienen de la CA propia del proveedor, termina las
dos URL con `?sslmode=require&uselibpqcompat=true` (las salidas de Terraform ya lo hacen): si no,
la API rechaza el certificado (un error de certificado como
`self-signed certificate in certificate chain`,
[deploy-vps.md](deploy-vps.md#6-the-files-on-the-server)).

**Correo** (opcional, pero las invitaciones, la recuperación de contraseña y los correos de alertas
de Audit Hub lo necesitan; sin él el resto funciona): en `api.env`,
`MAIL_SMTP_URL=smtps://<usuario>:<contraseña, codificada con %>@<host del proveedor>:465` y
`MAIL_FROM="Acme <no-reply@acme.com>"` de tu proveedor de correo (Amazon SES, Postmark, Resend,
Brevo...), y en el proveedor, SPF, DKIM y DMARC para `acme.com` ([manual](manual.es.md#115-correo)).
Tras el primer despliegue (fase 8),
`docker compose --env-file server.env --env-file release.env run --rm -T api node dist/infrastructure/mail/mail.cli.js test --to <tú>`
debe imprimir `Delivered`. Si termina en `connection` o se agota el tiempo, puede que el servidor no
tenga permitido enviar SMTP (DigitalOcean bloquea los puertos 25, 465 y 587 en muchas cuentas): usa
el puerto 2525 del proveedor (`smtp://<usuario>:<contraseña>@<host del proveedor>:2525`, STARTTLS) o
pide al soporte de DigitalOcean que lo desbloquee.

**Canales de alertas** (opcional): en `api.env`,
`AUDIT_SLACK_WEBHOOK_URL=<el webhook entrante de Slack>` o
`AUDIT_TEAMS_WEBHOOK_URL=<la URL del flujo de Teams>`: las alertas nuevas desde severidad medium,
y otra vez las que nadie reconoce, como dice el escalamiento de cada severidad (se define en
**Detection rules**) ([manual](manual.es.md#116-audit-hub-avisos-de-alertas-y-geolocalización-por-ip)).
**Geolocalización por IP** (opcional): los ficheros y las variables `GEOIP_*` de
[deploy-vps.md](deploy-vps.md#ip-geolocation), en `/srv/app/geoip` y `api.env`.

**Comprueba:** `ls -l /srv/app` muestra `api.env` y `migrate.env` como `-rw-------` (solo `deploy`
puede leerlos), y `grep -c '<' *.env` imprime `0` para cada fichero (no queda ningún marcador).

### 7.7 Dale a GitHub los datos del servidor

Una vez para el repositorio:

```
gh variable set DEPLOY_TARGET --body vps
gh variable set IMAGE_PREFIX --body ghcr.io/<owner>/<repo>
```

(`IMAGE_PREFIX` en minúsculas: `ghcr.io/acme/acme-portal`.)

Para el entorno que estás configurando (aquí `production`; `staging` la otra vez):

```
gh variable set DEPLOY_HOST --env production --body app.acme.com
gh variable set PUBLIC_URL --env production --body https://app.acme.com
gh secret set DEPLOY_SSH_KEY --env production < deploy_production
gh secret set DEPLOY_KNOWN_HOSTS --env production < known_hosts_production
```

Guarda `deploy_production` en el gestor de contraseñas, y después bórralo de tu equipo junto con
`known_hosts_production`.

**Comprueba:** **Settings → Environments → production** lista las variables `DEPLOY_HOST`,
`PUBLIC_URL` y los secretos `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`; **Settings → Secrets and
variables → Actions → Variables** lista `DEPLOY_TARGET` e `IMAGE_PREFIX`.

Ahora repite la fase para el otro entorno: 7.0 o 7.1–7.5, y después 7.6 y 7.7.

---

## Fase 8. El primer despliegue

### 8.1 Despliega en staging

```
gh workflow run deploy.yml --ref main -f environment=staging -f ref=main
gh run watch
```

Tarda 15–25 minutos la primera vez. Los jobs, en orden: Resolve the commit → Gates → Publish
api / api-migrate / web → Release to staging (server).

**Comprueba:** la ejecución termina en verde; su resumen lista los tres digests de las imágenes; el
último paso imprime `Smoke test passed (public URL only).`; https://staging.acme.com abre la página
de inicio de sesión con un certificado válido (el candado).

**Si falla:**

| Paso que falla                                              | Causa y arreglo                                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gates                                                       | lo mismo que un CI en rojo: abre el log del job que falla ([troubleshooting.md](troubleshooting.md))                                                                                              |
| Publish: "The registry is ghcr.io"                          | `IMAGE_PREFIX` tiene que ser `ghcr.io/<owner>/<repo>` en minúsculas (7.7)                                                                                                                         |
| Publish: "Scan the pushed image"                            | un aviso HIGH o CRITICAL con arreglo en la imagen publicada, como en el escaneo de imágenes de los gates: actualiza la imagen base o la dependencia ([security.md](security.md#container-images)) |
| Environment settings                                        | falta una variable o un secreto del entorno (7.7)                                                                                                                                                 |
| Deploy on the server: `Permission denied (publickey)`       | la clave pública no está en `/home/deploy/.ssh/authorized_keys`, o `DEPLOY_SSH_KEY` tiene la clave privada equivocada (7.4)                                                                       |
| `Host key verification failed`                              | `DEPLOY_KNOWN_HOSTS` no coincide con el servidor (7.4)                                                                                                                                            |
| Check the server's deploy files: "Server files out of date" | una release cambió un fichero de `deploy/vps`: vuelve a copiarlos ([deploy-vps.md](deploy-vps.md#update-the-server-files))                                                                        |
| `server.env is missing`                                     | 7.6 no se hizo en ese servidor                                                                                                                                                                    |
| The migration failed                                        | `migrate.env`: contraseña o host equivocados, o la base de datos no es accesible desde el servidor (7.5)                                                                                          |
| The rollout failed                                          | el log del paso termina con las últimas líneas de log de los contenedores nuevos, y después la release anterior vuelve a arrancar; normalmente es `api.env` (`DATABASE_URL`, `JWT_ACCESS_SECRET`) |
| Smoke test, errores de certificado                          | el DNS todavía no apunta al servidor, o los puertos 80/443 están cerrados (7.2, 7.3)                                                                                                              |

### 8.2 Míralo

Abre https://staging.acme.com. La página de inicio de sesión carga; nadie puede iniciar sesión
todavía: las bases de datos de producción no tienen cuentas.

### 8.3 Publica la primera release y despliégala en producción

1. Mergea el pull request de release, "chore(main): release <versión>" (5.4: existe en cuanto
   `main` tiene un `feat` o un `fix` que ninguna release incluye). La versión continúa desde
   `.release-please-manifest.json` (ahora `0.1.0`): antes de 1.0.0, un `fix` da el siguiente patch
   (0.1.1) y un `feat` el siguiente minor (0.2.0). Para elegir la primera versión, mergea antes un pull request añadiendo el pie `Release-As: <versión>` a su
   mensaje de commit en el diálogo de **Squash and merge**. Si el pull request de release ofrece
   **Update branch**, púlsalo antes ([ci-cd.md](ci-cd.md#release-pull-requests)). El workflow
   **Release** crea el tag `v<versión>` y la GitHub release.
2. Despliega ese tag en staging y después en producción:

   ```
   gh workflow run deploy.yml --ref main -f environment=staging -f ref=v<versión>
   gh run watch
   gh workflow run deploy.yml --ref main -f environment=production -f ref=v<versión>
   ```

3. La ejecución de producción se detiene en **Release to production (server)** esperando la
   aprobación: un revisor abre la ejecución en GitHub → **Review deployments** → **Approve and
   deploy**.

**Comprueba:** las dos ejecuciones terminan en verde; producción no construye nada (su resumen lista
los tres digests de la ejecución de staging, "built and scanned by run <su id>");
https://app.acme.com abre la página de inicio de sesión.

### 8.4 Crea el primer administrador

En cada servidor (staging y producción), como `deploy`:

```
cd /srv/app
read -rs PASSWORD
```

Escribe la contraseña (15 caracteres o más, unas cuantas palabras funcionan bien; no se muestra
nada), pulsa Enter y después:

```
printf '%s' "$PASSWORD" | docker compose --env-file server.env --env-file release.env \
  run --rm -T api node dist/users/create-user.cli.js \
  --email <email del primer administrador> --name "<Nombre>" --role admin
unset PASSWORD
```

**Comprueba:** imprime `Created the admin account <email> (<id>).`

Inicia sesión en el sitio con ese email y esa contraseña. El primer inicio de sesión configura el
segundo factor: escanea el código QR con tu app de autenticación (o escribe la clave que aparece en
"Can't scan it?"), introduce su código y guarda los 10 códigos de recuperación, que se muestran una
sola vez, en un lugar que solo tú puedas abrir (tu propio gestor de contraseñas): cada uno sirve
para un inicio de sesión sin el teléfono. A partir de ahí cada inicio de sesión pide la contraseña
y un código.

**Comprueba:** después del segundo factor se abre el Overview (vacío hasta que se conecta una
aplicación, fase 9), el menú muestra Applications, Retention, Integrity, Users e Invitations, y la
cabecera dice **Live** en pocos segundos (las alertas en vivo del panel llegan a través de Caddy;
otro proxy delante no debe retenerlas: [deploy-vps.md](deploy-vps.md#how-it-works)).

**Las demás personas** llegan por invitación, desde las páginas de administración (con el correo
encendido, 7.6):

1. **Invitations**: su dirección y un rol (Member o Admin). La persona abre el enlace (válido 7
   días), elige su nombre y su contraseña, y configura su propia app de autenticación.
2. Un auditor o un lector: invítalo como Member; cuando haya aceptado, **Users** → su página →
   **Role** (auditor o viewer), y después las aplicaciones que ve (cuando la fase 9 las registre).
   Los cambios de rol y de aplicaciones vuelven a pedir tu contraseña y un código nuevo si la
   última vez fue hace más de 5 minutos.
3. Un segundo administrador (0.1): con uno solo, nadie puede restablecer el segundo factor de ese
   administrador desde las páginas de administración.

Sin correo, cada cuenta se crea con el mismo comando `create-user` (`--role admin`, `auditor`,
`viewer` o `member`), y configura su segundo factor en su primer inicio de sesión.

**Comprueba:** **Users** lista a todas las personas de 0.1 con su rol; **Invitations** no tiene
ninguna pendiente.

### 8.5 Ensaya un rollback (staging)

Staging ejecuta `v<versión>` (8.3) y guarda el build de 8.1 como la release anterior: es lo que un
rollback vuelve a poner. En el servidor de staging:

```
cd /srv/app
./rollback.sh
```

**Comprueba:** imprime `rollback: running <commit de 8.1>`;
https://staging.acme.com/app-config.json muestra ese commit como `release`; el sitio sigue
funcionando.

Después devuelve staging a la release con el workflow, como cualquier despliegue:

```
gh workflow run deploy.yml --ref main -f environment=staging -f ref=v<versión>
gh run watch
```

**Comprueba:** la ejecución termina en verde y `app-config.json` vuelve a mostrar el commit de
`v<versión>`. Hacer un rollback (una vuelta atrás) ya es algo que has hecho, no algo que has leído.

---

## Fase 9. Conecta la primera aplicación

Audit Hub ya funciona; ahora una aplicación le envía sus eventos. Empieza con la elegida en 0.1
(una aplicación de prueba, o el entorno de staging de una real) y el staging de Audit Hub; después,
los mismos pasos para producción, como un registro nuevo. El procedimiento completo, con cada
variable y los flujos que hay que registrar:
[audit/connection-guide.es.md](audit/connection-guide.es.md); en resumen:
[manual 11.9](manual.es.md#119-audit-hub-conectar-un-proyecto).

### 9.1 Registra la aplicación

Con la sesión iniciada en Audit Hub como administrador: **Applications → Register an
application**, con su nombre, su slug y su entorno, y su URL de webhook (opcional:
`https://<host del proyecto>/api/audit/webhooks`, para que le lleguen las alertas, "¿Fuiste tú?" y
las acciones de respuesta). Pide tu contraseña y un código nuevo. La página siguiente muestra las
variables de la aplicación **una sola vez** (`AUDIT_HUB_URL`, `AUDIT_HUB_APP`, `AUDIT_HUB_KEY_ID`,
`AUDIT_HUB_KEY_SECRET`, `AUDIT_HUB_PSEUDONYM_KEY`, `AUDIT_HUB_WEBHOOK_SECRET`): cópialas al gestor
de contraseñas antes de salir de ella.

Después, si 0.1 lo dice: **Retention** → la aplicación → los días de cada clase (nunca por debajo
de los mínimos), y **Users** → cada auditor o lector → las aplicaciones que ve.

**Comprueba:** **Applications** la lista; `AUDIT_HUB_URL` es la dirección del propio Audit Hub
(`APP_ORIGIN`, 7.6).

### 9.2 Instala el conector en el proyecto

Un proyecto creado desde las plantillas después de aplicarles sus parches ya tiene el conector,
instalado y apagado: sigue en el 9.3. Si no, desde tu checkout de Audit Hub en un tag de release,
con las dependencias del proyecto instaladas:

```
pnpm connector add --target <proyecto>
```

Después, en el proyecto: `pnpm db:migrate`, las cuatro ediciones de conexión que imprime el
comando y los flujos que hay que registrar
([Puntos de integración](audit/connection-guide.es.md#puntos-de-integración)). Haz commit de
`audit-connector.json` y `.audit-connector/` con el resto, en el pull request del propio proyecto.

**Comprueba:** `pnpm verify` del proyecto pasa; `pnpm connector status --target <proyecto>` (desde
Audit Hub) muestra la versión instalada.

### 9.3 Enciéndelo

Define las variables del 9.1 en el entorno del proyecto (su gestor de secretos, o el `api.env` de
su servidor) y vuelve a desplegar el proyecto.

**Comprueba**, en Audit Hub:

- en menos de un minuto, el **Overview** muestra la aplicación con su último heartbeat;
- inicia sesión en el proyecto (una contraseña equivocada también cuenta): **Events** muestra el
  evento;
- con una URL de webhook: la página de la aplicación → **Webhooks** → **Send a test**, y la entrega
  de debajo muestra `delivered`;
- la **SOC view** muestra la fuente de la aplicación como **Active**. Detén el proyecto: pasado su
  plazo de heartbeat la fuente pasa a **Disconnected** y se abre una alerta `source_silent` (con un
  aviso y, si ya hiciste clic en la página, su sonido); vuelve a arrancarlo y la alerta se resuelve
  sola.

**Si falla:** si no hay heartbeat después de unos minutos, el proyecto no llega a Audit Hub o lo
rechaza: con las métricas del proyecto encendidas (OpenTelemetry), la métrica del conector
`app_audit_hub_requests_total` dice cómo terminan sus peticiones (`refused`, `unreachable`...), y
[Observabilidad](audit/connection-guide.es.md#observabilidad) en la guía lista sus alertas. Comprueba que están todas las variables del 9.1, sin nada cortado.

---

## Fase 10. Monitorización y alertas

### 10.1 Informes de errores (Sentry)

1. En Sentry, crea dos proyectos: **Node.js** (la API) y **Browser JavaScript** (la app web).
   Copia el DSN de cada proyecto.
2. En cada servidor, añade `SENTRY_DSN=<DSN de la API>` a `api.env` y `WEB_SENTRY_DSN=<DSN de la web>`
   a `web.env`, y después:

   ```
   cd /srv/app
   docker compose --env-file server.env --env-file release.env up -d --wait api web
   ```

**Comprueba:** `https://app.acme.com/app-config.json` muestra el DSN de la web; la línea de log de
la API muestra `Starting release … error tracking on`
(`docker compose --env-file server.env --env-file release.env logs api | head`).
En Sentry, define las reglas de alerta: [alerting.md](alerting.md).

### 10.2 Uptime

En tu monitor de uptime, añade dos checks, cada minuto y desde varias regiones:

- `https://app.acme.com/healthz` (el servidor web),
- `https://app.acme.com/app-config.json` (se sirve la configuración de la app).

Envía las alertas a las personas de 0.1 (email y una notificación en el teléfono).

**Comprueba:** los dos checks muestran "up"; envía la notificación de prueba del monitor y confirma
que la recibió cada persona de la lista.

### 10.3 Logs

Los logs de los contenedores se quedan en el servidor (`docker compose … logs`), con rotación:
cinco ficheros de 10 MB por contenedor. Si tienes más de un
servidor, o para buscar en ellos, envíalos a un servicio de logs
([observability.md](observability.md)).

---

## Fase 11. Antes de los usuarios reales

Recorre [production-readiness.md](production-readiness.md) con el equipo y marca cada línea con su
evidencia. Las que esta guía todavía no ha cubierto:

1. **Un simulacro de restore** de la base de datos: restaura el último backup en una instancia nueva
   con la herramienta de tu proveedor y comprueba los datos
   ([disaster-recovery.md](disaster-recovery.md#checklist)). Apunta cuánto tardó.
2. **Alertas y SLOs** acordados ([alerting.md](alerting.md)).
3. **La tabla de contactos** de [incident-response.md](incident-response.md), rellena.
4. **Legal** (fase 6): un abogado revisó los documentos de [privacy/](privacy/README.es.md); el
   contrato de encargo está firmado con cada cliente (o, para las aplicaciones de tu propia
   empresa, adoptado como política interna); cada aplicación conectada añadió a su aviso de
   privacidad los párrafos de [privacy-notice.es.md](privacy/privacy-notice.es.md); los usuarios de
   Audit Hub tienen el tuyo.
5. **Los resúmenes de los checkpoints** se guardan fuera de Audit Hub (0.1): copia el último (la
   página **Integrity**), o haz uno en el servidor de producción, en `/srv/app`:

   ```
   docker compose --env-file server.env --env-file release.env \
     run --rm -T api node dist/integrity/audit.cli.js checkpoint
   ```

   Imprime `Checkpoint <id>: <digest>`; guarda los dos, con la fecha, en el lugar que eligió 0.1.

6. **La retención** definida para cada aplicación cuyo contrato o ley pide más que los mínimos
   (página **Retention**; 0.1).
7. **Una aplicación de prueba conectada de punta a punta** (fase 9): su heartbeat en el
   **Overview**, un evento suyo en **Events**.
8. **Los canales de alertas probados.** El webhook de la aplicación: **Send a test** en su página
   ([manual 11.6](manual.es.md#116-audit-hub-avisos-de-alertas-y-geolocalización-por-ip)). Slack o
   Teams y los correos de alertas, con una alerta real: diez contraseñas equivocadas para una cuenta
   de la aplicación de prueba, en pocos minutos, generan `brute_force_account` (severidad high) en
   la siguiente pasada de las reglas (cada 5 minutos). Aparece en **Alerts**, en el canal de chat
   (severidad medium o más) y en el correo de los administradores (high o más).
9. **La aprobación de producción** en GitHub tiene al menos un revisor que no es el autor.

**Comprueba:** el bloque de firma (Sign-off) al final de production-readiness.md está relleno.

---

## Fase 12. El ciclo diario

Cada cambio, de la misma forma:

| Paso                   | Haz                                                                                                                                           | Comprueba                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1. Empieza             | `git switch main && git pull && pnpm install && pnpm db:migrate && pnpm dev`                                                                  | la app corre en local                   |
| 2. Rama                | `git switch -c feat/<descripción-corta>` (o `fix/…`, `chore/…`)                                                                               | `git branch` la muestra                 |
| 3. Cambia              | código y tests juntos ([how-to.md](how-to.md)); un cambio de esquema: `pnpm db:migrate --name <nombre>`; un cambio de la API: `pnpm contract` | la app hace lo que pide el issue        |
| 4. Verifica            | `pnpm verify` (y `pnpm test:integration` para cambios de la API, `pnpm test:e2e` para flujos de usuario)                                      | todo en verde                           |
| 5. Commit              | `git add -A && git commit -m "feat(<área>): <qué>"`                                                                                           | los hooks pasan                         |
| 6. Push y pull request | `git push -u origin HEAD && gh pr create --fill`                                                                                              | **CI passed** en verde                  |
| 7. Revisión            | un compañero revisa; responde a cada comentario                                                                                               | aprobado                                |
| 8. Merge               | **Squash and merge**                                                                                                                          | el pull request de release se actualiza |
| 9. Release             | mergea el pull request de release cuando quieras una versión                                                                                  | un tag `vX.Y.Z`                         |
| 10. Despliega          | Despliega el tag en staging, pruébalo, y después en producción (aprobación)                                                                   | smoke test en verde en los dos          |
| 11. Vigila             | Sentry y el monitor de uptime durante la hora siguiente                                                                                       | ningún error nuevo                      |

Si producción se comporta mal después de un despliegue: `./rollback.sh` en el servidor, y después
corrige hacia delante con un pull request nuevo ([deploy-vps.md](deploy-vps.md#roll-back)).

---

## Fase 13. El calendario de mantenimiento

| Cuándo                                   | Haz                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cada semana                              | Aprueba los pull requests de actualización de Dependabot: los patch y minor se mergean solos cuando el CI está en verde; las majors y las de workflows las mergeas a mano.                                                                                                                                |
| Cada semana                              | Lee los resultados del DAST (el workflow **DAST** se ejecuta los lunes).                                                                                                                                                                                                                                  |
| Cada mes                                 | En cada servidor: `docker image prune`, y `docker image rm` de las imágenes de release que no nombran `release.env` ni `release.previous.env` (docs/deploy-vps.md#keep-the-server-healthy); reinícialo si existe `/var/run/reboot-required`.                                                              |
| Cada mes                                 | Con geolocalización por IP: los ficheros nuevos de DB-IP en cada servidor ([deploy-vps.md](deploy-vps.md#ip-geolocation)).                                                                                                                                                                                |
| Según lo decidido en 0.1                 | Copia el resumen del último checkpoint (la página **Integrity**, o `audit.cli.js checkpoint` como en la fase 11) a su lugar fuera de Audit Hub.                                                                                                                                                           |
| Cada trimestre                           | Un simulacro de restore de la base de datos; revisa las alertas; comprueba la caducidad de `RELEASE_PLEASE_TOKEN`, si lo configuraste; lo que Dependabot nunca propone: una major LTS de Node.js (cada octubre), pnpm, las majors de PostgreSQL y Redis ([ci-cd.md](ci-cd.md#keeping-the-stack-current)). |
| Cuando un secreto puede haberse filtrado | Rótalo de inmediato ([security.md](security.md#secret-rotation)).                                                                                                                                                                                                                                         |
| Después de cada incidente                | Un postmortem breve; actualiza el runbook y las alertas.                                                                                                                                                                                                                                                  |

---

## Cuando algo no está en esta guía

| Situación                                                                         | Dónde                                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Un mensaje de error                                                               | [troubleshooting.md](troubleshooting.md) (busca unas palabras del mensaje)                                   |
| Cómo funciona algo                                                                | [manual.es.md](manual.es.md)                                                                                 |
| Un tipo de cambio (tabla, endpoint, pantalla, rol…)                               | [how-to.md](how-to.md)                                                                                       |
| El despliegue en el servidor, en detalle                                          | [deploy-vps.md](deploy-vps.md)                                                                               |
| Un incidente                                                                      | [incident-response.md](incident-response.md)                                                                 |
| Conectar una aplicación, su app móvil o su web                                    | [audit/connection-guide.es.md](audit/connection-guide.es.md)                                                 |
| Una solicitud de privacidad, alguien que deja el equipo, el fin de una aplicación | [manual 11.10](manual.es.md#1110-audit-hub-solicitudes-de-privacidad-sus-cuentas-y-el-fin-de-una-aplicación) |
| Los documentos legales                                                            | [privacy/README.es.md](privacy/README.es.md)                                                                 |
