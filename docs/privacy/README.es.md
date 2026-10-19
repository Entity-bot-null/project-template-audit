# Documentación de privacidad

English version: [README.md](README.md).

> **Borrador para revisión legal.** Plantilla, no es asesoría legal. Debe revisarla un abogado
> antes de usarse. Última revisión contra la ley: 2026-10-17.

Esta carpeta reúne las plantillas de privacidad de una instalación de Audit Hub: el contrato de
encargo, los párrafos que una aplicación conectada agrega a su aviso de privacidad, una evaluación
de impacto y el procedimiento ARCO. Describen lo que hace Audit Hub según la documentación de este
repositorio y dejan entre [corchetes] lo que solo el operador o el responsable pueden completar.

- **Son plantillas, no asesoría legal.** Un abogado revisa y adapta cada documento antes de usarlo.
- **En México, el texto vinculante es el español que prepare el abogado.** Los archivos `.es.md`
  son borradores para esa revisión. Los archivos en inglés son la referencia del repositorio, cuya
  documentación está en inglés.
- **"Requiere revisión legal"** señala una pregunta que la investigación detrás de estas plantillas
  no pudo resolver. Conserve la marca hasta que el abogado la responda.

## Figuras

| Quién                                                            | LFPDPPP (México, 2025)                                 | RGPD (GDPR)            | Qué hace con Audit Hub                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| El titular de cada aplicación conectada                          | responsable (art. 2 fr. XIV con fr. XVI)               | controller (art. 4(7)) | Decide para qué se registran los eventos de seguridad de sus usuarios, los envía con su conector y atiende sus solicitudes |
| Quien opera la instancia de Audit Hub                            | persona encargada (art. 2 fr. XII)                     | processor (art. 4(8))  | Guarda, sella, analiza y devuelve los eventos por cuenta del responsable                                                   |
| Los usuarios de cada aplicación conectada y sus dispositivos     | titulares (art. 2 fr. XVIII)                           | data subjects          | Se registran sus inicios de sesión, cambios de cuenta y eventos de sus dispositivos                                        |
| Los usuarios de Audit Hub (administradores, auditores, lectores) | titulares; el operador es su responsable (véase abajo) | data subjects          | Su cuenta, y cada consulta que hacen de datos de auditoría, quedan en la bitácora propia de Audit Hub                      |

- **Remisión, no transferencia.** Lo que la aplicación envía al operador es una remisión, no una
  transferencia: la transferencia es la comunicación a persona distinta del titular, del
  responsable o de la persona encargada (LFPDPPP art. 2 fr. XX; Reglamento art. 2 fr. IX). La
  remisión no requiere informarse al titular ni su consentimiento (Reglamento art. 53), pero sí un
  contrato u otro instrumento jurídico (Reglamento art. 51):
  [processor-contract.es.md](processor-contract.es.md).
- **El operador puede tener obligaciones propias.** La ley de 2025 define "responsable" como
  cualquier particular que "lleva a cabo el tratamiento" (art. 2 fr. XIV con fr. XVI). Un despacho
  lo interpreta como aplicable también a los encargados. **Requiere revisión legal:** qué
  obligaciones de responsable tiene el operador directamente.
- **Usuarios de Audit Hub.** El operador decide cómo se tratan sus cuentas (contraseña, segundo
  factor, sesiones, bitácora propia de lo que consultan); para esos datos actúa como responsable y
  les da su propio aviso: [Aviso de privacidad para los usuarios de Audit Hub]. Sus cuentas guardan
  correo, nombre, rol, hash de la contraseña y segundo factor
  ([security.md](../security.md#second-factor-and-recent-authentication)), y sus consultas se
  conservan 730 días ([database.md](../database.md#audit-hubs-audit-tables)). Un administrador
  desactiva una cuenta, o la quita conservando solo su id para la bitácora
  ([security.md](../security.md#disabling-and-removing-audit-hubs-accounts)). **Requiere revisión
  legal:** la figura del operador respecto de las cuentas que usa el personal del responsable (sus
  auditores y lectores).
- **Autoalojamiento.** Si la empresa dueña de la aplicación también opera Audit Hub, no hay
  persona encargada para Audit Hub: el encargado es "ajena a la organización del responsable"
  (Reglamento art. 49). La empresa es responsable de todo el tratamiento y el contrato se convierte
  en una política interna (véase
  [processor-contract.es.md](processor-contract.es.md#autoalojamiento-el-contrato-como-política-interna)).
  Sus proveedores de hospedaje, correo y rastreo de errores siguen siendo encargados y requieren
  su propio contrato. Otra empresa del mismo grupo es otra persona: use el contrato.
- **Entes públicos.** Si una aplicación conectada pertenece a un ente público, aplica la ley del
  sector público (LGPDPPSO 2025), con sus propias cláusulas obligatorias (su art. 53). Estas
  plantillas no la cubren.

## Situación jurídica

| Tema                                        | Situación al 2026-10-17                                                                                                                                                                                                                                                                    | Fuente                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Ley                                         | Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP), publicada en el DOF el 2025-03-20, vigente desde el 2025-03-21. Abrogó la ley de 2010.                                                                                                            | LFPDPPP, transitorios Primero y Segundo fr. I                    |
| Reforma posterior                           | DOF 2025-11-14: solo modifica el art. 4 (supletoriedad). Sin efecto en las obligaciones sustantivas.                                                                                                                                                                                       | Decreto del 2025-11-14, Artículo Trigésimo Octavo                |
| Autoridad                                   | Secretaría Anticorrupción y Buen Gobierno. Asumió las funciones de protección de datos del INAI.                                                                                                                                                                                           | LFPDPPP art. 2 fr. XV, arts. 38–39; transitorios Cuarto a Octavo |
| Reglamento                                  | No se encontró un Reglamento de la ley de 2025. El Reglamento de 2011 sigue listado como vigente, pero ningún transitorio lo mantiene: su aplicación **NO ESTÁ CONFIRMADA (requiere revisión legal)**. Cita los artículos de la ley de 2010. Revise el DOF antes de usar estas plantillas. | LFPDPPP art. 2 fr. XIII, transitorio Décimo Segundo              |
| Lineamientos del Aviso de Privacidad (2013) | Emitidos con la ley de 2010. Su vigencia con la ley de 2025 **NO ESTÁ CONFIRMADA (requiere revisión legal)**.                                                                                                                                                                              | DOF 2013-01-17                                                   |
| Contrato con la persona encargada           | La ley de 2025 no lo regula. Los requisitos vienen solo del Reglamento de 2011 (arts. 49–55, 57), cuya vigencia no está confirmada.                                                                                                                                                        | Reglamento arts. 49–55, 57                                       |
| Aviso de vulneraciones                      | A los titulares, "de forma inmediata", cuando afecte de forma significativa sus derechos patrimoniales o morales. No hay obligación de avisar a la autoridad.                                                                                                                              | LFPDPPP art. 19                                                  |
| Evaluación de impacto                       | No es obligatoria para particulares. La autoridad tiene la facultad de elaborar estudios de impacto.                                                                                                                                                                                       | LFPDPPP art. 39 fr. IX                                           |
| Plazos ARCO                                 | 20 días hábiles para responder y 15 para hacerlo efectivo, cada uno ampliable una sola vez por un periodo igual. Gratuito, salvo costos de reproducción, copias o envío.                                                                                                                   | LFPDPPP arts. 2 fr. VIII, 31, 34                                 |
| RGPD (Reglamento (UE) 2016/679)             | Aplica por sí mismo a los titulares en la UE cuando el tratamiento del responsable entra en su ámbito territorial. **Requiere revisión legal** para cada responsable.                                                                                                                      | RGPD                                                             |

El Reglamento de 2011 cita la ley de 2010. Los artículos que más usan estas plantillas se
recorrieron un número:

| Tema                                                  | Ley de 2010 | Ley de 2025 |
| ----------------------------------------------------- | ----------- | ----------- |
| Contenido del aviso de privacidad                     | 16          | 15          |
| Medidas de seguridad, vulneraciones, confidencialidad | 19, 20, 21  | 18, 19, 20  |
| Derechos ARCO                                         | 22–27       | 21–26       |
| Plazos y costos ARCO                                  | 32, 35      | 31, 34      |
| Transferencias                                        | 36–37       | 35–36       |

## Cómo responden las funciones de Audit Hub a las obligaciones

| Obligación                           | Fuente                                                                  | Qué hace Audit Hub                                                                                                                                                                                                                                                                                                                                                 | Dónde se documenta                                                                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medidas de seguridad                 | LFPDPPP art. 18; Reglamento arts. 50 fr. III, 57; RGPD art. 32          | Contraseña y código de una app autenticadora (TOTP) en toda cuenta; reautenticación reciente antes de exportar, de llaves, borrados, retenciones legales, acciones de respuesta, quitar cuentas y terminar un servicio; acceso limitado por aplicación; una cuenta se desactiva al momento cuando su persona se va                                                 | [security.md](../security.md#second-factor-and-recent-authentication), [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                                                                         |
| Integridad de los registros          | LFPDPPP art. 18 ("alteración"); Reglamento art. 48 fr. X (trazabilidad) | Tablas de solo inserción que rechazan toda modificación y borrado; sellos por ventana de tiempo firmados con una llave que no está en la base de datos; verificación diaria que identifica lo modificado                                                                                                                                                           | [database.md](../database.md#audit-hubs-audit-tables), [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                                            |
| Confidencialidad                     | LFPDPPP art. 20; Reglamento art. 50 fr. IV                              | Cada consulta de datos de auditoría es un evento de la bitácora propia; auditores y lectores solo ven las aplicaciones asignadas                                                                                                                                                                                                                                   | [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                                                                                                                                                |
| Conservación y supresión             | LFPDPPP arts. 10, 24                                                    | Depuración dentro de la base de datos, diaria; mínimos por clase (seguridad 730 días, auditoría 365, acceso 180, sistema 30, acceso a auditoría 730, datos personales 90, coordenadas 30); los correos solo como seudónimo con llave; al terminar el servicio, se borra toda la bitácora de la aplicación y la aplicación queda retirada                           | [database.md](../database.md#audit-hubs-audit-tables), [security.md](../security.md#audit-log-integrity-retention-and-erasure), [manual](../manual.es.md#1110-audit-hub-solicitudes-de-privacidad-sus-cuentas-y-el-fin-de-una-aplicación) |
| Acceso (ARCO)                        | LFPDPPP arts. 22, 32; RGPD art. 15                                      | `GET /api/connector/subjects/:subject/export`: todos los eventos del usuario con lo que aún se conserva                                                                                                                                                                                                                                                            | [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                                                                                                                                                |
| Rectificación (ARCO)                 | LFPDPPP art. 23; RGPD art. 16                                           | Los eventos registran hechos y no se rectifican; los datos de perfil, incluidos el nombre y el teléfono, están en la aplicación; Audit Hub guarda identificadores seudónimos, y etiquetas (nombres o correos enmascarados) y teléfonos enmascarados que se borran a los 90 días                                                                                    | [design README](../design/audit-hub/README.md#legal-framework-mexico-plus-the-gdpr)                                                                                                                                                       |
| Cancelación y bloqueo (ARCO)         | LFPDPPP arts. 24, 25; RGPD art. 17                                      | El borrado elimina los datos personales satélite (incluidos nombres, teléfonos enmascarados, client hints y coordenadas) y lo que derivaron las reglas, o también los eventos cuando el responsable los cancela; lo ocurrido hasta el último borrado queda bloqueado: fuera de toda lectura por persona; las retenciones legales conservan lo que un caso necesita | [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                                                                                                   |
| Oposición y tratamiento automatizado | LFPDPPP art. 26 fr. II; RGPD arts. 21, 22                               | Las reglas solo generan alertas; toda acción sobre una persona la pide un humano, con motivo y, por omisión, con la aprobación de un segundo administrador                                                                                                                                                                                                         | [security.md](../security.md#detection-rules), [security.md](../security.md#webhooks-and-response-actions)                                                                                                                                |
| Vulneraciones                        | LFPDPPP art. 19; Reglamento arts. 63–66; RGPD arts. 33, 34              | Procedimientos para ataques, pérdida de datos, fallas de verificación de integridad y permisos excesivos en la base de datos; la verificación identifica por id los registros alterados                                                                                                                                                                            | [incident-response.md](../incident-response.md#11-authentication-or-security-attack), [runbook 20](../incident-response.md#20-audit-log-integrity-verification-failed)                                                                    |
| Remisión a subencargados             | Reglamento arts. 53–55; RGPD art. 28(2), (4)                            | La geolocalización de IP es local: ninguna IP sale de Audit Hub para ello; los correos y mensajes de chat de alertas llevan identificadores, nunca un correo ni una IP; los reportes de errores se depuran                                                                                                                                                         | [ADR 0011](../adr/0011-geolocate-ips-with-an-optional-local-database.md), [security.md](../security.md#detection-rules), [security.md](../security.md#error-tracking-data)                                                                |
| Responsabilidad demostrada           | LFPDPPP art. 13                                                         | Estas plantillas                                                                                                                                                                                                                                                                                                                                                   | Esta carpeta                                                                                                                                                                                                                              |

Los datos, dónde se guardan y por cuánto tiempo están en la
[tabla de privacidad del paquete de diseño](../design/audit-hub/README.md#privacy-at-a-glance).

## Documentos

| Documento                                            | Quién lo usa                                        | Qué es                                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [processor-contract.es.md](processor-contract.es.md) | El responsable y el operador                        | El contrato de encargo, con las medidas de seguridad de Audit Hub y los subencargados posibles                         |
| [privacy-notice.es.md](privacy-notice.es.md)         | Cada responsable                                    | Los párrafos de su aviso de privacidad: integral, simplificado, puntos del RGPD y el consentimiento de ubicación       |
| [impact-assessment.es.md](impact-assessment.es.md)   | Cada responsable, con apoyo del operador            | Una evaluación de impacto en la protección de datos, prellenada para Audit Hub                                         |
| [arco-procedure.es.md](arco-procedure.es.md)         | El departamento de datos personales del responsable | Cómo atender con Audit Hub las solicitudes de acceso, rectificación, cancelación y oposición, con cartas y un registro |

## Antes de usarlas

1. Revise en el DOF si hay un Reglamento o Lineamientos nuevos, y el texto vigente de la ley en
   diputados.gob.mx.
2. Complete cada dato entre [corchetes].
3. Pida al abogado que resuelva cada punto marcado "Requiere revisión legal".
4. Pida al abogado que prepare el texto vinculante en español.
5. Actualice la fecha de cada bloque de estado.

## Fuentes primarias

| Fuente                                               | Dónde                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| LFPDPPP, texto vigente                               | https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf                  |
| Reglamento de la LFPDPPP, DOF 2011-12-21             | https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LFPDPPP.pdf           |
| Lineamientos del Aviso de Privacidad, DOF 2013-01-17 | https://dof.gob.mx/nota_detalle.php?codigo=5284966&fecha=17/01/2013       |
| RGPD, Reglamento (UE) 2016/679                       | https://eur-lex.europa.eu/legal-content/ES/TXT/HTML/?uri=CELEX:32016R0679 |
