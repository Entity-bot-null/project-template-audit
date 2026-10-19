# Conectar un proyecto a Audit Hub

English version: [connection-guide.md](connection-guide.md). Las dos versiones describen los mismos
pasos y comandos; un cambio en una se hace también en la otra, en el mismo pull request.

Cómo instalar el conector de NestJS (`packages/audit-nestjs`) en un proyecto creado desde
project-template-web, registrar sus flujos y ponerlo en marcha; el conector Expo
(`packages/audit-expo`) en su app móvil, creada desde project-template-app
([La app móvil](#la-app-móvil)), y el conector SPA (`packages/audit-web`) en su app web
([La app web](#la-app-web)). Cada conector se copia en el proyecto como código fuente (ADR 0009):
después de `add` es código del proyecto, cubierto por su propio lint, sus tipos, sus tests y su
cobertura. `.examples/web` y `.examples/app` (ADR 0010,
`pnpm examples generate --kind web|app`) son proyectos completos conectados así; sus cambios sobre
las plantillas están en `examples/<kind>/overlay.patch`.

## Contenido

- [Qué hace el conector](#qué-hace-el-conector)
- [Qué aplicaciones registrar](#qué-aplicaciones-registrar)
- [Instalar](#instalar)
- [Conectarlo](#conectarlo)
- [Variables](#variables)
- [Registrar eventos](#registrar-eventos)
- [Puntos de integración](#puntos-de-integración)
- [Tus propias acciones](#tus-propias-acciones)
- [Webhooks, "¿Fuiste tú?" y la actividad de la cuenta](#webhooks-fuiste-tú-y-la-actividad-de-la-cuenta)
- [Los datos de un usuario: borrado y bloqueo](#los-datos-de-un-usuario-borrado-y-bloqueo)
- [Acciones de respuesta](#acciones-de-respuesta)
- [Notificaciones push](#notificaciones-push)
- [Observabilidad](#observabilidad)
- [Tests](#tests)
- [Actualizar](#actualizar)
- [Apagarlo](#apagarlo)
- [La app móvil](#la-app-móvil)
- [La app web](#la-app-web)

## Qué hace el conector

- **Registra** cada evento de auditoría en la propia base de datos del proyecto, en la transacción
  del cambio que describe (una bandeja de salida transaccional, la tabla `audit_outbox`): un cambio
  que se revierte no registra nada; uno que se confirma siempre tiene su evento.
- **Reenvía** la cola a Audit Hub cada 2 segundos, una instancia a la vez, en lotes firmados y
  numerados sin huecos (`sourceSeq`, para que Audit Hub sepa cuándo falta uno). Un evento sale de
  la cola solo cuando Audit Hub respondió por él; una caída o un rechazo lo deja ahí, y el
  reenviador reintenta con esperas crecientes (el doble cada vez, hasta un minuto, mientras no hay
  conexión con Audit Hub; `Retry-After` en 429 y 503; 5 minutos después de unas credenciales
  rechazadas). Esperar a que pase una caída no cuenta como intento, así que toda la cola se vacía
  en cuanto Audit Hub vuelve; un lote en el que Audit Hub falla (un 500) espera por su cuenta, hasta
  una hora, y nunca detiene al resto.
- **Revisa cada evento** contra el contrato y el catálogo, incluso apagado: una llamada incorrecta
  hace fallar los tests del proyecto, no producción.
- **Convierte los correos en seudónimos** (HMAC con la clave propia de la aplicación) antes de que
  salgan del proyecto, y toma la dirección del cliente solo mediante `clientIp(req)`, así que decide
  `TRUST_PROXY`, nunca un encabezado leído directamente.
- **Agrega rutas:** `POST /api/audit/client-events` (los eventos propios de las apps, a través de la
  API), `POST /api/audit/webhooks` (los webhooks firmados de Audit Hub), `GET /api/account/activity`,
  `GET /api/account/security-prompts`, `POST /api/account/security-prompts/:id/answer`, y `PUT` y
  `DELETE /api/account/push-token` con el módulo de push (la seguridad de la cuenta, para la persona
  con sesión iniciada).
- **Reporta** su heartbeat al arrancar y después cada minuto (versión, catálogo, cola, los eventos
  que los teléfonos descartaron al cerrar sesión), y cuatro métricas.

Sin las variables, está apagado: no se encola nada, no arranca ningún worker, sus rutas responden
404 y el proyecto pasa todos los gates como antes.

## Qué aplicaciones registrar

Una aplicación en Audit Hub por backend y por entorno: el conector vive en la API, y una aplicación
es lo que tiene su clave.

| Tienes                                                                   | Aplicaciones en Audit Hub                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Una API con una app web y una app móvil encima                           | **Una.** Cada evento dice de qué cliente vino                                       |
| El mismo proyecto en producción y en staging                             | **Una para cada uno**, con sus propias claves: los datos de prueba nunca se mezclan |
| Dos backends, cada uno con su base de datos (una tienda, un back office) | **Una para cada uno**, con la correlación activada en los dos                       |

- **Las apps web y móvil nunca hablan con Audit Hub.** Hablan con su API, como siempre. Lo que el
  propio dispositivo tiene que decir (una sesión caducada, un script bloqueado, dónde está el
  teléfono, con consentimiento) va a `POST /api/audit/client-events` en esa API, que lo reenvía.
  Cada evento nombra su cliente (`web`, `ios`, `android`, la versión de la app, la instalación): el
  explorador filtra por él.
- **Un historial por persona.** Una persona que inicia sesión en la web y en la app es una cuenta de
  una aplicación, así que "dispositivo nuevo" y "viaje imposible" comparan todos sus dispositivos:
  se detecta un inicio de sesión en la web en la Ciudad de México y en la app en Madrid cinco
  minutos después. Dividida en dos aplicaciones, cada una vería la mitad.
- **Audit Hub nunca se conecta a la base de datos de un proyecto.** Necesitaría credenciales de cada
  una; no sabría quién actuó, desde dónde, ni que un inicio de sesión falló; y unos registros que la
  aplicación todavía puede cambiar no prueban nada. Lo que envió el conector queda sellado en Audit
  Hub, con los correos ya seudonimizados y los valores sensibles ocultos en el origen.
- **La correlación** (en los ajustes de la aplicación en Audit Hub) vincula lo que hace una
  dirección o una persona entre aplicaciones: un ataque a la tienda y al back office desde una misma
  dirección es una sola alerta. Actívala en las aplicaciones que comparten personas.

## Instalar

**Un proyecto creado desde la plantilla con sus parches ya trae el conector**, instalado y apagado:
`examples/web/template-patch/` (la plantilla web) y `examples/app/template-patch/` (la plantilla de
la app) son series de `git format-patch` que su dueño aplica a la plantilla
(`git am examples/<kind>/template-patch/*.patch`), y cada ejemplo generado las prueba (ADR 0010).
Ese proyecto se salta esta sección y la siguiente: define las [variables](#variables), y más
adelante mantiene el conector al día con [`update`](#actualizar).

Si no, desde un checkout de Audit Hub en un tag de release, con las dependencias del proyecto
instaladas:

```sh
pnpm connector add --target ../my-project
```

`add`:

- copia el conector a `apps/api/src/audit/` y el contrato sobre el que está construido a
  `apps/api/src/audit/contract/`, con sus specs;
- crea una sola vez los adaptadores propios del proyecto, que nunca se sobrescriben después:
  - `host.ts`: lo que el conector usa del proyecto (guards, decoradores, `clientIp`);
  - `audit.wiring.ts`: el store (Prisma), el transporte (`createExternalHttpClient`), el lock
    (`LockService`), y lo que hace el proyecto cuando Audit Hub se lo pide;
  - `app-catalog.ts`: las acciones propias del proyecto;
  - `audit.int.spec.ts`: el spec de integración de todo ello, contra la base de datos del proyecto
    y un Audit Hub propio en un puerto local;
- agrega los modelos del conector a `apps/api/prisma/schema.prisma` entre
  `// audit-connector:begin` y `// audit-connector:end`, y una línea en `model User` marcada
  `// audit-connector` (la relación que Prisma exige en los dos lados);
- escribe la migración (`prisma migrate diff`, sin necesidad de una base de datos). Sin las
  dependencias del proyecto instaladas, ejecuta `pnpm connector migration --target ../my-project`
  después de `pnpm install`;
- registra la versión y el SHA-256 de cada archivo en `audit-connector.json`, y una copia intacta de
  cada archivo en `.audit-connector/`, para `update`. Haz commit de los dos.

Imprime los pasos que faltan. Después, en el proyecto: `pnpm db:migrate`.

## Conectarlo

Cuatro ediciones, las mismas en todos los proyectos creados desde la plantilla:

1. `src/env/env.schema.ts`: agrega las variables del conector al schema (con spread) y valídalas
   juntas:

   ```ts
   import { AUDIT_ENV_SHAPE, checkAuditEnv } from '../audit/audit-env.js';

   export const EnvSchema = z
     .object({ ...theProjectsVariables, ...AUDIT_ENV_SHAPE })
     .superRefine((values, ctx) => {
       checkAuditEnv(values, ctx);
       // ...the project's own checks
     });
   ```

2. `src/app.module.ts`: `AuditModule.forRoot(auditConfigFromEnv(env))` en `imports`, después de
   `MailModule`. El módulo es global: cualquier servicio puede inyectar `AuditService`.
3. `src/openapi/openapi.spec.ts`: `/api/audit/webhooks` en las rutas públicas (Audit Hub la firma;
   no tiene usuario).
4. `apps/api/.env.example`: las variables de abajo, comentadas.

## Variables

Las cinco variables de conexión o ninguna; Audit Hub las muestra una sola vez, cuando se registra la
aplicación.

| Variable                            | Qué es                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `AUDIT_HUB_URL`                     | el origen de Audit Hub (`https://audit.example.com`, sin ruta); https en producción                                         |
| `AUDIT_HUB_APP`                     | el slug de la aplicación en Audit Hub                                                                                       |
| `AUDIT_HUB_KEY_ID`                  | el id de la clave de firma (un UUID)                                                                                        |
| `AUDIT_HUB_KEY_SECRET`              | el secreto de la clave de firma (base64url)                                                                                 |
| `AUDIT_HUB_PSEUDONYM_KEY`           | la clave que convierte los correos en seudónimos; la misma durante toda la vida de la aplicación                            |
| `AUDIT_HUB_WEBHOOK_SECRET`          | verifica los webhooks de Audit Hub; sin él, `/api/audit/webhooks` responde 404                                              |
| `AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS` | el anterior, durante una rotación                                                                                           |
| `AUDIT_HUB_RESPONSE_ACTIONS`        | las acciones de respuesta que ejecuta el proyecto, separadas por comas (`revoke_sessions`); requiere el secreto de webhooks |
| `AUDIT_HUB_QUEUE_ALERT`             | eventos en cola a partir de los cuales el log avisa que la cola se acumuló (por omisión 10000)                              |
| `AUDIT_HUB_PUSH`                    | `expo`: envía "¿Fuiste tú?" como push a los teléfonos del usuario (ver abajo); requiere el secreto de webhooks              |
| `AUDIT_HUB_EXPO_ACCESS_TOKEN`       | el access token de push de Expo, cuando el proyecto de Expo lo exige; requiere `AUDIT_HUB_PUSH`                             |

El conector reporta `APP_RELEASE` como la versión de su aplicación en el heartbeat. Cambiar
`AUDIT_HUB_PSEUDONYM_KEY` rompe el vínculo entre los eventos viejos y los nuevos de un mismo correo:
nunca la rotes salvo que los operadores de Audit Hub lo pidan.

## Registrar eventos

Inyecta `AuditService` y registra donde ocurre el cambio:

- **`record(tx, input)`**: en la transacción del cambio, después de la escritura. Se confirma con el
  cambio o no se guarda. Úsalo para todo lo que tiene éxito.
- **`recordAlone(input)`**: en una transacción propia, para lo que ocurre fuera de una: un inicio de
  sesión rechazado, una contraseña incorrecta. Llámalo antes de lanzar el error. Nunca lanza por la
  base de datos (el 401 o el 403 de quien llama no debe convertirse en un 500; la falla queda en el
  log), solo por un evento inválido.
- **`recordSampled(input, req)`**: `recordAlone` para lo que cualquiera puede provocar a voluntad,
  tantas veces como quiera (una solicitud de otro origen rechazada, un rate limit): solo el primero
  por acción, dirección y ruta cada minuto, y como máximo 100 por minuto por instancia.
- **`change(action, before, after)`**: el `change` de un evento: los campos que declara la acción,
  de la fila tal como se leyó en la transacción antes de la escritura, y después de ella. Los campos
  sensibles llegan como `[REDACTED]`, pero cuentan como cambiados.
- **`emailPseudonym(email)`**: un correo tal como lo conoce Audit Hub, para un `change` sobre
  correos.

La solicitud (dirección, agente de usuario, ruta, método, id de la solicitud, id de traza, el usuario
con sesión iniciada) sale del ámbito de la solicitud: un interceptor lo define para cada handler. Un
guard corre antes que los interceptores: pásale `req`.

```ts
await this.prisma.$transaction(async (tx) => {
  const before = await tx.user.findUniqueOrThrow({ where: { id }, select: { role: true } });
  const after = await tx.user.update({ where: { id }, data: { role }, select: { role: true } });
  await this.audit.record(tx, {
    action: 'iam.user.role_changed',
    resource: { type: 'user', id },
    change: this.audit.change('iam.user.role_changed', before, after),
  });
});
```

Una entrada tiene `action` (del catálogo) y, opcionalmente, `outcome` (por omisión `success`),
`severity` (por omisión: la del catálogo), `reason` (un código: `invalid_credentials`), `actor` (por
omisión: el usuario de la solicitud, si no, anónimo), `resource`, `change`, `details` (solo los
campos del catálogo) y `status`. Un actor con `email` recibe su seudónimo, nunca la dirección. Da el
`name` de una persona (`actor: { type: 'user', id, role, email, name }`) y será su etiqueta en
Audit Hub, el nombre que muestra su explorador; sin él, la etiqueta es el correo enmascarado
(`a***@e***.com`). Una cuenta con un teléfono vinculado (opcional: muchas solo tienen correo)
puede dar su `phone`: de la aplicación solo salen sus últimos cuatro dígitos (`•••• 1234`,
`maskPhone`). Las client hints de cada solicitud acompañan a sus eventos por sí solas (la marca
real del navegador, la versión del sistema, el modelo de un teléfono: las envían los navegadores
Chromium; las completas cuando el servidor web del proyecto las pide con `Accept-CH:
Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model`, el
`ACCEPT_CLIENT_HINTS` del contrato). Nunca pongas un secreto, un token ni una contraseña en un
evento; no se acepta nada fuera de los campos declarados.

## Puntos de integración

Dónde registra `.examples/web` los flujos de la plantilla (catálogo base,
`catalog/base-catalog.ts`). `AuditService` es el último parámetro del constructor de cada servicio.

| Archivo                                 | Evento                                                                                                 | Cómo                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `auth/auth.service.ts`                  | `auth.session.sign_in_failed`                                                                          | `recordAlone` antes del 401, también para una dirección desconocida (actor anónimo con su correo)                      |
|                                         | `auth.session.signed_in` (método `password`)                                                           | en la transacción de la sesión: `sessions.create(userId, hash, onCreated)`                                             |
| `auth/sessions.service.ts`              | `auth.session.reuse_detected`, `auth.session.signed_out`, `auth.session.revoked_all`                   | en las transacciones de la rotación, del retiro y de `revokeAll`                                                       |
| `auth/password-reset.service.ts`        | `auth.password_reset.requested`, `auth.password_reset.completed`                                       | en sus transacciones; requested también para una dirección desconocida                                                 |
| `auth/sign-up.service.ts`               | `auth.sign_up.requested`, `.confirmed`, `.confirm_failed`; `auth.session.signed_in` (método `sign_up`) | requested se revierte junto con un mensaje retenido                                                                    |
| `invitations/invitations.service.ts`    | `iam.invitation.created`, `.revoked`, `.accepted`; `auth.session.signed_in` (método `invitation`)      | `revoke` corre en una transacción para ello                                                                            |
| `users/users.service.ts`                | `iam.users.listed`, `iam.user.viewed`                                                                  | `recordAlone`; viewed solo para el registro de otra persona                                                            |
| `users/create-user.cli.ts`              | `iam.user.created`                                                                                     | la cuenta y su evento en una sola transacción; actor `system`                                                          |
| `account/account.service.ts`            | `auth.password.change_failed`, `auth.password.changed`                                                 | failed antes del 403                                                                                                   |
| `account/email-change.service.ts`       | `account.email.change_requested`, `.changed`, `.reverted`, `.change_failed`                            | el cambio como seudónimos: `{ emailHmac: audit.emailPseudonym(address) }`                                              |
| `common/guards/fetch-metadata.guard.ts` | `http.request.cross_origin_refused`                                                                    | `recordSampled(input, req)`; `canActivate` se vuelve async                                                             |
| `common/guards/rate-limit.guard.ts`     | `http.request.rate_limited`                                                                            | `recordSampled` en `throwThrottlingException`; se inyecta con `forwardRef` (un ciclo de imports a través de `host.ts`) |

Los parches de la plantilla agregan los flujos que nombra el resto del catálogo base, y los
registran:

| Archivo                      | Evento                                                           | Cómo                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users/users.service.ts`     | `iam.user.role_changed`, `iam.user.disabled`, `iam.user.enabled` | en la transacción de `update` (`PATCH /api/users/:id`); el rol como cambio (`audit.change`)                                                      |
|                              | `auth.password.change_required`                                  | en la de `requirePasswordChange` (`POST /api/users/:id/require-password-change`)                                                                 |
|                              | `account.user.deleted`                                           | en la de `remove` (`DELETE /api/users/:id`), después de la fila: Audit Hub borra los datos del titular cuando lo recibe                          |
| `account/account.service.ts` | `account.user.deleted`                                           | en la de `deleteAccount` (`POST /api/account/deletion`), la de la propia persona                                                                 |
| `auth/auth.service.ts`       | `auth.session.sign_in_failed`, resultado `denied`                | la contraseña correcta de una cuenta desactivada (`account_disabled`) o de una que debe elegir una contraseña nueva (`password_change_required`) |

Un proyecto sin esos flujos registra estos eventos donde los agregue.

## Tus propias acciones

`app-catalog.ts` contiene las acciones del proyecto, junto al catálogo base:

```ts
export const APP_ACTIONS = {
  'billing.invoice.paid': {
    category: 'audit',
    severity: 'info',
    description: 'An invoice was paid.',
    source: 'server',
    resourceType: 'invoice',
    details: { fields: { amountCents: { type: 'integer', min: 0 } } },
  },
} satisfies Record<string, ActionSpec>;
```

- **Nombre:** `domain.entity.verb`, en minúsculas; los nombres del catálogo base ya están tomados.
- **`category`:** `security`, `audit`, `access` o `system`; define la retención mínima (730, 365,
  180, 30 días). Una acción nunca pasa a una categoría que se conserva menos tiempo.
- **`source`:** `server`; `client` o `both` para los eventos de las apps (llegan por
  `/api/audit/client-events`).
- **`tags`:** lo que entienden las reglas de detección de Audit Hub (`auth.sign_in_failed`,
  `data.bulk_export`...: `TAGS` en el contrato).
- **`userVisible`:** se muestra en "My account's security".
- **Campos** (`details`, `change`): un tipo (`string`, `integer`, `number`, `boolean`, `enum`,
  `uuid`, `datetime`, `id`, `ip`, `country`, `string[]`) y sus límites; `required`; `personal` (se
  guarda aparte, con una retención más corta, y se borra a petición); `sensitive` (siempre
  `[REDACTED]`).

La versión del catálogo es un hash del propio catálogo, no la release del proyecto: cambia cuando
cambia una acción. El reenviador la publica antes de los primeros eventos, y de nuevo si Audit Hub
no la conoce.

## Webhooks, "¿Fuiste tú?" y la actividad de la cuenta

Con `AUDIT_HUB_WEBHOOK_SECRET`, Audit Hub envía webhooks firmados a `/api/audit/webhooks`
(verificados sobre el cuerpo y la ruta, dentro de cinco minutos; cada entrega se atiende una sola
vez):

- `security.sign_in_suspicious`: guarda una pregunta "¿Fuiste tú?" para el usuario (7 días).
  `GET /api/account/security-prompts` lista las abiertas; responder `not_me` ejecuta
  `handlers.onNotMe` (en `audit.wiring.ts`: se terminan todas las sesiones y sube
  `securityVersion`) y registra `account.security_prompt.answered`.
- `alert.created`: `handlers.onAlert`, cuando el proyecto define uno.
- `response_action.requested`: ver abajo.

`GET /api/account/activity` pide a Audit Hub los eventos de la propia persona con sesión iniciada
que son visibles para ella, sin direcciones; responde 503 mientras no hay conexión con Audit Hub.

## Los datos de un usuario: borrado y bloqueo

Audit Hub guarda los eventos del proyecto como su encargado: cuando un usuario ejerce sus derechos,
el proyecto se lo comunica ([docs/privacy/](../privacy/README.es.md) tiene el procedimiento
completo).

- **Una cuenta eliminada:** registra `account.user.deleted` con el usuario como recurso (los parches
  de la plantilla lo hacen, en `UsersService.remove` y `AccountService.deleteAccount`). Cuando Audit
  Hub lo recibe, borra los datos personales del usuario (`personal`, abajo), pase lo que pase.
- **Un borrado solicitado** (una solicitud de cancelación, el fin de un periodo de bloqueo): inyecta
  `AuditErasureService` y llama a `erase(userId, scope)`:
  - `'personal'` (por omisión) borra los datos personales de los eventos del usuario (direcciones,
    dispositivos, etiquetas, lugares); los eventos se quedan, seudónimos, hasta su retención;
  - `'events'`, una vez que el proyecto canceló los datos de la persona, borra también sus eventos:
    los sellados al momento (`eventsDeleted`), el resto en un día, una vez sellados
    (`eventsPending`).

  Responde lo que se borró (`personalDeleted`, `locationDeleted`, `held`: lo que conserva una
  retención legal), `null` mientras el conector está apagado, y 503 mientras no hay conexión con
  Audit Hub o este lo rechaza: vuelve a pedirlo. La solicitud se firma con la clave de la
  aplicación: `POST /api/connector/subjects/:subject/erasure` con
  `{ "scope": "personal" | "events" }` (sin cuerpo: `personal`).

- **Bloqueo:** después de un borrado, Audit Hub conserva lo que queda de los eventos ocurridos hasta
  ese momento, pero nunca responde nada de ellos para esa persona: `GET /api/account/activity` (y la
  exportación del derecho de acceso) los dejan fuera (para una cuenta eliminada, una página vacía),
  y su propio explorador los deja fuera de las vistas por persona. Lo que el usuario hace después,
  cuando la cuenta se conserva, son datos nuevos y se muestra como siempre; un evento anterior que
  llega más tarde a Audit Hub (esperaba en la cola) pierde ahí sus datos personales. Una retención
  legal activa que nombre al usuario levanta el bloqueo mientras dura.
- **El fin del servicio de la aplicación:** un administrador de Audit Hub suspende la aplicación y
  después borra todo su registro de auditoría
  ([manual](../manual.es.md#1110-audit-hub-solicitudes-de-privacidad-sus-cuentas-y-el-fin-de-una-aplicación));
  desde entonces la aplicación queda retirada y sus claves ya no existen: quita las variables
  `AUDIT_HUB_*` ([Apagarlo](#apagarlo)).

## Acciones de respuesta

Audit Hub puede pedir al proyecto que actúe sobre uno de sus usuarios (ADR 0013). El proyecto
ejecuta una acción solo cuando está en `AUDIT_HUB_RESPONSE_ACTIONS` **y** tiene un manejador en
`audit.wiring.ts`; a cualquier otra se le responde `unsupported`. Cada manejador corre en la
transacción del webhook, y su resultado se registra ahí (`audit.response_action.executed`):

```ts
const handlers: AuditHandlers = {
  responseActions: {
    revoke_sessions: endSessions, // (tx, userId) => 'succeeded' | 'failed' | 'refused'
    require_password_change: requirePasswordChange,
    disable_account: disableAccount,
  },
  onNotMe: async (tx, userId) => {
    await endSessions(tx, userId);
  },
};
```

- **Un proyecto con los parches de la plantilla** tiene las tres, como arriba: cada una hace lo que
  hace ahí un administrador, con las mismas reglas (`endSessionsLocked`;
  `users.password_change_required_at`; `users.disabled_at`, rechazada para el último administrador
  que puede iniciar sesión, bajo los locks de los administradores).
- **El adaptador que crea `pnpm connector add`** tiene solo `revoke_sessions`, que cualquier
  proyecto de la plantilla puede ejecutar: agrega las otras dos cuando el proyecto tenga sus flujos
  (una cuenta desactivada que rechazan el inicio de sesión, la renovación de la sesión y el guard;
  una contraseña nueva exigida en el siguiente inicio de sesión).

## Notificaciones push

Con `AUDIT_HUB_PUSH=expo`, una pregunta "¿Fuiste tú?" llega a los teléfonos del usuario como
notificación push, a través del servicio de push de Expo (ADR 0013). Sin ella, la pregunta aparece
de todos modos en la app la próxima vez que se abre.

- **La app registra cada teléfono.** Después de un inicio de sesión, la app móvil envía su token de
  push de Expo a `PUT /api/account/push-token` (`{ token, platform }`, `ios` o `android`); al cerrar
  sesión lo quita con `DELETE /api/account/push-token`, para que la siguiente persona que inicie
  sesión en ese teléfono no reciba nada de la anterior. Un token pertenece a una sola cuenta a la
  vez: registrarlo para otra lo mueve. Las dos rutas responden 204, y 404 mientras el módulo está
  apagado.
- **El push lleva solo la pantalla que abre.** Sus datos son `{ url: "/security/prompts/<id>" }`, en
  el canal de Android `security`; el usuario responde en la app, con sesión iniciada, nunca desde la
  notificación. Su texto está en inglés por omisión; `handlers.promptPush(prompt)` en
  `audit.wiring.ts` lo dice con las palabras del proyecto (`{ title, body }`).
- **Tokens olvidados.** Se borra un token para el que el servicio de Expo responde
  `DeviceNotRegistered` (la app se desinstaló). Un push que falla queda en el log y nunca hace
  fallar el webhook: la pregunta se guarda de todos modos. `handlers.onSecurityPrompt` corre después
  de ambos.
- **Los tokens son datos personales de la cuenta:** tabla `audit_push_tokens`, se borran con el
  usuario.

El emisor está en `audit.wiring.ts` (`expoPushSender`, el `createExternalHttpClient` del proyecto con
un timeout), así que las reglas de salida del proyecto aplican a `exp.host`.

## Observabilidad

Las métricas del conector, sobre el OpenTelemetry del proyecto:

| Serie de Prometheus                          | Qué                                                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_audit_outbox_waiting`                   | eventos en la cola                                                                                                                                                               |
| `app_audit_outbox_oldest_age_seconds`        | la antigüedad del más viejo                                                                                                                                                      |
| `app_audit_events_total{outcome}`            | eventos por los que Audit Hub respondió: `accepted`, `duplicate`, `rejected`, `retry`                                                                                            |
| `app_audit_hub_requests_total{kind,outcome}` | solicitudes a Audit Hub por tipo (`events`, `catalog`, `heartbeat`, `activity`, `erasure`) y resultado (`ok`, `rate_limited`, `unavailable`, `refused`, `failed`, `unreachable`) |

En un proyecto de la plantilla, `.examples/web` muestra cada paso:

1. `observability/api-metrics.json`: las cuatro series.
2. `apps/api/src/observability/metrics-catalog.spec.ts`: registra cada una una vez
   (`recordEvents`, `recordHubRequest`, `observeQueue`).
3. `observability/prometheus/rules/api-alerts.yaml`: `ApiAuditBacklog` (el evento más viejo con más
   de 15 minutos, durante 10), `ApiAuditRejections` (eventos que Audit Hub rechazó uno por uno, que
   nunca le llegan) y `ApiAuditHubRefused` (credenciales rechazadas durante 10 minutos), con sus
   tests en `observability/prometheus/tests/api-alerts.test.yaml`.
4. `docs/incident-response.md`: el runbook "Audit Hub connector behind".

## Tests

- Los specs unitarios del conector vienen con él y corren en la suite del proyecto. Solo usan
  `describe`, `it`, `expect` y los dobles de `audit.testing.ts` (`MemoryStore`, `FakeTransport`,
  `TEST_CONFIG`).
- Un spec que construye uno de los servicios del proyecto le pasa un `AuditService` real:

  ```ts
  const store = new MemoryStore();
  const service = new UsersService(prisma, new AuditService(TEST_CONFIG, store, () => NOW));
  // ...
  expect(store.rows.map((row) => row.draft.action)).toEqual(['iam.users.listed']);
  ```

- `audit.int.spec.ts` corre con la suite de integración del proyecto: un cambio revertido no envía
  nada, una caída no pierde ni duplica nada, un `X-Forwarded-For` falsificado no cambia nada, los
  webhooks y las preguntas funcionan de punta a punta, y sin variables todas las rutas responden 404.
- Los umbrales de cobertura del proyecto se quedan como están. `audit.wiring.ts`, como el resto del
  wiring del proyecto, lo cubre el spec de integración.

## Actualizar

```sh
pnpm connector status --target ../my-project   # versiones instalada y disponible, ediciones locales
pnpm connector diff   --target ../my-project   # lo que cambiaría update
pnpm connector update --target ../my-project
```

`update` reemplaza cada archivo que el proyecto no tocó y fusiona cada archivo que editó
(`git merge-file` contra la copia intacta), y deja marcadores de conflicto donde cambiaron los dos
lados. Nunca toca los adaptadores; `status` dice cuándo cambiaron sus plantillas, para que el
proyecto compare a mano (el siguiente `update` registra las plantillas con las que ahora se
comparan). `pnpm connector status --check` en la CI del proyecto falla con ediciones sin explicar.

Una versión que cambia las tablas del conector también actualiza sus modelos en `schema.prisma` y
escribe la migración del cambio (`<stamp>_update_audit_connector`), con el SQL que Prisma no puede
expresar (checks, de `prisma/sql/<version>.sql`) para cada versión intermedia. Necesita las
dependencias del proyecto instaladas: sin ellas no cambia nada y lo dice. Aplica la migración con
`pnpm db:migrate`.

## Apagarlo

Quita las variables `AUDIT_HUB_*` y vuelve a desplegar: desde entonces no se encola nada; los eventos
que ya estaban en la cola se quedan en `audit_outbox` hasta que se vuelva a encender. Para siempre
(el servicio de la aplicación terminó en Audit Hub,
[arriba](#los-datos-de-un-usuario-borrado-y-bloqueo)), vacía también esa cola: sus eventos nunca se
volverían a aceptar.

## La app móvil

La app nunca habla con Audit Hub: habla con su API, que tiene el conector de NestJS. El conector
Expo (`packages/audit-expo`, instalado en `src/lib/audit/`) le da a la app su parte:

- **Los eventos propios del dispositivo**, los que solo conoce el teléfono, registrados con
  `audit.record()`: una sesión que empezó (`client.session.started`, después de un inicio de sesión
  o cuando la app abre con la sesión que guardó, con la posición aproximada del teléfono cuando el
  usuario dio su consentimiento), una sesión que terminó el servidor (`client.session.expired`) y un
  enlace que la app rechazó (`client.link.rejected`). El catálogo base de la API los declara; las
  acciones de cliente propias de un proyecto van en su `app-catalog.ts` con `source: 'client'`.
- **Sin conexión, por usuario.** Los eventos esperan en su propio archivo SQLite y van a
  `POST /api/audit/client-events` cuando vuelve la red, cuando la app regresa al primer plano o cada
  30 segundos, como máximo 50 por solicitud. Las fallas de red, los timeouts, los 5xx y los 429 se
  reintentan; los demás 4xx descartan el lote. Al cerrar sesión la cola se envía durante hasta tres
  segundos y después se descarta: nunca se envía con la sesión del siguiente usuario, y el siguiente
  lote dice cuántos se descartaron (`discardedAtSignOut`, en el heartbeat de la API).
- **Cada solicitud dice qué app la envió**: `X-App-Version`, `X-App-Build`, `X-App-Platform` y
  `X-Device-Id` (un id aleatorio de la instalación). El conector de la API los pone en sus propios
  eventos, así que un inicio de sesión desde una instalación que la cuenta nunca usó es "dispositivo
  nuevo".
- **La seguridad de la cuenta**, para las pantallas de la app: `useAccountActivity`,
  `useSecurityPrompts`, `useSecurityPrompt` y `useAnswerSecurityPrompt` (TanStack Query, sin UI
  propia).
- **"¿Fuiste tú?" como push**, con el módulo de push de la API (`AUDIT_HUB_PUSH=expo`): la app envía
  su token de push de Expo después de cada inicio de sesión y lo quita al cerrar sesión.

### Instalarlo

Desde un checkout de Audit Hub en un tag de release:

```sh
pnpm connector add --kind expo --target ../my-app
```

`add` copia el conector a `src/lib/audit/` con sus specs, y la parte del contrato que usa a
`src/lib/audit/contract/` con los suyos: la cobertura de la app cuenta cada archivo bajo `src/`, así
que no recibe ningún módulo que no importe. Los specs usan solo `describe`, `it`, `expect` y fakes
inyectados: los mismos archivos corren con Vitest en Audit Hub y con Jest en la app; ahí el SQL de
la cola corre sobre el SQLite propio de Node. Crea los adaptadores una sola vez:

| Adaptador                         | Qué es                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/audit.ts`                | las rutas de la API a través del cliente `api` de la app: el token de la sesión, el timeout, el id de la solicitud                |
| `src/lib/storage/auditQueue.ts`   | el archivo SQLite propio de la cola, `audit-queue.db`, y el id de la instalación en `persistentStorage`                           |
| `src/lib/audit/audit.wiring.ts`   | el cliente sobre los módulos de Expo, los hooks, `signOut()`, `pushTokenRegistrar`, `registerPushToken()`, `recordRejectedLink()` |
| `src/lib/audit/audit.int.spec.ts` | el spec de integración de todo ello, contra la API simulada de la app                                                             |

### Conectarlo

Las ediciones, las mismas en todas las apps de la plantilla; `.examples/app` hace cada una:

1. `pnpm expo install expo-crypto`: un módulo nativo, así que el siguiente build para las tiendas lo
   incluye.
2. `openapi/openapi.json`: el contrato propio de la API, con las rutas que agrega su conector;
   después `pnpm contract`.
3. `src/lib/storage/index.ts`: `auditInstallation: 'audit.installation'` en `STORAGE_KEYS`.
4. `src/api/http.ts` y `src/api/client.ts`: una opción `headers` en `createHttp`, que se lee antes de
   la verificación de cancelación, y `setRequestHeaders()` para los dos clientes (el inicio de sesión
   es público, y es donde aparece un dispositivo nuevo). Ids de solicitud con `getRandomValues` de
   `expo-crypto`.
5. `src/app/_layout.tsx`: `useEffect(() => audit.start(), [])`; `audit.bindUser(user.id)` en
   `session.onSignIn`; `audit.sessionEnded(useSessionStore.getState().endedBy)` en
   `session.onSignOut`.
6. `src/app/(app)/_layout.tsx`: `audit.bindUser(id)` y `registerPushToken()` en cuanto `useMe`
   conoce al usuario (una sesión restaurada); `useNotificationNavigation(recordRejectedLink)`;
   `usePushTokenChanges(...)` para registrar de nuevo un token reemplazado.
7. Cierra sesión con `signOut()` del wiring: la cola y el token de push se van mientras la sesión
   sigue siendo válida (`session.signOut()` borra el token antes de llamar a sus listeners).
8. `src/app/+native-intent.tsx`: `recordRejectedLink()` para un enlace que la lista de permitidos
   rechaza.
9. `src/lib/links.ts`: `/security/prompts/<uuid>` en la lista de permitidos, con su prefijo de App
   Links; la pantalla pregunta, el enlace nunca responde.
10. `src/lib/notifications`: el canal de Android `security` en `configureNotifications()`, con
    importancia alta: la API envía los push por él.
11. `src/test/setup.ts`: `expo-crypto` y `expo-sqlite` (el SQLite de Node, en memoria), y el
    transporte falso del conector para `@/api/audit`, para que los specs propios de la app no
    necesiten rutas de auditoría.
12. Las pantallas: la pregunta (`/security/prompts/[id]`) y la actividad de la cuenta, cada una en
    `src/a11y.spec.tsx`; el inventario de datos de `SECURITY.md` y los formularios de las tiendas.

### Ubicación (opcional)

El viaje imposible necesita saber dónde está el teléfono. Con `expo-location`
(`pnpm expo install expo-location`), solo para las alertas de inicio de sesión:

- un consentimiento propio en las preferencias (`locationConsent`, por omisión `unknown`), que se
  activa en Settings y entonces pide el permiso de primer plano: el diálogo del sistema deja
  elegir a la persona entre precisa y aproximada (Android 12+, iOS 14+);
- `app.config.ts`: el plugin solo con `locationWhenInUsePermission`, `android.blockedPermissions`
  con `ACCESS_BACKGROUND_LOCATION`, e `ios.infoPlist.NSLocationDefaultAccuracyReduced: false`;
- en el wiring, `location: { provider: { lastKnown, current }, consented, precise }`:
  `lastKnown` lee la posición que el sistema ya conoce (`getLastKnownPositionAsync`, nunca el
  GPS); `precise` lee el permiso (`android.accuracy === 'fine'` o `ios.accuracy === 'full'`);
  `current` toma una posición fresca (`getCurrentPositionAsync` con `Accuracy.High`, 10 segundos
  como máximo), solo cuando se permite la precisa.

El conector (0.2.0 o posterior) la envía solo con `client.session.started`. Aproximada: la última
posición conocida, redondeada a 0.01° en el dispositivo. Precisa: la posición fresca, a cinco
decimales (cerca de un metro), con la precisión con la que se midió. Audit Hub vuelve a redondear
con la misma regla (una posición medida peor que 1 km es aproximada) y conserva las ubicaciones de
los dispositivos 30 días. El inventario de datos y los formularios de las tiendas dicen cuál pide
la app (`.examples/app`: las dos, a elección de la persona).

### Del lado de la API

- El catálogo: el catálogo base declara las tres acciones de cliente; la API rechaza cualquier otra
  acción del dispositivo (`action_not_allowed`) salvo que el proyecto la declare con
  `source: 'client'` o `'both'`.
- Push: `AUDIT_HUB_PUSH=expo` (y `AUDIT_HUB_EXPO_ACCESS_TOKEN` cuando el proyecto de Expo lo exige),
  ver [Notificaciones push](#notificaciones-push).
- Una aplicación en Audit Hub para la API y todos sus clientes
  ([Qué aplicaciones registrar](#qué-aplicaciones-registrar)).

`pnpm connector update --target ../my-app` funciona como para la API: las tablas de la cola cambian
solo con las migraciones propias del conector (`PRAGMA user_version`), que corren cuando la app abre
la cola.

## La app web

La SPA tampoco habla nunca con Audit Hub. El conector SPA (`packages/audit-web`) reporta lo que solo
ve la página, a través de la propia API de la app:

- `client.security.csp_violation`: el navegador bloqueó algo que la Content Security Policy prohíbe
  (la directiva, y el origen de lo bloqueado o su palabra clave de CSP: nunca una ruta ni una
  query), una vez por página para cada uno;
- `client.navigation.return_path_rejected`: `returnPath()` rechazó un intento de redirección
  abierta (nunca el valor);
- `client.session.expired`: el servidor terminó la sesión de la página; se envía si la misma persona
  vuelve a iniciar sesión en esa página.

No cuesta nada hasta que el conector de la API está encendido: un búfer de como máximo 20 eventos en
el bundle inicial (`src/audit/report.ts`, unos cientos de bytes), y el reporter en un chunk lazy que
`src/main.tsx` carga después del primer render solo cuando `GET /api/auth/capabilities` dice
`auditClientEvents`. El reporter guarda los eventos en memoria, por usuario, y los envía cada 30
segundos y cuando la página se oculta (`keepalive`, puede estar cerrándose): nunca los eventos de una
persona con la sesión de otra. La página de la cuenta lista la actividad propia de la persona.

```sh
pnpm connector add --kind spa --target ../my-project/apps/web
```

Se instala en el propio directorio de la app web, con un manifiesto propio (la raíz del proyecto
tiene el de la API): el reporter en `src/audit/` con sus specs, la parte del contrato que usa en
`src/audit/contract/`, y el adaptador `src/audit/audit.wiring.ts` (el cliente `api` y la sesión de
la app) con su spec. Después, como hace `.examples/web`:

1. `pnpm add -D zod` en la app web: los tipos y los specs del contrato. El bundle no recibe nada de
   eso: el reporter solo importa tipos y el módulo UUIDv7 (`connector.test.mjs` lo comprueba).
2. La API: `auditClientEvents: this.audit.enabled` en sus capabilities (`AuthCapabilitiesSchema` y
   `AuthController`); `pnpm contract`.
3. `src/auth/capabilities.ts`: el campo nuevo, y `loadCapabilities()` exportado para
   `src/main.tsx`, que importa `./audit/audit.wiring` y llama a `startAudit()`.
4. `reportAudit()` en `src/auth/return-path.ts` (una ruta rechazada, una vez por cada navegación: el
   guard la lee en cada render) y en `src/auth/session.ts` (una renovación de la sesión que el
   servidor rechazó, con el id del usuario, antes de que se borre la sesión).
5. `src/pages/AccountPage.tsx`: "Recent activity" a partir de `GET /api/account/activity`, con la
   atribución de la base de datos de geolocalización cuando la respuesta trae una.
6. `performance-budget.json`: medido en `.examples/web`, el conector agrega 1.7 kB al total y nada
   al JavaScript inicial (el chunk del reporter 1.3 kB, la actividad 0.4 kB). El ejemplo le da al
   reporter un presupuesto propio y sube el total 1 kB, con el motivo.
