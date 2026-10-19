# Párrafos del aviso de privacidad para una aplicación conectada

English version: [privacy-notice.md](privacy-notice.md).

> **Borrador para revisión legal.** Plantilla, no es asesoría legal. Debe revisarla un abogado
> antes de usarse. Última revisión contra la ley: 2026-10-17.

Los párrafos que una aplicación conectada agrega a su propio aviso de privacidad para cubrir su
bitácora de seguridad en Audit Hub. El titular de la aplicación, como responsable, da el aviso. El
operador de Audit Hub nunca se dirige a los usuarios de la aplicación, y su tratamiento debe
ajustarse a este aviso (Reglamento art. 50, último párrafo).

- Este es el texto que leen los usuarios en México, listo para publicarse una vez revisado.
- Elija las opciones que correspondan a la aplicación: nombre de la persona enviado o no, teléfono
  enmascarado enviado o no, ubicación del dispositivo activada o no, notificaciones push activadas o
  no, acciones de respuesta aceptadas o no
  ([processor-contract.es.md](processor-contract.es.md#anexo-1-aplicaciones-y-ajustes)).
- Datos por completar: [Nombre del responsable], [Domicilio], [Correo del departamento de datos
  personales], [Nombre de la aplicación], [URL del aviso integral].
- Borre las notas "Requiere revisión legal" antes de publicar, una vez que el abogado las resuelva.
  Los hechos detrás de cada párrafo están en
  [Fuentes de cada párrafo](#fuentes-de-cada-párrafo).

## Qué debe contener el aviso

| Elemento                                                            | Fuente                                          | Párrafo                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Identidad y domicilio del responsable                               | LFPDPPP art. 15 fr. I; RGPD art. 13(1)(a)       | [1](#1-responsable-de-sus-datos)                        |
| Datos que se tratan, señalando los sensibles                        | LFPDPPP art. 15 fr. II                          | [2](#2-qué-registra-la-bitácora-de-seguridad)           |
| Finalidades, distinguiendo las que requieren consentimiento         | LFPDPPP art. 15 fr. III; RGPD art. 13(1)(c)     | [3](#3-finalidades)                                     |
| Opciones para limitar el uso o la divulgación                       | LFPDPPP art. 15 fr. IV                          | [4](#4-cómo-limitar-el-uso-de-sus-datos)                |
| Conservación                                                        | RGPD art. 13(2)(a)                              | [5](#5-cuánto-tiempo-los-conservamos)                   |
| Destinatarios (la persona encargada)                                | RGPD art. 13(1)(e)                              | [6](#6-quién-los-trata-por-nuestra-cuenta)              |
| Cláusula de transferencias                                          | LFPDPPP art. 35                                 | [7](#7-transferencias)                                  |
| Medios para ejercer los derechos ARCO                               | LFPDPPP art. 15 fr. V; RGPD art. 13(2)(b)       | [8](#8-sus-derechos)                                    |
| Tratamiento automatizado                                            | LFPDPPP art. 26 fr. II; RGPD arts. 13(2)(f), 22 | [9](#9-tratamiento-automatizado)                        |
| Cómo se comunican los cambios al aviso                              | LFPDPPP art. 15 fr. VI                          | [10](#10-cambios-a-este-aviso)                          |
| Base jurídica, retiro del consentimiento, queja ante una autoridad  | RGPD art. 13(1)(c), (2)(c), (2)(d)              | [11](#11-para-usuarios-en-la-unión-europea)             |
| Aviso simplificado: fracciones I a IV y dónde consultar el integral | LFPDPPP art. 16 fr. II                          | [Aviso simplificado](#aviso-de-privacidad-simplificado) |

**Requiere revisión legal.** Los Lineamientos del Aviso de Privacidad de 2013 fijan reglas
detalladas (por ejemplo, el nombre completo y el domicilio del responsable, y la prohibición de
frases vagas como "entre otros datos"). Se emitieron con la ley de 2010 y su vigencia con la ley de
2025 no está confirmada. Estos párrafos los siguen de todos modos.

## Aviso de privacidad integral

### 1. Responsable de sus datos

[Nombre del responsable], con domicilio en [Domicilio], es responsable del tratamiento de los
datos personales que se describen en este apartado.

### 2. Qué registra la bitácora de seguridad

Para proteger su cuenta y nuestro servicio, [Nombre de la aplicación] lleva una bitácora de
seguridad con eventos como inicios de sesión e intentos fallidos, cierres de sesión, cambios de
contraseña y de correo, cambios de roles e invitaciones, y solicitudes rechazadas o limitadas. De
cada evento, la bitácora puede registrar:

| Categoría            | Datos                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identificación       | Su identificador de usuario en [Nombre de la aplicación], su rol, una forma codificada de su correo electrónico (nunca el correo) y su nombre o, si la aplicación no lo envía, una etiqueta enmascarada como `a***@e***.com`; si su cuenta tiene un teléfono vinculado, solo sus últimos cuatro dígitos (`•••• 1234`)                                                                                                                       |
| Qué ocurrió          | La acción, su resultado, la fecha y hora, el registro al que se refiere y qué campos cambiaron                                                                                                                                                                                                                                                                                                                                              |
| Conexión             | Su dirección IP; su navegador o aplicación (agente de usuario) y, si su navegador está basado en Chromium (Chrome, Edge, Brave, Opera), los datos que envía de sí mismo (client hints): su marca y versión, el sistema operativo y su versión, y el modelo del teléfono; y el país, la región, la ciudad y la red que se deducen de la IP                                                                                                   |
| Dispositivo          | Un identificador aleatorio de la instalación de la app, la versión y la compilación de la app, la plataforma, el sistema operativo y el modelo del dispositivo                                                                                                                                                                                                                                                                              |
| Ubicación (opcional) | Solo si usted la activa en la app, y solo al comenzar una sesión (cuando inicia sesión o abre la app con la sesión iniciada): la posición aproximada de su teléfono, redondeada a cerca de 1 km, o, si usted permite la precisa cuando su teléfono se lo pregunta, su posición precisa, a cerca de 1 metro, con la exactitud que midió el teléfono. En la web no se toma la ubicación del dispositivo: solo el lugar que se deduce de la IP |

La bitácora también registra los intentos hechos con un correo que no tiene cuenta; de ese correo
solo guarda la forma codificada. Su número de teléfono nunca se registra: solo sus últimos cuatro
dígitos, para reconocer su cuenta (por ejemplo, en una investigación); no se usa para llamarle ni
para enviarle mensajes. **La bitácora de seguridad no contiene datos personales sensibles**, ni
contraseñas, códigos o tokens: los campos marcados como sensibles se reemplazan antes de salir de
nuestros sistemas. La ubicación precisa tampoco es un dato sensible, pero revela más de usted: por
eso requiere su consentimiento, solo se toma al comenzar una sesión y se conserva 30 días.
[Confirme que las acciones que la aplicación agregó a su catálogo no contienen datos sensibles.]

### 3. Finalidades

**Finalidades necesarias para el servicio** ([fundamento que elija el abogado]):

1. proteger su cuenta y nuestros sistemas: detectar inicios de sesión inusuales, intentos de
   adivinar contraseñas y usos indebidos;
2. prevenir fraudes y el robo de cuentas, lo que incluye preguntarle "¿Fue usted?" después de un
   inicio de sesión inusual;
3. rendición de cuentas: conservar un registro, que no puede alterarse sin que se note, de quién
   hizo qué y cuándo;
4. cumplir nuestras obligaciones legales y atender los requerimientos de autoridades competentes.

**Finalidad que requiere su consentimiento:**

5. usar la ubicación de su teléfono, tomada al comenzar una sesión, para detectar inicios de sesión
   desde lugares que no coinciden con el de su teléfono. Solo si usted la activa en la
   Configuración de la app; su teléfono le permite elegir si comparte la ubicación precisa o la
   aproximada, y puede desactivarla en cualquier momento.

**Requiere revisión legal.** Si las finalidades 1 a 4 se apoyan en el consentimiento tácito por
este aviso (LFPDPPP art. 7) o en una excepción al consentimiento (LFPDPPP art. 9), y qué forma de
consentimiento requiere la ubicación, en particular la precisa.

### 4. Cómo limitar el uso de sus datos

- **Ubicación:** desactívela en la Configuración de la app. Desde ese momento no se envía ninguna
  posición, y las ya registradas se borran en un plazo de 30 días. Para compartir solo la
  ubicación aproximada, elíjala cuando su teléfono se lo pregunte, o después en la configuración
  de su teléfono.
- **Notificaciones:** puede desactivar las notificaciones de la app en la configuración de su
  teléfono. La pregunta "¿Fue usted?" seguirá apareciendo en la app la próxima vez que la abra.
- [Otras opciones que ofrezca la aplicación.]

### 5. Cuánto tiempo los conservamos

| Datos                                                                                                                                                                                                              | Plazo    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Ubicación de su teléfono, aproximada o precisa                                                                                                                                                                     | 30 días  |
| Dirección IP, agente de usuario y datos del navegador (client hints), identificador del dispositivo, su nombre o etiqueta enmascarada, teléfono enmascarado, ciudad y valores personales de los campos modificados | 90 días  |
| Eventos de seguridad: inicios de sesión e intentos fallidos, sesiones, cambios de contraseña y correo, estado de la cuenta                                                                                         | 730 días |
| Eventos de administración: invitaciones, cuentas creadas, cambios de rol                                                                                                                                           | 365 días |
| Eventos de acceso: consulta de registros de otros usuarios                                                                                                                                                         | 180 días |
| Eventos técnicos [si la aplicación registra alguno]                                                                                                                                                                | 30 días  |

[Plazos mayores fijados para la aplicación, en su caso.] Los registros relacionados con una
investigación o una reclamación legal se conservan hasta que esta concluya. Al terminar esos
plazos, los registros se suprimen.

**Requiere revisión legal.** Qué ley exige, o justifica, conservar cada clase de eventos durante
esos plazos.

### 6. Quién los trata por nuestra cuenta

La bitácora de seguridad la resguarda [Nombre del operador], que la trata únicamente por nuestra
cuenta y conforme a nuestras instrucciones, mediante un contrato que la obliga a mantenerla
confidencial y segura. Sus servidores se encuentran en [País y región del hospedaje]. Los servicios
que utiliza se publican en [Dónde se publica la lista de subencargados].

### 7. Transferencias

No transferimos a terceros los datos de la bitácora de seguridad, salvo cuando lo requiera una
autoridad competente o la ley lo permita sin su consentimiento (LFPDPPP art. 36). [Si la aplicación
los transfiere: el destinatario, la finalidad y la cláusula con la que usted acepta o no la
transferencia (LFPDPPP art. 35).]

### 8. Sus derechos

Usted puede acceder a sus datos, pedir que se rectifiquen o cancelen, u oponerse a su uso
(derechos ARCO), escribiendo a nuestro departamento de datos personales a [Correo del departamento
de datos personales] o por [Otro medio]. Su solicitud debe incluir su nombre y un medio para
responderle; un documento que acredite su identidad o la de su representante; una descripción
clara de los datos y del derecho que ejerce, y cualquier elemento que nos ayude a localizar los
datos (LFPDPPP art. 28). Le responderemos en un plazo máximo de 20 días hábiles y, si la respuesta
es procedente, la haremos efectiva dentro de los 15 días hábiles siguientes; cada plazo puede
ampliarse una sola vez (LFPDPPP art. 31). El trámite es gratuito; solo podrán cobrarse los costos
de reproducción, copias o envío (LFPDPPP art. 34).

Cómo se aplica cada derecho a la bitácora de seguridad:

- **Acceso:** le entregamos todos los eventos de su cuenta con los datos que aún se conservan,
  como su nombre, el teléfono enmascarado, los datos de su red y de su navegador, y su ubicación.
- **Rectificación:** puede corregir su perfil, incluidos su nombre y su teléfono, en [Nombre de la
  aplicación]. La bitácora registra los hechos tal como ocurrieron y no se modifica; contiene
  identificadores codificados y, tal como eran en cada evento, su nombre o etiqueta enmascarada y
  el teléfono enmascarado, que se borran a los 90 días.
- **Cancelación:** borramos de la bitácora su nombre o etiquetas enmascaradas, el teléfono
  enmascarado, sus direcciones IP, los datos de su navegador (agente de usuario y client hints), el
  identificador de su dispositivo, los lugares y la ubicación (precisa o aproximada), y lo que
  nuestras reglas de seguridad aprendieron de usted (sus dispositivos, países y último lugar). Los
  eventos permanecen, solo con identificadores codificados, bloqueados: no se usan para usted ni
  nadie los consulta como suyos; se conservan únicamente mientras lo exija una obligación legal y
  después se suprimen (LFPDPPP arts. 24 y 25). Si conserva su cuenta, lo que haga después se
  registra como lo dice este aviso.
- **Oposición:** puede oponerse al tratamiento (LFPDPPP art. 26), salvo cuando sea necesario para
  cumplir una obligación legal.

**Requiere revisión legal.** Una búsqueda por un incidente de seguridad, por algo distinto de la
persona (una dirección, una acción, un periodo), sigue encontrando eventos bloqueados, codificados:
véase [arco-procedure.es.md](arco-procedure.es.md#cancelación).

### 9. Tratamiento automatizado

Unas reglas automáticas buscan señales de riesgo, como un inicio de sesión desde un dispositivo o
un país nuevos. Solo generan alertas y, en algunos casos, le preguntan "¿Fue usted?". **Estas
reglas no toman ninguna decisión sobre su cuenta:** cualquier medida, como cerrar sus sesiones, la
decide una persona autorizada, con un motivo y, por omisión, con la aprobación de una segunda
persona. Si usted responde "No fui yo", sus sesiones se cierran porque usted lo pidió. Puede
oponerse al tratamiento automatizado que le afecte (LFPDPPP art. 26 fr. II).

**Requiere revisión legal.** Si la aplicación actúa por sí misma ante las alertas (por ejemplo, con
su propio manejador de alertas), este párrafo debe decirlo, y el derecho de oposición del art. 26
fr. II de la LFPDPPP y el art. 22 del RGPD aplican a esa decisión.

### 10. Cambios a este aviso

Le comunicaremos cualquier cambio a este aviso por [Medio: la aplicación, correo electrónico, el
sitio web], y publicaremos la versión vigente en [URL del aviso integral].

### 11. Para usuarios en la Unión Europea

[Solo si el RGPD aplica a la aplicación. **Requiere revisión legal.**]

- **Base jurídica:** [para las finalidades 1 a 4, por ejemplo el interés legítimo en la seguridad
  del servicio, o una obligación legal (RGPD art. 6(1)(f) o (c)); para la finalidad 5, el
  consentimiento (RGPD art. 6(1)(a))].
- **Retiro del consentimiento:** puede desactivar la ubicación en cualquier momento; esto no afecta
  el tratamiento realizado antes.
- **Sus derechos:** también la limitación del tratamiento y la portabilidad, cuando procedan (RGPD
  arts. 18 y 20). Respondemos en un mes, prorrogable dos meses más cuando sea necesario (RGPD art.
  12(3)).
- **Queja:** puede presentar una reclamación ante una autoridad de control de protección de datos,
  en particular la del país donde vive.
- **Fuera de la UE:** la bitácora se guarda en [País]; [base del capítulo V del RGPD, por ejemplo
  cláusulas contractuales tipo].
- **Delegado de protección de datos o representante en la UE:** [Contacto, si se designó].

## Aviso de privacidad simplificado

Para la obtención por la app o el sitio web (LFPDPPP art. 16 fr. II: fracciones I a IV del art. 15
y dónde consultar el aviso integral):

> [Nombre del responsable], con domicilio en [Domicilio], lleva una bitácora de seguridad de su
> actividad en [Nombre de la aplicación]: su identificador de usuario, su nombre, una forma
> codificada de su correo, los últimos cuatro dígitos de su teléfono si su cuenta tiene uno, su
> dirección IP, su navegador o dispositivo, el lugar que se deduce de su IP y, solo si usted la
> activa, la ubicación de su teléfono al comenzar una sesión, aproximada o, si usted lo permite,
> precisa. La usamos para proteger su cuenta, prevenir fraudes, conservar un registro de quién hizo
> qué y cumplir nuestras obligaciones legales. La ubicación requiere su consentimiento y puede
> desactivarla en la Configuración. Consulte el aviso integral en [URL del aviso integral].

## Texto de consentimiento para la ubicación

Se muestra en la Configuración de la app, junto al interruptor:

> **Usar mi ubicación para las alertas de inicio de sesión.** Cuando usted inicia sesión o abre la
> app, comprobamos que los inicios de sesión en su cuenta ocurren donde usted está. Al activarlo,
> su teléfono le pregunta si comparte su ubicación precisa o la aproximada. Precisa: tomamos su
> posición una sola vez, en ese momento (el GPS se usa 10 segundos como máximo), con una exactitud
> de cerca de 1 metro. Aproximada: enviamos la última posición que su teléfono ya conoce,
> redondeada a cerca de 1 km. Nunca en segundo plano ni de forma continua. La conservamos 30 días.
> Puede desactivarlo en cualquier momento.

## Fuentes de cada párrafo

Lo que hace Audit Hub detrás de cada párrafo. Borre esta sección antes de publicar.

| Párrafo                                 | Hecho                                                                                                                                                                                                                                                                                                                                                 | Dónde se documenta                                                                                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2, eventos registrados                  | Las acciones del catálogo base y sus clases                                                                                                                                                                                                                                                                                                           | [connection-guide.md](../audit/connection-guide.md#integration-points), [contract.md](../design/audit-hub/contract.md#base-catalog-every-flow-of-project-template-web)                                                    |
| 2, datos                                | Ids, seudónimo del correo, etiqueta (el nombre de la persona, o el correo enmascarado en el origen), teléfono enmascarado en el origen (uno sin enmascarar se rechaza); IP, agente de usuario, client hints, id del dispositivo, lugar; coordenadas                                                                                                   | [tabla de privacidad](../design/audit-hub/README.md#privacy-at-a-glance), [connection-guide.md](../audit/connection-guide.md#recording-events)                                                                            |
| 2, conexión y dispositivo               | País y red en el evento, región y ciudad aparte; client hints de los navegadores basados en Chromium (Chrome, Edge, Brave, Opera; no Firefox ni Safari), reenviados por los conectores; los encabezados de la app y el id de instalación                                                                                                              | [security.md](../security.md#ip-geolocation-data), [connection-guide.md](../audit/connection-guide.md#the-mobile-app)                                                                                                     |
| 2, sin datos sensibles                  | Los campos marcados `sensitive` llegan como `[REDACTED]`                                                                                                                                                                                                                                                                                              | [connection-guide.md](../audit/connection-guide.md#your-own-actions)                                                                                                                                                      |
| 3, finalidades 1 a 3                    | Reglas de detección, "¿Fue usted?", sellos de integridad                                                                                                                                                                                                                                                                                              | [security.md](../security.md#detection-rules), [connection-guide.md](../audit/connection-guide.md#webhooks-was-it-you-and-the-accounts-activity), [security.md](../security.md#audit-log-integrity-retention-and-erasure) |
| 3, finalidad 5, texto de consentimiento | Consentimiento propio, desactivado por omisión, solo en la app móvil; precisa o aproximada, a elección en el diálogo del teléfono; última posición conocida o, si se permite la precisa, una posición nueva al comenzar la sesión (el GPS 10 segundos como máximo); 0.01° o cinco decimales, redondeo en el teléfono; nunca en segundo plano; 30 días | [connection-guide.md](../audit/connection-guide.md#location-optional)                                                                                                                                                     |
| 4, notificaciones                       | Sin push, la pregunta aparece en la app                                                                                                                                                                                                                                                                                                               | [connection-guide.md](../audit/connection-guide.md#push-notifications)                                                                                                                                                    |
| 5, conservación                         | Mínimos por clase: seguridad 730, auditoría 365, acceso 180, sistema 30, datos personales 90, coordenadas 30; retenciones legales                                                                                                                                                                                                                     | [database.md](../database.md#audit-hubs-audit-tables), [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                            |
| 8, derechos                             | Exportación de los eventos del usuario; borrado de los datos personales (incluidos nombres, teléfonos enmascarados, client hints y coordenadas); eventos seudonimizados                                                                                                                                                                               | [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api), [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                       |
| 9, tratamiento automatizado             | Las reglas solo alertan; acciones de respuesta por administradores, con motivo y aprobación; "No fui yo" cierra sesiones; el manejador de alertas de la propia aplicación                                                                                                                                                                             | [security.md](../security.md#detection-rules), [security.md](../security.md#webhooks-and-response-actions), [connection-guide.md](../audit/connection-guide.md#webhooks-was-it-you-and-the-accounts-activity)             |
