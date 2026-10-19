# Plantilla de contrato de encargo

English version: [processor-contract.md](processor-contract.md).

> **Borrador para revisión legal.** Plantilla, no es asesoría legal. Debe revisarla un abogado
> antes de usarse. Última revisión contra la ley: 2026-10-17.

Contrato para completar entre el titular de una aplicación conectada (el responsable) y el
operador de una instancia de Audit Hub (la persona encargada). Está hecho para cumplir los arts.
49 a 55 y 57 del Reglamento de la LFPDPPP de 2011 y el art. 28(3) del RGPD.

Cómo usarlo:

- Complete cada [dato]. Antes de firmar, borre los párrafos "Nota": explican las fuentes al
  abogado.
- Cada cláusula indica su fuente. "(Contractual)" señala una cláusula sin fuente legal en la ley
  mexicana del sector privado, que se conserva porque la exige el RGPD o porque las partes la
  necesitan.
- **Nota sobre las fuentes.** La LFPDPPP de 2025 no regula las obligaciones de la persona encargada
  ni el contenido de este contrato. Los requisitos vienen solo del Reglamento de 2011, y su
  aplicación con la ley de 2025 **NO ESTÁ CONFIRMADA (requiere revisión legal)**. El Reglamento de
  2011 cita los artículos de la ley de 2010; esta plantilla cita los de la ley de 2025.
- Si la misma empresa es dueña de la aplicación y opera Audit Hub, use la última sección,
  [Autoalojamiento](#autoalojamiento-el-contrato-como-política-interna).

## Partes

- **El Responsable:** [Razón social del responsable], con domicilio en [Domicilio del
  responsable], representado por [Nombre y cargo del representante]. Responsable (LFPDPPP art. 2
  fr. XIV); controller (RGPD art. 4(7)).
- **El Encargado:** [Razón social del operador], con domicilio en [Domicilio del operador],
  representado por [Nombre y cargo del representante]. Persona encargada (LFPDPPP art. 2 fr. XII);
  processor (RGPD art. 4(8)).
- **Contrato relacionado:** [Contrato principal de servicios, su fecha y referencia, o "ninguno"].

Este contrato acredita la existencia, el alcance y el contenido de la relación (Reglamento art. 51)
y debe ser acorde con el aviso de privacidad del Responsable (Reglamento art. 50, último párrafo).

## 1. Definiciones

Se aplican los términos del art. 2 de la LFPDPPP: datos personales (fr. V), datos personales
sensibles (fr. VI), días hábiles (fr. VIII), tratamiento (fr. XIX), titular (fr. XVIII),
transferencia (fr. XX) y bloqueo (fr. III). Además:

| Término                   | Significado                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remisión                  | La comunicación de datos personales entre el Responsable y el Encargado, dentro o fuera de México (Reglamento art. 2 fr. IX)                                                                                                                                                                                                                                                        |
| Supresión                 | La eliminación de los datos una vez concluido el periodo de bloqueo (Reglamento art. 2 fr. XII)                                                                                                                                                                                                                                                                                     |
| Vulneración de seguridad  | La pérdida, destrucción, robo, copia, uso, acceso, daño o alteración no autorizados de datos personales (Reglamento art. 63)                                                                                                                                                                                                                                                        |
| Audit Hub                 | El servicio de bitácora de auditoría que el Encargado opera para el Responsable en [URL de Audit Hub]                                                                                                                                                                                                                                                                               |
| Aplicación                | Cada sistema del Responsable listado en el Anexo 1, conectado a Audit Hub con su conector                                                                                                                                                                                                                                                                                           |
| Evento                    | Un registro de auditoría de seguridad que una Aplicación envía a Audit Hub                                                                                                                                                                                                                                                                                                          |
| Datos personales satélite | Las partes de un evento que se guardan aparte y por menos tiempo: etiquetas (el nombre de la persona, o el correo enmascarado en el origen), teléfono enmascarado, dirección IP, agente de usuario y client hints, id del dispositivo, lugar, valores personales de cambios y coordenadas del dispositivo ([security.md](../security.md#audit-log-integrity-retention-and-erasure)) |
| Retención legal           | Un registro en Audit Hub que impide que la depuración y el borrado eliminen los eventos que coinciden, hasta que se libere ([security.md](../security.md#audit-log-integrity-retention-and-erasure))                                                                                                                                                                                |
| Subencargado              | Un tercero contratado por el Encargado que trata datos personales del Responsable (Anexo 3)                                                                                                                                                                                                                                                                                         |

## 2. Objeto y vigencia

1. El Encargado opera Audit Hub para las Aplicaciones del Anexo 1: recibe, guarda, sella, analiza y
   devuelve sus eventos.
2. Este contrato rige desde [fecha de inicio] hasta [fecha de término, o "el término del contrato
   relacionado"] y, después, durante el periodo de terminación de la cláusula 14.

## 3. Naturaleza y finalidades

1. El tratamiento es automatizado y continuo. Comprende la recepción, el registro, la
   organización, la conservación, la consulta, el análisis, la devolución y la supresión.
2. El Encargado trata los datos únicamente para estas finalidades (Reglamento art. 50 fr. I y II):
   1. **Bitácora de auditoría de seguridad:** recibir y conservar los eventos que envía el conector
      de cada Aplicación ([connection-guide.md](../audit/connection-guide.md#what-the-connector-does)).
   2. **Integridad:** sellar la bitácora y verificarla, para detectar cualquier cambio a un
      registro ([security.md](../security.md#audit-log-integrity-retention-and-erasure)).
   3. **Detección y alertas:** ejecutar las reglas de detección y avisar al Responsable de sus
      alertas por webhook y, cuando el Anexo 1 lo habilite, por correo y chat
      ([security.md](../security.md#detection-rules)).
   4. **Acciones de respuesta a petición del Responsable:** transmitir a una Aplicación la acción
      que pida una persona autorizada (cerrar sesiones, exigir cambio de contraseña, deshabilitar
      una cuenta). El Encargado nunca las decide
      ([security.md](../security.md#webhooks-and-response-actions)).
   5. **Derechos y conservación:** devolver los eventos de un usuario, borrar datos personales,
      mantener retenciones legales y aplicar los plazos de conservación.
   6. **Operación:** respaldos, monitoreo y rastreo de errores necesarios para prestar el
      servicio, dentro del Anexo 3.
3. El Encargado no trata los datos para ninguna otra finalidad. El encargado que lo haga, o que
   transfiera datos en contra de las instrucciones, asume el carácter de responsable (Reglamento
   art. 53).

## 4. Categorías de datos y de titulares

1. **Titulares:**
   - los usuarios de cada Aplicación, incluidas las personas que intentan iniciar sesión o
     recuperar una contraseña con una dirección sin cuenta (de esa dirección solo se guarda un
     seudónimo con llave) ([connection-guide.md](../audit/connection-guide.md#integration-points));
   - sus dispositivos (un id de instalación)
     ([connection-guide.md](../audit/connection-guide.md#the-mobile-app));
   - los usuarios de Audit Hub que consultan los eventos del Responsable, cuyas consultas se
     registran ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)).
2. **Datos**, según el
   [paquete de diseño](../design/audit-hub/README.md#privacy-at-a-glance):

| Datos                                                                                                                                                                                               | Dónde se guardan                              | Conservación (por omisión; puede ampliarse, nunca reducirse)              | Después de un borrado                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Id del usuario en la Aplicación, rol, seudónimo del correo con llave                                                                                                                                | `audit_events`                                | El de su clase: seguridad 730 días, auditoría 365, acceso 180, sistema 30 | Se conservan, seudonimizados                                  |
| Etiquetas (el nombre de la persona, o el correo enmascarado en el origen), teléfono enmascarado (últimos cuatro dígitos), dirección IP, agente de usuario, client hints, id del dispositivo, ciudad | `event_personal`                              | 90 días                                                                   | Se borran, salvo que coincida una retención legal             |
| Coordenadas del dispositivo (consentimiento aparte; redondeadas a 0.01°, o a cinco decimales si la persona permitió la posición precisa)                                                            | `event_locations`                             | 30 días                                                                   | Se borran                                                     |
| País, red (ASN), alcance de la IP, familia del agente de usuario, sistema operativo, modelo del dispositivo                                                                                         | `audit_events`                                | El de su clase                                                            | Se conservan (por sí solos no identifican)                    |
| Valores de campos personales en los cambios                                                                                                                                                         | `event_personal`                              | 90 días                                                                   | Se borran; el evento solo indica que cambió un campo personal |
| Uso de Audit Hub (búsquedas, consultas, exportaciones)                                                                                                                                              | Bitácora propia de Audit Hub (`audit_access`) | 730 días                                                                  | No aplica                                                     |

3. **Datos sensibles.** Audit Hub no está diseñado para recibir datos personales sensibles
   (LFPDPPP art. 2 fr. VI). El catálogo base registra eventos de cuenta y de seguridad
   ([connection-guide.md](../audit/connection-guide.md#integration-points)), y los campos que el
   catálogo marca `sensitive` llegan como `[REDACTED]`
   ([connection-guide.md](../audit/connection-guide.md#your-own-actions)). Ninguno de los datos
   del punto 2 es sensible; el riesgo de la ubicación precisa es mayor, por lo que solo se obtiene
   con su propio consentimiento, al comenzar una sesión, y se conserva 30 días. El Responsable no
   agrega acciones cuyos campos contengan datos sensibles sin avisarlo por escrito al Encargado.

## 5. Instrucciones documentadas

1. Las instrucciones del Responsable son este contrato, el Anexo 1 y cualquier instrucción
   posterior que envíen por escrito las personas del Anexo 4 por [medio para instrucciones]
   (Reglamento art. 50 fr. I; RGPD art. 28(3)(a)).
2. Los ajustes del Anexo 1 son instrucciones: plazos de conservación por Aplicación y clase (nunca
   por debajo de los mínimos), acciones de respuesta aceptadas (ninguna por omisión), aprobación de
   las acciones de respuesta por un segundo administrador (activa por omisión), correlación entre
   aplicaciones (desactivada por omisión) y los canales de correo y chat.
3. El Encargado avisa de inmediato al Responsable si, a su juicio, una instrucción infringe la ley
   aplicable (RGPD art. 28(3)).
4. Si una autoridad ordena al Encargado entregar datos, el Encargado lo avisa al Responsable antes
   de entregarlos, salvo que la ley lo prohíba (Reglamento art. 50 fr. VI, art. 52 fr. II e); RGPD
   art. 28(3)(a)).

## 6. Confidencialidad

1. El Encargado guarda confidencialidad sobre los datos, y esta obligación subsiste al terminar
   el contrato (LFPDPPP art. 20; Reglamento art. 50 fr. IV; RGPD art. 28(3)(b)).
2. Toda persona que interviene en el tratamiento está obligada a la confidencialidad: [convenio o
   política de confidencialidad del Encargado].
3. Dentro de Audit Hub, los administradores ven todas las Aplicaciones, y los auditores y lectores
   solo las asignadas; un evento de otra Aplicación responde como si no existiera
   ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)). Cada consulta de
   datos de auditoría queda en la bitácora propia de Audit Hub.
4. El acceso a los servidores, la base de datos y los respaldos, fuera de las páginas de Audit Hub,
   se limita a [puestos del personal del Encargado con ese acceso].
5. Cuando alguien del personal del Encargado ya no necesita acceso, un administrador desactiva su
   cuenta de Audit Hub (todas sus sesiones terminan a la vez) o la quita (no se conserva nada de
   la persona salvo el id de la cuenta, que la bitácora propia de Audit Hub sigue nombrando)
   ([security.md](../security.md#disabling-and-removing-audit-hubs-accounts)), dentro de [plazo].
6. **Nota.** El art. 62 de la LFPDPPP sanciona con prisión a quien, autorizado para tratar datos,
   con ánimo de lucro provoque una vulneración de seguridad; puede alcanzar al personal del
   Encargado.

## 7. Medidas de seguridad

1. El Encargado mantiene medidas de seguridad administrativas, físicas y técnicas (LFPDPPP art.
   18; Reglamento arts. 50 fr. III, 57; RGPD arts. 28(3)(c), 32). El Anexo 2 las enumera: la parte
   A, los controles integrados en Audit Hub; la parte B, los del propio Encargado.
2. El Encargado puede mejorar las medidas. No las reduce por debajo del Anexo 2 sin aviso por
   escrito al Responsable con [30 días] de anticipación.
3. El Encargado revisa las medidas después de una modificación sustancial del tratamiento y
   después de una vulneración (Reglamento art. 62).

## 8. Subencargados

1. El Responsable autoriza por anticipado a los subencargados del Anexo 3 (Reglamento arts. 54–55;
   RGPD art. 28(2)). Actúan a nombre y por cuenta del Responsable.
2. El Encargado avisa al Responsable [30 días] antes de agregar o sustituir un subencargado. El
   Responsable puede oponerse por escrito dentro de [15 días]; [consecuencia de la oposición: por
   ejemplo, terminación sin penalización].
3. Cada subencargado asume por contrato las mismas obligaciones que el Encargado (Reglamento art.
   54; RGPD art. 28(4)). El Encargado acredita la autorización (Reglamento art. 54) y responde por
   sus subencargados.
4. El Encargado mantiene actualizada la lista del Anexo 3 y a disposición del Responsable
   (Reglamento art. 52 fr. I b)).

## 9. Remisiones y transferencias

1. Las comunicaciones del Responsable al Encargado, y del Encargado a los subencargados del Anexo
   3, son remisiones y no transferencias, dentro o fuera de México (LFPDPPP art. 2 fr. XX;
   Reglamento art. 2 fr. IX). No requieren informarse a los titulares ni su consentimiento
   (Reglamento art. 53).
2. El Encargado no transfiere los datos a terceros, salvo que el Responsable lo determine, que lo
   requiera una subcontratación autorizada conforme a la cláusula 8 o que lo ordene una autoridad
   competente (Reglamento art. 50 fr. VI).
3. Los datos se alojan en [país y región de los servidores y de la base de datos]; los respaldos en
   [país y región de los respaldos]. El Encargado avisa al Responsable [30 días] antes de moverlos.
4. **Nota.** La LFPDPPP no prevé un mecanismo de adecuación ni exige que los datos permanezcan en
   México. Para titulares en la UE, el tratamiento fuera del Espacio Económico Europeo requiere una
   base del capítulo V del RGPD (arts. 44–49): [decisión de adecuación, cláusulas contractuales
   tipo u otra base].
5. **La correlación entre aplicaciones** vincula una dirección o una persona en varias
   Aplicaciones ([connection-guide.md](../audit/connection-guide.md#which-applications-to-register)).
   Solo se habilita entre Aplicaciones del mismo Responsable. **Requiere revisión legal:** entre
   responsables distintos combinaría sus datos, lo que podría ser una transferencia (art. 2 fr. XX).

## 10. Apoyo en el ejercicio de los derechos de los titulares

1. **Nota.** Ni la LFPDPPP ni el Reglamento imponen expresamente a la persona encargada el deber de
   apoyar en las solicitudes ARCO (**NO CONFIRMADO (requiere revisión legal)**). El art. 21 de la
   LFPDPPP exige resguardar los datos de modo que los derechos se ejerzan sin dilación. Esta
   cláusula es contractual y sigue el art. 28(3)(e) del RGPD.
2. El Responsable recibe y responde cada solicitud y acredita la identidad de quien la presenta.
   Audit Hub nunca ve a los solicitantes. Si una solicitud llega al Encargado, este la reenvía al
   Responsable dentro de [2 días hábiles] y no la responde.
3. El Encargado ofrece estas funciones, y las ejecuta él mismo cuando el Responsable lo pide,
   dentro de [5 días hábiles]:

| Derecho                                         | Función de Audit Hub                                                                                                                                                                                                                                                                                                                                                                                                                                      | La ejecuta                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Acceso (LFPDPPP art. 22; RGPD art. 15)          | `GET /api/connector/subjects/:subject/export`: todos los eventos del usuario, con los datos personales satélite que aún se conservan, firmada con la llave de la Aplicación ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api))                                                                                                                                                                                                  | La Aplicación                                                                                      |
| Rectificación (LFPDPPP art. 23; RGPD art. 16)   | Ninguna: los eventos registran hechos y son de solo inserción ([database.md](../database.md#audit-hubs-audit-tables)). La Aplicación rectifica los datos de perfil, incluidos el nombre y el teléfono; Audit Hub guarda identificadores seudónimos, y etiquetas y teléfonos enmascarados que se borran a los 90 días                                                                                                                                      | La Aplicación                                                                                      |
| Cancelación (LFPDPPP arts. 24–25; RGPD art. 17) | `POST /api/connector/subjects/:subject/erasure` (el `AuditErasureService` del conector); un evento de eliminación de cuenta; o el borrado de un administrador en las páginas de administración, previa reautenticación. El alcance `personal` borra los datos personales satélite; el alcance `events`, una vez que el Responsable cancela los datos, borra también los eventos ([security.md](../security.md#audit-log-integrity-retention-and-erasure)) | La Aplicación, o el administrador del Encargado                                                    |
| Bloqueo (LFPDPPP art. 24)                       | Automático desde el primer borrado: las lecturas por persona (la vista del sujeto, una búsqueda por su id o su correo y su exportación, la API de consulta) dejan fuera lo ocurrido hasta su último borrado; las retenciones legales, con la referencia del caso y el motivo, conservan lo que un caso necesita y levantan el bloqueo mientras están activas ([security.md](../security.md#audit-log-integrity-retention-and-erasure))                    | Audit Hub; las retenciones legales, el administrador del Encargado por instrucción del Responsable |
| Oposición (LFPDPPP art. 26; RGPD arts. 21–22)   | Las reglas solo generan alertas; el Responsable elige qué acciones de respuesta acepta cada Aplicación (ninguna por omisión) ([security.md](../security.md#detection-rules))                                                                                                                                                                                                                                                                              | El administrador del Encargado, por instrucción del Responsable                                    |

4. Cada borrado queda en `erasure_runs` y en la bitácora propia de Audit Hub
   ([security.md](../security.md#audit-log-integrity-retention-and-erasure)). El Encargado
   confirma por escrito cada borrado que ejecuta.
5. El Encargado también apoya al Responsable en seguridad, avisos de vulneración y evaluaciones de
   impacto (RGPD art. 28(3)(f)), dentro de [horas o costos, en su caso].

## 11. Vulneraciones de seguridad

1. **Nota.** El Responsable debe informar "de forma inmediata" a los titulares de una vulneración
   que afecte de forma significativa sus derechos patrimoniales o morales (LFPDPPP art. 19). La ley
   de 2025 no obliga a avisar a la autoridad. Ni la ley ni el Reglamento obligan a la persona
   encargada a avisar al responsable (**NO CONFIRMADO (requiere revisión legal)**); el art. 33(2)
   del RGPD sí ("sin dilación indebida"). Esta cláusula es contractual.
2. El Encargado avisa al Responsable de cualquier vulneración de seguridad que afecte datos del
   Responsable **sin dilación indebida y dentro de las 24 horas siguientes a confirmarla**, en
   [contacto del Responsable para vulneraciones]. **Propuesta: las 24 horas deben acordarlas las
   partes y revisarlas el abogado.**
3. El aviso incluye lo que se sepa y se completa conforme se conozca: la naturaleza del incidente;
   los datos y el número de titulares afectados; las consecuencias probables; las acciones
   correctivas inmediatas; las recomendaciones que pueden seguir los titulares, y un contacto para
   más información (según el Reglamento art. 65, cuya vigencia no está confirmada; RGPD arts.
   33–34).
4. El Encargado sigue su procedimiento de incidentes: los de
   [incident-response.md](../incident-response.md#roles-and-contacts), en particular
   [11, ataque](../incident-response.md#11-authentication-or-security-attack),
   [14, pérdida de datos](../incident-response.md#14-data-corruption-or-suspected-data-loss),
   [20, falla de integridad](../incident-response.md#20-audit-log-integrity-verification-failed)
   y [23, permisos en la base de datos](../incident-response.md#23-database-role-can-change-audit-records).
   Conserva la evidencia, analiza las causas (Reglamento art. 66) y comparte el
   [análisis posterior](../incident-response.md#after-the-incident) con el Responsable.
5. El Encargado no avisa por su cuenta a titulares ni a autoridades, salvo que la ley lo exija o
   el Responsable se lo pida.

## 12. Registros

1. El Encargado lleva un registro de los tratamientos que realiza por cuenta del Responsable,
   cuando aplique el art. 30(2) del RGPD.
2. Audit Hub conserva, por Aplicación: los borrados (`erasure_runs`), las retenciones legales y sus
   liberaciones, las exportaciones con su huella, las verificaciones de integridad y cada consulta
   de datos de auditoría
   ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api),
   [database.md](../database.md#audit-hubs-audit-tables)). El Encargado entrega copias al
   Responsable cuando las pida.

## 13. Auditorías

1. **Nota.** La normativa mexicana del sector privado no exige derechos de auditoría. Esta
   cláusula sigue el art. 28(3)(h) del RGPD (contractual).
2. El Encargado pone a disposición del Responsable la información necesaria para demostrar que
   cumple este contrato y permite auditorías del Responsable o de un auditor que designe:
   [frecuencia], con aviso de [30 días], a [cargo del Responsable], bajo confidencialidad.
3. El Encargado envía al Responsable, por [medio], las huellas de los puntos de control diarios de
   sus Aplicaciones. Guardadas fuera de Audit Hub, permiten detectar una cadena de sellos
   reconstruida ([security.md](../security.md#audit-log-integrity-retention-and-erasure)).

## 14. Terminación del servicio

1. **Exportación.** Durante [30 días] después del término, el Responsable puede exportar sus
   eventos: desde las páginas de administración (CSV o JSON Lines, sin datos personales, hasta
   100,000 filas por exportación, cada una con su huella SHA-256;
   [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)), o en una
   exportación de la bitácora de cada Aplicación por periodo que el Encargado genera con
   `audit export` y el Responsable puede verificar sin conexión con `audit verify-export`
   ([procedimiento 20](../incident-response.md#20-audit-log-integrity-verification-failed)).
   Esa exportación contiene, de cada evento, sus propias columnas tal como se calcula su huella
   (identificadores, fechas, acción, resultado, identificadores del actor y del recurso, los
   seudónimos del correo, los detalles, el cambio, los metadatos de la solicitud y del cliente, las
   huellas de sus datos personales pero nunca esos datos), su huella de contenido, y los sellos del
   periodo con sus hojas; una última línea da el SHA-256 del conjunto.
   **Nota.** La devolución de los datos es contractual: el Reglamento solo la exige para servicios
   de cómputo en la nube ("que este último haya podido recuperarlos", art. 52 fr. II d)).
2. **Llaves.** El Encargado suspende las Aplicaciones el [fecha de término], para que no se acepte
   ningún evento nuevo.
3. **Supresión.** Después, el Encargado suprime los datos, salvo que una disposición legal exija
   conservarlos (Reglamento art. 50 fr. V; RGPD art. 28(3)(g)), con la terminación del servicio de
   Audit Hub: de cada Aplicación, toda su bitácora, luego lo que Audit Hub derivó de ella (alertas,
   acciones de respuesta, lo que recuerdan las reglas, sus llaves), y la Aplicación queda retirada
   ([manual](../manual.es.md#1110-audit-hub-solicitudes-de-privacidad-sus-cuentas-y-el-fin-de-una-aplicación)).
   El borrado corre dentro de la función de la propia base de datos, por lo que la verificación
   diaria sigue pasando: los sellos conservan sus huellas y sus conteos, y los registros del
   borrado dicen cuántos eventos perdió cada sello
   ([security.md](../security.md#audit-log-integrity-retention-and-erasure)). Lo que conserva una
   retención legal no se borra (punto 6). Audit Hub registra el borrado (`hub.app.deleted`, con el
   número de eventos) en su bitácora propia. Con una instancia exclusiva para el Responsable, las
   partes pueden acordar en su lugar eliminar la instancia con su base de datos y sus respaldos:
   [método].
4. **Respaldos.** Los datos suprimidos permanecen en los respaldos hasta que estos expiran:
   [conservación de los respaldos]
   ([disaster-recovery.md](../disaster-recovery.md#backup-strategy)).
5. **Constancia.** El Encargado confirma la supresión por escrito dentro de los [10 días hábiles]
   siguientes a concluirla.
6. **Retenciones legales.** Los datos bajo una retención legal se conservan, bloqueados, hasta que
   el Responsable la libere o concluya el plazo legal (LFPDPPP art. 2 fr. III).

## 15. Responsabilidad

1. Los titulares que sufran un daño por el incumplimiento de la ley por parte del responsable o de
   la persona encargada pueden reclamar una indemnización (LFPDPPP art. 53).
2. El Encargado que use los datos para otras finalidades, o los transfiera en contra de las
   instrucciones, asume el carácter de responsable (Reglamento art. 53).
3. [Límites de responsabilidad, indemnizaciones y seguros que acuerden las partes.]

## 16. Ley aplicable y controversias

1. Este contrato se rige por [ley aplicable, por ejemplo las leyes federales de México].
2. Las controversias se resuelven ante [tribunales o arbitraje, y el lugar].
3. Cuando aplique el RGPD, las cláusulas que cumplen su art. 28(3) siguen vigentes sea cual sea la
   ley aplicable.

## 17. Modificaciones y avisos

1. Las modificaciones a este contrato se hacen por escrito y las firman ambas partes.
2. Los avisos se dirigen a los contactos del Anexo 4.

Firmado en [lugar] el [fecha].

| Por el Responsable     | Por el Encargado       |
| ---------------------- | ---------------------- |
| [Nombre, cargo, firma] | [Nombre, cargo, firma] |

## Anexo 1. Aplicaciones y ajustes

Una fila por Aplicación y entorno
([connection-guide.md](../audit/connection-guide.md#which-applications-to-register)).

| Ajuste                                    | Por omisión                                                                                                                                                                                                    | Valor para [slug de la Aplicación]                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Aplicación y entorno                      | Una por backend y entorno                                                                                                                                                                                      | [slug, entorno]                                               |
| Acciones agregadas al catálogo base       | Ninguna                                                                                                                                                                                                        | [lista, o "ninguna"]                                          |
| Etiqueta y teléfono del actor             | El nombre de la persona cuando la Aplicación lo pasa, y si no, el correo enmascarado en el origen; el teléfono, enmascarado a sus últimos cuatro dígitos, solo cuando pasa uno                                 | [nombre o correo enmascarado; teléfono enmascarado o ninguno] |
| Plazos de conservación                    | Los mínimos: seguridad 730 días, auditoría 365, acceso 180, sistema 30, datos personales 90, coordenadas 30                                                                                                    | [plazos mayores, en su caso]                                  |
| Ubicación del dispositivo en la app móvil | Desactivada; solo con el consentimiento aparte del usuario, aproximada o, si la persona lo permite en el diálogo del teléfono, precisa ([connection-guide.md](../audit/connection-guide.md#location-optional)) | [activada o desactivada]                                      |
| Acciones de respuesta aceptadas           | Ninguna ([security.md](../security.md#webhooks-and-response-actions))                                                                                                                                          | [ninguna, o la lista]                                         |
| Aprobación de un segundo administrador    | Activa                                                                                                                                                                                                         | [activa o no]                                                 |
| Correlación entre aplicaciones            | Desactivada                                                                                                                                                                                                    | [activada o no, y con qué Aplicaciones]                       |
| Correos de alerta                         | A los administradores y a los auditores asignados a la Aplicación, desde severidad alta                                                                                                                        | [sí o no]                                                     |
| Canales de chat                           | Desactivados ([environment.md](../environment.md#api-variables))                                                                                                                                               | [Slack, Teams o ninguno]                                      |
| Notificaciones push "¿Fue usted?"         | Desactivadas; es un ajuste de la propia Aplicación ([connection-guide.md](../audit/connection-guide.md#push-notifications))                                                                                    | [sí o no]                                                     |

## Anexo 2. Medidas de seguridad

### Parte A. Controles integrados en Audit Hub

| Medida                                   | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Dónde se documenta                                                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segundo factor en toda cuenta            | Contraseña y código TOTP de una app autenticadora; cada código sirve una vez; 10 códigos de recuperación, cada uno una vez; el secreto, cifrado con `AUDIT_SECRETS_KEY`                                                                                                                                                                                                                                                                                                                                                                                                          | [security.md](../security.md#second-factor-and-recent-authentication), [ADR 0012](../adr/0012-require-totp-and-recent-authentication.md)                        |
| Reautenticación reciente                 | Exportaciones, llaves y secretos de webhooks, acciones de respuesta, retenciones legales, plazos de conservación, roles y asignaciones, desactivar y quitar cuentas, borrados, la terminación del servicio de una aplicación y reinicios del segundo factor exigen contraseña y un código nuevo dentro de 5 minutos                                                                                                                                                                                                                                                              | [security.md](../security.md#second-factor-and-recent-authentication)                                                                                           |
| Contraseñas                              | De 15 a 200 caracteres, sin reglas de composición, rechazo de las más usadas, argon2id                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [security.md](../security.md#passwords)                                                                                                                         |
| Sesiones                                 | Tokens de acceso de 15 minutos en memoria; tokens de renovación rotativos con detección de reúso; un cambio de contraseña termina todo acceso de inmediato                                                                                                                                                                                                                                                                                                                                                                                                                       | [security.md](../security.md#authentication-and-tokens)                                                                                                         |
| Acceso por rol y aplicación              | Roles `member`, `viewer`, `auditor`, `admin`; auditores y lectores solo ven sus aplicaciones asignadas; lo demás responde 404                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [security.md](../security.md#authorization), [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                         |
| Bitácora de solo inserción               | Un trigger rechaza toda modificación y borrado en las tablas de auditoría, incluso del dueño; el rol de la API en la base de datos no puede cambiarlas; sus permisos se revisan al arrancar y generan alerta                                                                                                                                                                                                                                                                                                                                                                     | [database.md](../database.md#audit-hubs-audit-tables)                                                                                                           |
| Sellos de integridad                     | Una huella de contenido por evento; cada flujo se sella cada minuto por ventanas de tiempo, encadenadas y firmadas con `AUDIT_INTEGRITY_KEY`; verificación y punto de control diarios; las fallas generan una alerta urgente                                                                                                                                                                                                                                                                                                                                                     | [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                         |
| Depuración en la base de datos           | Diaria, por aplicación y clase, nunca por debajo de los mínimos, nunca antes de sellar un registro, nunca lo que coincide con una retención legal; si se detiene, genera alerta                                                                                                                                                                                                                                                                                                                                                                                                  | [security.md](../security.md#audit-log-integrity-retention-and-erasure), [database.md](../database.md#audit-hubs-audit-tables)                                  |
| Borrado y bloqueo                        | Datos personales, o también los eventos, borrados dentro de la base de datos, nunca lo que conserva una retención legal; desde el primer borrado el usuario queda bloqueado: las lecturas por persona dejan fuera lo ocurrido hasta su último borrado                                                                                                                                                                                                                                                                                                                            | [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                         |
| Terminación del servicio                 | Toda la bitácora de una aplicación suspendida se borra dentro de la base de datos, y luego lo derivado de ella; la aplicación queda retirada, sin llaves; la verificación sigue pasando                                                                                                                                                                                                                                                                                                                                                                                          | [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                         |
| Cuentas que se van                       | Desactivar cierra todas las sesiones a la vez; quitar conserva solo el id de la cuenta; nunca la propia ni la del último administrador                                                                                                                                                                                                                                                                                                                                                                                                                                           | [security.md](../security.md#disabling-and-removing-audit-hubs-accounts)                                                                                        |
| Minimización                             | El correo nunca se guarda, solo un seudónimo con llave; las etiquetas son el nombre de la persona o el correo enmascarado en el origen; teléfonos enmascarados en el origen a sus últimos cuatro dígitos, cualquier otro se rechaza; campos sensibles ocultos en el origen; datos de red y dispositivo, incluidos los client hints, aparte, 90 días; coordenadas solo con consentimiento, al comenzar una sesión, nunca en segundo plano: redondeadas a 0.01° en el teléfono, o a cinco decimales de una sola posición nueva si la persona permitió la posición precisa; 30 días | [security.md](../security.md#audit-log-integrity-retention-and-erasure), [connection-guide.md](../audit/connection-guide.md#location-optional)                  |
| Recepción firmada                        | Cada Aplicación envía lotes firmados con su propia llave; Audit Hub nunca se conecta a la base de datos de una Aplicación                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [connection-guide.md](../audit/connection-guide.md#what-the-connector-does), [connection-guide.md](../audit/connection-guide.md#which-applications-to-register) |
| Auditoría de los auditores               | Cada búsqueda, consulta, exportación y llamada a la API de consulta es un evento de la bitácora propia, sellado y conservado 730 días; las reglas lo leen                                                                                                                                                                                                                                                                                                                                                                                                                        | [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                                                                      |
| Exportaciones                            | Solo administradores y auditores, previa reautenticación; sin datos personales; fórmulas de hoja de cálculo neutralizadas; se guarda una huella SHA-256                                                                                                                                                                                                                                                                                                                                                                                                                          | [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                                                                      |
| Alertas sin identificadores              | Las alertas, correos y mensajes de chat llevan ids, conteos, países y señales, nunca un correo ni una IP                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [security.md](../security.md#detection-rules)                                                                                                                   |
| Webhooks                                 | Firmados; destinos revisados contra direcciones privadas después de resolver el DNS; sin redirecciones; https en producción                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [security.md](../security.md#webhooks-and-response-actions)                                                                                                     |
| Acciones de respuesta                    | Desactivadas por omisión en tres lugares; solo administradores; con motivo; aprobación de un segundo administrador por omisión; las solicitudes caducan                                                                                                                                                                                                                                                                                                                                                                                                                          | [security.md](../security.md#webhooks-and-response-actions), [ADR 0013](../adr/0013-deliver-webhooks-and-response-actions-through-an-outbox.md)                 |
| Geolocalización de IP local              | Consultas en archivos locales; ninguna IP sale de Audit Hub para ello                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | [security.md](../security.md#ip-geolocation-data), [ADR 0011](../adr/0011-geolocate-ips-with-an-optional-local-database.md)                                     |
| Secretos                                 | Llaves de las aplicaciones, secretos de webhooks, llaves de seudonimización y segundos factores, cifrados con `AUDIT_SECRETS_KEY`; la llave de integridad nunca está en la base de datos ni en sus respaldos                                                                                                                                                                                                                                                                                                                                                                     | [environment.md](../environment.md#api-variables), [security.md](../security.md#secret-rotation)                                                                |
| Bitácoras técnicas y reportes de errores | Credenciales ocultas automáticamente; no se registran cuerpos, encabezados ni parámetros de consulta; los reportes de errores llevan solo el contexto explícito                                                                                                                                                                                                                                                                                                                                                                                                                  | [security.md](../security.md#logging), [security.md](../security.md#error-tracking-data)                                                                        |
| Límites de frecuencia                    | Por IP del cliente y por ruta; inicio de sesión y segundo factor, 10 por minuto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [security.md](../security.md#rate-limiting)                                                                                                                     |

### Parte B. Medidas propias del Encargado

| Medida                                                                    | Valor                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Hospedaje, seguridad física                                               | [Proveedor de hospedaje, región, certificaciones]                                                                                    |
| HTTPS y HSTS en el borde                                                  | [Configuración] ([security.md](../security.md#https))                                                                                |
| Cifrado en reposo de la base de datos y los respaldos                     | [Método y gestión de llaves] ([disaster-recovery.md](../disaster-recovery.md#backup-strategy))                                       |
| Respaldos                                                                 | [Frecuencia, conservación, ubicación, protección contra borrado] ([disaster-recovery.md](../disaster-recovery.md#backup-strategy))   |
| Personal con acceso a servidores o a la base de datos                     | [Puestos, cómo se otorga y revisa el acceso, segundo factor]                                                                         |
| Dónde se guardan las huellas de los puntos de control, fuera de Audit Hub | [Lugar]                                                                                                                              |
| Conservación y acceso a las bitácoras técnicas                            | [Plazo, quién puede leerlas] (contienen IPs de clientes e ids de usuarios: [security.md](../security.md#secrets))                    |
| Funciones y contactos ante incidentes                                     | [Tabla completada] ([incident-response.md](../incident-response.md#roles-and-contacts))                                              |
| Capacitación y convenios de confidencialidad                              | [Descripción]                                                                                                                        |
| Gestión de vulnerabilidades                                               | Análisis de dependencias e imágenes en CI ([security.md](../security.md#controls-by-owasp-top-10-2021-category)); [pruebas externas] |

## Anexo 3. Subencargados

Complete los que se usen y borre los demás. Cada servicio opcional está desactivado hasta que se
configura.

| Subencargado                                          | Servicio                                                         | Se activa con                                                             | Qué recibe                                                                                                                                                                                                                                                                                                    | Ubicación      |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| [Proveedor de hospedaje]                              | Servidores (VPS) y base de datos                                 | Siempre                                                                   | Todo lo que guarda Audit Hub                                                                                                                                                                                                                                                                                  | [País, región] |
| [Proveedor de almacenamiento de respaldos]            | Respaldos de la base de datos                                    | Siempre ([disaster-recovery.md](../disaster-recovery.md#backup-strategy)) | Copias completas de la base de datos, incluidos datos personales borrados después de hacer una copia, hasta que esta expira                                                                                                                                                                                   | [País, región] |
| [Proveedor de correo (SMTP)]                          | Correos de alertas y de cuenta para los usuarios de Audit Hub    | `MAIL_SMTP_URL` ([security.md](../security.md#email))                     | Los correos de los usuarios de Audit Hub que los reciben; los correos de alerta llevan solo ids y la regla ([security.md](../security.md#detection-rules)), nunca un correo ni una IP de los usuarios de la Aplicación                                                                                        | [País, región] |
| [Servicio de rastreo de errores, Sentry o compatible] | Reportes de errores de la API y de las páginas de administración | `SENTRY_DSN`, `WEB_SENTRY_DSN`                                            | El error, su traza, id de solicitud, método, patrón de ruta, estado, un id de usuario opaco, entorno y versión; en el navegador, la ruta de la página sin parámetros; depurados antes de enviarse ([security.md](../security.md#error-tracking-data), [observability.md](../observability.md#error-tracking)) | [País, región] |
| [Servicio de OpenTelemetry]                           | Métricas y trazas                                                | `OTEL_EXPORTER_OTLP_ENDPOINT`                                             | Métricas sin usuarios (a lo más el slug de la aplicación); spans con atributos depurados; un span de servidor puede llevar la IP y el agente de usuario de quien llama ([security.md](../security.md#web-vitals), [observability.md](../observability.md#opentelemetry)). Ninguno si el colector es propio    | [País, región] |
| [Plataforma de bitácoras técnicas]                    | Recolección de las bitácoras del servicio                        | La configuración de la plataforma                                         | Líneas de acceso con método, ruta, estado, duración, IP e id de usuario de quien llama; sin cuerpos, por lo tanto sin el contenido de los eventos ([observability.md](../observability.md#logs), [security.md](../security.md#secrets))                                                                       | [País, región] |
| [Servicio de chat: Slack o Microsoft Teams]           | Mensajes de alerta                                               | `AUDIT_SLACK_WEBHOOK_URL`, `AUDIT_TEAMS_WEBHOOK_URL`                      | La Aplicación, la regla, la severidad y un enlace; nunca un correo ni una IP ([ADR 0013](../adr/0013-deliver-webhooks-and-response-actions-through-an-outbox.md))                                                                                                                                             | [País, región] |
| [Proveedor de Redis administrado]                     | Límites de frecuencia compartidos, caché y bloqueos              | `REDIS_URL` ([security.md](../security.md#redis))                         | Contadores de límites de frecuencia por IP del cliente ([security.md](../security.md#rate-limiting)); ningún dato de sesión ni de autorización                                                                                                                                                                | [País, región] |

No son subencargados:

- **La base de datos de geolocalización de IP** (se recomienda DB-IP Lite) es un archivo que el
  Encargado descarga; ninguna IP sale de Audit Hub para una consulta. Donde se muestre una ubicación
  obtenida de ella, "IP Geolocation by DB-IP" enlaza a https://db-ip.com
  ([ADR 0011](../adr/0011-geolocate-ips-with-an-optional-local-database.md)).
- **El servicio de notificaciones push** que lleva el "¿Fue usted?" a los teléfonos lo llama la API
  de la propia Aplicación, no Audit Hub
  ([connection-guide.md](../audit/connection-guide.md#push-notifications)). Es proveedor del
  Responsable.

## Anexo 4. Contactos

| Función                                                            | Contacto                 |
| ------------------------------------------------------------------ | ------------------------ |
| Personas que pueden dar instrucciones por el Responsable           | [Nombres, cargos, medio] |
| Departamento de datos personales del Responsable (LFPDPPP art. 29) | [Departamento, medio]    |
| Contacto del Responsable para vulneraciones                        | [Medio, horario]         |
| Contacto de seguridad del Encargado                                | [Medio, horario]         |
| Contacto del Encargado para solicitudes de derechos                | [Medio]                  |

## Autoalojamiento: el contrato como política interna

Si la empresa dueña de las Aplicaciones también opera Audit Hub, no hay persona encargada para
Audit Hub (Reglamento art. 49: el encargado es "ajena a la organización del responsable"). Use esta
plantilla como política interna:

1. Sustituya a las partes por el departamento de datos personales (LFPDPPP art. 29) y el equipo que
   opera Audit Hub, y las firmas por la aprobación de [órgano que aprueba].
2. Las cláusulas 3 a 7 y 10 a 14 aplican tal cual, con "el equipo" en lugar de "el Encargado":
   finalidades, confidencialidad, medidas de seguridad, apoyo con solicitudes, aviso de
   vulneraciones al departamento de datos personales en el mismo plazo, fin del uso.
3. La cláusula 8 y el Anexo 3 siguen aplicando: los proveedores de hospedaje, respaldos, correo,
   rastreo de errores y chat son encargados de la empresa y requieren su propio contrato.
4. Cláusula 9: el hospedaje en el extranjero es una remisión a esos proveedores; la nota del RGPD
   aplica igual.
5. Las cláusulas 15 y 16 no aplican; rigen las normas internas de la empresa y la ley.
