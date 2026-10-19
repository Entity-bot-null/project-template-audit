# Procedimiento ARCO con Audit Hub

English version: [arco-procedure.md](arco-procedure.md).

> **Borrador para revisión legal.** Plantilla, no es asesoría legal. Debe revisarla un abogado
> antes de usarse. Última revisión contra la ley: 2026-10-17.

El procedimiento que sigue el departamento de datos personales del responsable cuando un usuario
de una aplicación conectada ejerce su derecho de acceso, rectificación, cancelación u oposición
(ARCO), y qué hacer en Audit Hub en cada caso. El departamento es el que el responsable designa
para tramitar las solicitudes (LFPDPPP art. 29): [Nombre del departamento].

## Quién hace qué

| Quién                                        | Qué hace                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El departamento de datos personales          | Recibe, registra y resuelve cada solicitud; responde al titular; lleva el registro                                                                                                                                                                                           |
| La aplicación (su equipo)                    | Acredita la identidad del solicitante, localiza su identificador de usuario, consulta la API de Audit Hub y borra o corrige los datos de perfil en la aplicación                                                                                                             |
| El operador de Audit Hub (persona encargada) | Ejecuta lo que la aplicación no puede ejecutar por sí misma (un borrado desde las páginas de administración, una retención legal), en el plazo del contrato ([processor-contract.es.md](processor-contract.es.md#10-apoyo-en-el-ejercicio-de-los-derechos-de-los-titulares)) |

**Audit Hub nunca ve a los solicitantes.** Solo conoce a una persona por el identificador de
usuario de la aplicación (`:subject` en sus rutas) y solo responde a las solicitudes firmadas de la
aplicación y a sus propios administradores
([contract.md](../design/audit-hub/contract.md#query-api-for-applications-audit-hub-signed)). Una
solicitud enviada al operador se reenvía al departamento; el operador no la responde.

## Pasos

1. Recibir la solicitud por un medio del aviso de privacidad (LFPDPPP art. 15 fr. V).
2. Registrarla con la fecha de recepción (registro al final).
3. Revisar que contenga lo que exige el art. 28 de la LFPDPPP; si falta algo, pedirlo una sola vez.
4. Acreditar la identidad del titular o de su representante, por medio de la aplicación.
5. Localizar el identificador de usuario en la aplicación.
6. Resolver y comunicar la respuesta dentro del plazo.
7. Hacer efectiva la respuesta, en la aplicación y en Audit Hub.
8. Avisar al titular que se hizo efectiva y cerrar el registro.

## 1. Recibir

- **Medios:** los del aviso de privacidad: [Correo del departamento de datos personales], [Otro
  medio]. Deben ser gratuitos; un servicio con costo no puede ser el único medio para presentar una
  solicitud (LFPDPPP art. 34; Reglamento art. 93).
- **Contenido** (LFPDPPP art. 28): I. nombre y domicilio u otro medio para comunicarle la
  respuesta; II. documentos que acrediten la identidad o la representación; III. descripción clara
  de los datos, salvo en el acceso; IV. el derecho que ejerce; V. cualquier elemento que facilite
  localizar los datos. En la rectificación, además, las modificaciones y los documentos que las
  sustenten (LFPDPPP art. 30).
- **Información faltante:** se pide una sola vez, dentro de los 5 días hábiles siguientes; el
  titular tiene 10 días hábiles para responder o la solicitud se tiene por no presentada; el plazo
  corre de nuevo al día siguiente de la respuesta (Reglamento art. 96, vigencia no confirmada).
- **Costo:** gratuito; solo pueden cobrarse reproducción, copias o envío, y es gratis si el titular
  aporta el medio. Una solicitud repetida dentro de 12 meses puede costar hasta tres UMA, salvo que
  el aviso haya cambiado sustancialmente (LFPDPPP art. 34).

## 2. Acreditar la identidad

Le corresponde a la aplicación: Audit Hub no puede hacerlo.

- Se acepta una identificación oficial, un medio electrónico con el que la aplicación ya
  autentica al usuario o la firma electrónica avanzada; el representante presenta instrumento
  público o carta poder firmada ante dos testigos (Reglamento art. 89, vigencia no confirmada).
- Para un usuario con sesión iniciada puede servir la autenticación de la propia aplicación:
  [Criterios que acepta el departamento].
- El acceso se entrega solo después de acreditar la identidad (LFPDPPP art. 31).
- Después, localice el **identificador de usuario** en la aplicación: es el `:subject` de las rutas
  de Audit Hub
  ([contract.md](../design/audit-hub/contract.md#query-api-for-applications-audit-hub-signed)). Si
  la persona no tiene cuenta, Audit Hub guarda a lo más un seudónimo con llave del correo que usó
  ([connection-guide.md](../audit/connection-guide.md#integration-points)); el explorador de Audit
  Hub puede filtrar por un correo o una IP, y una exportación solo conserva ese filtro como
  `(given)` ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)).

## 3. Registrar la fecha

El plazo corre desde el día en que se recibe la solicitud, y el acuse debe mostrar esa fecha
(LFPDPPP art. 31; Reglamento art. 95). Cuentan los días hábiles, no los naturales (LFPDPPP art. 2
fr. VIII). Calendario de días inhábiles: [Calendario que usa el departamento].

## 4. Plazos

| Paso                                   | LFPDPPP                                                                                                                                                                    | RGPD (usuarios en la UE)                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Comunicar la respuesta                 | 20 días hábiles desde la recepción (art. 31)                                                                                                                               | Sin dilación indebida, dentro de un mes desde la recepción (art. 12(3))                        |
| Hacer efectiva la respuesta procedente | 15 días hábiles desde la respuesta (art. 31)                                                                                                                               | Dentro del mismo mes                                                                           |
| Ampliación                             | Cada plazo una sola vez, por un periodo igual, cuando lo justifiquen las circunstancias (art. 31); los motivos se notifican dentro del plazo original (Reglamento art. 97) | Dos meses más cuando sea necesario, avisando al solicitante dentro del primer mes (art. 12(3)) |
| Caso más largo                         | 40 + 30 = 70 días hábiles                                                                                                                                                  | Tres meses                                                                                     |

Si aplican ambas leyes, trabaje con el plazo más corto. La parte del operador, según el contrato:
[5 días hábiles]
([processor-contract.es.md](processor-contract.es.md#10-apoyo-en-el-ejercicio-de-los-derechos-de-los-titulares)).

## 5. Cada derecho en Audit Hub

### Acceso

El titular tiene derecho a sus datos y a las condiciones de su tratamiento (LFPDPPP art. 22; RGPD
art. 15).

1. La aplicación consulta `GET /api/connector/subjects/:subject/export?cursor`, firmada con su
   llave: todos los eventos del usuario, con los datos personales satélite que aún se conservan (el
   nombre o la etiqueta enmascarada, el teléfono enmascarado, dirección IP, agente de usuario y
   client hints, identificador del dispositivo, lugar y coordenadas, precisas o aproximadas), 100
   por página ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api),
   [contract.md](../design/audit-hub/contract.md#query-api-for-applications-audit-hub-signed)).
   Siga el cursor hasta la última página.
2. O un administrador o auditor abre la página del usuario en las páginas de administración,
   `/apps/:app/actors/:id`: lo que el usuario hizo y lo que se hizo sobre él
   ([manual.md](../manual.md#118-audit-hub-the-admin-pages)).
3. No use para esto las exportaciones del explorador: no llevan datos personales (ni IP, ni agente
   de usuario, ni client hints, ni etiqueta, ni teléfono)
   ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)).
4. Agregue lo que la propia aplicación guarda para el conector: eventos aún en cola
   (`audit_outbox`), preguntas "¿Fue usted?" (7 días) y tokens de notificaciones push
   ([connection-guide.md](../audit/connection-guide.md#webhooks-was-it-you-and-the-accounts-activity),
   [connection-guide.md](../audit/connection-guide.md#push-notifications)).
5. Entregue los datos de forma legible, explicando códigos y abreviaturas (Reglamento art. 98), por
   el medio previsto en el aviso (LFPDPPP art. 32). Agregue la atribución "IP Geolocation by
   DB-IP" donde se muestren lugares obtenidos de ella
   ([ADR 0011](../adr/0011-geolocate-ips-with-an-optional-local-database.md)).

Cada consulta a la API queda en la bitácora propia de Audit Hub.

### Rectificación

El derecho aplica a datos inexactos, incompletos o no actualizados (LFPDPPP art. 23; RGPD art. 16).

- **Los eventos de auditoría registran hechos y no se rectifican.** Un evento dice lo que la
  aplicación observó en un momento: quién inició sesión, desde qué dirección, con qué resultado.
  Sigue siendo exacto como registro de ese momento aunque los datos de la persona cambien después.
  Las tablas son de solo inserción y están selladas: modificar un registro le quitaría su valor
  como evidencia, y la verificación diaria lo reportaría
  ([database.md](../database.md#audit-hubs-audit-tables),
  [security.md](../security.md#audit-log-integrity-retention-and-erasure)).
- **Los datos de perfil están en la aplicación.** La aplicación rectifica ahí el nombre, el correo,
  el teléfono o cualquier otro dato de perfil. Audit Hub no guarda perfiles: solo identificadores
  seudónimos, el seudónimo con llave del correo y, tal como eran en cada evento, el nombre de la
  persona o su etiqueta enmascarada y el teléfono enmascarado, que se borran a los 90 días; los
  eventos posteriores a la corrección llevan el nombre corregido
  ([design README](../design/audit-hub/README.md#legal-framework-mexico-plus-the-gdpr)).
- **Un evento que resulte erróneo** (por ejemplo, atribuido a otra cuenta): la aplicación registra
  un evento nuevo de su propio catálogo que deja constancia de la corrección
  ([connection-guide.md](../audit/connection-guide.md#your-own-actions)); el original se conserva.
  **Requiere revisión legal:** si esto cumple el art. 23 de la LFPDPPP y el art. 16 del RGPD.
- Responda al titular qué se corrigió en la aplicación y por qué la bitácora no se modifica.

### Cancelación

La cancelación da lugar a un periodo de bloqueo y después a la supresión; el periodo de bloqueo
equivale al plazo de prescripción de las acciones derivadas de la relación jurídica que funda el
tratamiento, según la ley aplicable, y una vez cancelado el dato se avisa al titular (LFPDPPP art.
24; art. 2 fr. III).

1. **Revise si algo debe conservarse.** El responsable no está obligado a cancelar cuando, entre
   otros casos, los datos deban tratarse por disposición legal (LFPDPPP art. 25 fr. II) o su
   cancelación obstaculice actuaciones sobre obligaciones fiscales, la investigación de delitos o
   sanciones administrativas (art. 25 fr. III); puede negarse cuando exista un impedimento legal o
   la resolución de una autoridad competente (art. 33 fr. IV). Revise las retenciones legales que
   coincidan con el usuario: impiden el borrado de lo que abarcan hasta que se liberan
   ([security.md](../security.md#audit-log-integrity-retention-and-erasure)); las páginas de
   administración las muestran con los plazos de conservación
   ([manual.md](../manual.md#118-audit-hub-the-admin-pages)).
2. **Ejecute el borrado**, de una de estas formas:
   - la cuenta se elimina en la aplicación: su evento de eliminación (`account.user.deleted`) borra
     los datos personales del usuario en Audit Hub al llegar, aunque Audit Hub no estuviera
     disponible en ese momento ([security.md](../security.md#detection-rules),
     [contract.md](../design/audit-hub/contract.md#query-api-for-applications-audit-hub-signed));
   - la cuenta se conserva: la aplicación llama al `AuditErasureService.erase(userId)` de su
     conector (`POST /api/connector/subjects/:subject/erasure`, firmada)
     ([connection-guide.md](../audit/connection-guide.md#a-users-data-erasure-and-blocking));
   - o un administrador borra desde la página del usuario en las páginas de administración, previa
     reautenticación (`POST /api/connected-apps/:appId/subjects/:subject/erasure`).
3. **Qué hace.** Borra los datos personales satélite de cada evento en que el usuario es el actor
   o el recurso (el nombre de la persona o sus etiquetas enmascaradas, el teléfono enmascarado,
   dirección IP, agente de usuario y client hints, identificador del dispositivo, lugar, valores
   personales de los cambios y coordenadas, precisas o aproximadas) y lo que las reglas derivaron
   de él (sus
   dispositivos, países, último inicio de sesión y lugar), salvo lo que conserve una retención
   legal. Los eventos permanecen, seudonimizados y **bloqueados**: lo ocurrido hasta el borrado
   queda fuera de toda lectura por persona (la página del usuario, una búsqueda por su id o su
   correo, su exportación, la API de consulta) y no se trata para él
   ([security.md](../security.md#audit-log-integrity-retention-and-erasure)). Cada borrado queda en
   `erasure_runs` y en la bitácora propia de Audit Hub. Anote la ejecución en el registro.
4. **En la aplicación:** los tokens de notificaciones push se borran con el usuario
   ([connection-guide.md](../audit/connection-guide.md#push-notifications)). Los eventos que aún
   estén en la cola de la aplicación (`audit_outbox`) llegan después a Audit Hub, en orden: uno que
   ocurrió antes del borrado pierde sus datos personales cuando las reglas de Audit Hub lo leen, y
   queda bloqueado como el resto. Si la cuenta se conserva, sus eventos nuevos son datos nuevos,
   registrados y mostrados como lo dice el aviso.
5. **Al terminar el periodo de bloqueo:** la supresión. Pida a Audit Hub que borre también los
   eventos: `AuditErasureService.erase(userId, 'events')`, o el alcance "Their events too" en la
   página del usuario. Los sellados se borran al momento, el resto en un día, cuando se sellan; lo
   que conserva una retención legal permanece. Sin esto, la depuración los suprime al vencer el
   plazo de su clase. Anótelo en el registro.
6. **Respaldos:** los datos borrados permanecen en los respaldos hasta que estos expiran:
   [conservación de los respaldos]. Después de una restauración, los borrados solicitados después
   del punto de recuperación se ejecutan de nuevo a partir de este registro
   ([disaster-recovery.md](../disaster-recovery.md#restore-procedure)).
7. **Avise al titular** el resultado, el periodo de bloqueo y la fecha en que se cancelaron los
   datos (LFPDPPP art. 24).

**Requiere revisión legal:**

- **El periodo de bloqueo.** Su duración es el plazo de prescripción de la ley que rige la relación
  con el usuario (LFPDPPP art. 24); la investigación detrás de este procedimiento no lo
  determinó. [Plazo de prescripción aplicable, por clase de evento.]
- **Los plazos mínimos** (seguridad 730 días, auditoría 365, acceso 180, sistema 30) son valores
  por omisión de Audit Hub ([database.md](../database.md#audit-hubs-audit-tables)), no plazos de la
  LFPDPPP. Justifican conservar los eventos seudonimizados después de una cancelación solo en la
  medida en que una ley lo exija (art. 25 fr. II) o exista un impedimento legal (art. 33 fr. IV).
- **Datos bloqueados.** Durante el bloqueo los datos no pueden ser objeto de tratamiento (LFPDPPP
  art. 2 fr. III), salvo su almacenamiento (Reglamento art. 108). Audit Hub los bloquea como dice
  el punto 3; una búsqueda por algo distinto de la persona (una dirección, una acción, un periodo)
  sigue encontrándolos, seudonimizados, para que la bitácora de un incidente quede completa. Si ese
  uso para la seguridad es "almacenamiento" en el sentido del Reglamento, o requiere una retención
  legal en cada caso, lo decide el abogado: [Procedimiento para las búsquedas que alcanzan eventos
  bloqueados].
- **Seudónimo no es anónimo.** La aplicación puede vincular sus identificadores de usuario con
  personas, así que los eventos que permanecen siguen siendo datos personales (LFPDPPP art. 2 fr.
  V).

### Oposición

El titular puede oponerse por causa legítima, cuando la persistencia del tratamiento le cause un
perjuicio, o al tratamiento automatizado que le produzca efectos jurídicos no deseados o afecte de
manera significativa sus intereses, derechos o libertades y que evalúe sin intervención humana
aspectos personales (LFPDPPP art. 26 fr. I y II; RGPD arts. 21, 22). La oposición no procede
cuando el tratamiento es necesario para cumplir una obligación legal del responsable (LFPDPPP art.
26, último párrafo).

- **Las reglas solo alertan.** Las reglas de Audit Hub generan alertas y pueden enviar a la
  aplicación una pregunta "¿Fue usted?"; nunca actúan sobre una persona
  ([security.md](../security.md#detection-rules)).
- **Toda acción es de una persona.** Cerrar sesiones, exigir un cambio de contraseña o deshabilitar
  una cuenta lo pide un administrador, con un motivo de 10 a 500 caracteres, y por omisión lo
  aprueba un segundo administrador; cada aplicación no acepta ninguna hasta que las active
  ([security.md](../security.md#webhooks-and-response-actions),
  [ADR 0013](../adr/0013-deliver-webhooks-and-response-actions-through-an-outbox.md)).
- **"No fui yo"** cierra las sesiones del usuario porque él lo pidió
  ([connection-guide.md](../audit/connection-guide.md#webhooks-was-it-you-and-the-accounts-activity)).
- **Qué puede detenerse:** la ubicación del dispositivo, desactivando su consentimiento en la app,
  o limitarse a la aproximada si la persona la elige en el diálogo de su teléfono
  ([connection-guide.md](../audit/connection-guide.md#location-optional)); las acciones de respuesta
  de la aplicación, por instrucción del responsable al operador. La documentación de Audit Hub no
  describe un interruptor que deje de registrar a un usuario; pondere la oposición frente a la
  finalidad de seguridad y la excepción por obligación legal.
- **Requiere revisión legal:** si las alertas y las preguntas "¿Fue usted?" son tratamiento
  automatizado en el sentido del art. 26 fr. II de la LFPDPPP; y, si la aplicación actúa por sí
  misma ante las alertas (su propio manejador de alertas), si esa decisión lo es.

### Derechos que solo prevé el RGPD

- **Limitación** (art. 18): el bloqueo después de un borrado (arriba) limita el tratamiento por
  persona; una limitación sin borrado no tiene un interruptor en Audit Hub, y una retención legal
  conserva datos, no los limita. Atienda ese caso por procedimiento: [Procedimiento].
- **Portabilidad** (art. 20), cuando proceda: la exportación de la API de consulta responde en JSON.
- **Retiro del consentimiento:** la ubicación, como arriba.
- **Aviso a destinatarios** (art. 19; también LFPDPPP art. 24): Audit Hub, como encargado, recibe
  el borrado; avise a cualquier otro destinatario de copias anteriores (por ejemplo, una
  exportación ya compartida).

## 6. Responder

- Responda siempre, aun cuando no tenga datos de la persona, de forma legible y comprensible
  (Reglamento art. 98).
- La negativa puede ser parcial. Se motiva, por el mismo medio de la solicitud y dentro de los
  plazos: identidad no acreditada; datos que no se tienen; lesión de derechos de un tercero;
  impedimento legal o resolución de autoridad; derecho ya atendido (LFPDPPP art. 33 fr. I a V).
  Informa al titular que puede iniciar un procedimiento de protección de derechos ante la
  Secretaría Anticorrupción y Buen Gobierno (Reglamento art. 100), dentro de los 15 días hábiles
  siguientes a la respuesta, o al vencimiento del plazo sin respuesta (LFPDPPP art. 40).

## 7. Plantillas de respuesta

Textos breves para el departamento; adáptelos y envíelos por el medio de la solicitud.

**Acuse de recibo**

> Recibimos su solicitud el [fecha], con folio [folio]. Le responderemos a más tardar el [fecha: 20
> días hábiles].

**Información faltante**

> Para atender su solicitud [folio] necesitamos [lo que falta]. Por favor envíelo dentro de los 10
> días hábiles siguientes a este mensaje; el plazo para responderle correrá de nuevo a partir del
> día siguiente a que lo recibamos.

**Ampliación del plazo**

> Su solicitud [folio] requiere más tiempo porque [motivo]. Ampliamos el plazo por [20 o 15] días
> hábiles, hasta el [fecha] (LFPDPPP art. 31).

**Acceso**

> Le enviamos los datos de la bitácora de seguridad de su cuenta [identificador de usuario], con
> una explicación de cada campo. [Medio de entrega.] Los lugares obtenidos de las direcciones IP
> provienen de "IP Geolocation by DB-IP" (https://db-ip.com).

**Rectificación**

> Corregimos [datos] en [Nombre de la aplicación]. La bitácora de seguridad registra lo que ocurrió
> en cada momento y no se modifica: contiene identificadores codificados y, durante 90 días, su
> nombre y los últimos cuatro dígitos de su teléfono tal como eran en cada evento. Sus eventos a
> partir de ahora llevan los datos corregidos.

**Cancelación realizada**

> El [fecha] borramos de la bitácora de seguridad su nombre o etiquetas enmascaradas, los últimos
> cuatro dígitos de su teléfono, sus direcciones IP, los datos de su navegador, el identificador de
> su dispositivo, los lugares y la ubicación. Los eventos de su
> cuenta permanecen, solo con identificadores codificados, bloqueados hasta [fecha o plazo] por
> [fundamento legal], y después se suprimirán.

**Cancelación negada en parte**

> No podemos cancelar [datos] porque [fundamento: LFPDPPP art. 25 fr. (número), o art. 33 fr. IV].
> Sí cancelamos [lo demás]. Puede iniciar un procedimiento de protección de derechos ante la
> Secretaría Anticorrupción y Buen Gobierno dentro de los 15 días hábiles siguientes.

**Oposición**

> Nuestras reglas automáticas solo generan alertas; cualquier medida sobre una cuenta la decide una
> persona. [Resolución sobre la oposición y su fundamento.] [Si procede: qué se detiene y desde
> cuándo.]

**Sin datos**

> Buscamos en nuestros registros, incluida la bitácora de seguridad, y no tenemos datos personales
> suyos vinculados con [identificador proporcionado].

## 8. Registro

Una fila por solicitud. Conserve el registro durante [conservación del registro].

| Folio   | Recibida | Medio   | Derecho   | Identidad acreditada (fecha, medio) | Id de usuario | Información faltante pedida / recibida | Vence respuesta | Ampliación (fecha de aviso) | Respuesta enviada | Resolución  | Hacer efectiva antes de | Hecho   | Acción en Audit Hub (exportación, borrado, retención legal) | Notas   |
| ------- | -------- | ------- | --------- | ----------------------------------- | ------------- | -------------------------------------- | --------------- | --------------------------- | ----------------- | ----------- | ----------------------- | ------- | ----------------------------------------------------------- | ------- |
| [folio] | [fecha]  | [medio] | [derecho] | [fecha, medio]                      | [id]          | [fechas]                               | [fecha]         | [no, o fecha]               | [fecha]           | [resultado] | [fecha]                 | [fecha] | [referencia]                                                | [notas] |

## Solicitudes de los usuarios de Audit Hub

Los administradores, auditores y lectores de Audit Hub dirigen sus solicitudes al operador, que es
su responsable ([README.es.md](README.es.md#figuras)). Gestionan su contraseña, su correo y su
segundo factor en su página de Cuenta ([manual.md](../manual.md#118-audit-hub-the-admin-pages)); sus
acciones y consultas son eventos de la aplicación propia de Audit Hub, conservados 730 días para la
rendición de cuentas ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)).
Un administrador desactiva una cuenta (todas sus sesiones terminan a la vez; se rechaza su inicio
de sesión) o la quita: se borran el correo, el nombre, la contraseña, el segundo factor, las
sesiones y las asignaciones, y la cuenta conserva solo su id, que la bitácora propia de Audit Hub
sigue nombrando ([manual.es.md](../manual.es.md#1110-audit-hub-solicitudes-de-privacidad-sus-cuentas-y-el-fin-de-una-aplicación)). Lo que la persona hizo permanece en esa bitácora,
con su propio plazo (sus datos de red y dispositivo vencen antes): es el registro de seguridad de
la instancia, conservado conforme al art. 25 fr. II o III de la LFPDPPP cuando apliquen.
**Requiere revisión legal:** ese fundamento y el plazo.
