# Privacy documentation

Versión en español: [README.es.md](README.es.md).

> Template, not legal advice. Review by counsel before use. Last checked against the law: 2026-10-17.

This folder holds the privacy templates of an Audit Hub deployment: the processor contract, the
paragraphs a connected application adds to its privacy notice, an impact assessment and the ARCO
procedure. They describe what Audit Hub does as this repository documents it, and leave in
[square brackets] what only the operator or the controller can fill in.

- **Templates, not legal advice.** Counsel reviews and adapts every document before it is used.
- **The binding text in Mexico is the Spanish one, prepared by counsel.** The `.es.md` files are
  drafts for that review ("Borrador para revisión legal"). The English files are the reference
  for this repository, whose docs are in English.
- **"Needs legal review"** marks a question the research behind these templates could not settle.
  Keep the mark until counsel has answered it.

## Roles

| Who                                                        | LFPDPPP (Mexico, 2025)                                   | GDPR                   | What it does with Audit Hub                                                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| The owner of each connected application                    | responsable (art. 2 fr. XIV with fr. XVI)                | controller (art. 4(7)) | Decides why its users' security events are logged, sends them through its connector, answers its users' requests |
| Whoever operates the Audit Hub instance                    | persona encargada (art. 2 fr. XII)                       | processor (art. 4(8))  | Stores, seals, analyses and returns the events on the controller's behalf                                        |
| The users of each connected application, and their devices | titulares (art. 2 fr. XVIII)                             | data subjects          | Their sign-ins, account changes and device events are logged                                                     |
| Audit Hub's own users (administrators, auditors, viewers)  | titulares; the operator is their responsable (see below) | data subjects          | Their accounts, and every read of audit data they make, are kept in Audit Hub's own log                          |

- **Remission, not transfer.** What the application sends to the operator is a remisión, not a
  transferencia: a transfer is a communication to someone other than the titular, the responsable
  or the encargado (LFPDPPP art. 2 fr. XX; Reglamento art. 2 fr. IX). A remission needs no notice
  to, or consent of, the titulares (Reglamento art. 53). It does need a contract or another legal
  instrument (Reglamento art. 51): [processor-contract.md](processor-contract.md).
- **The operator may carry duties of its own.** The 2025 law defines "responsable" as any private
  party that "lleva a cabo el tratamiento" (art. 2 fr. XIV with fr. XVI). One law firm reads this
  as covering processors too. **Needs legal review:** which duties of a responsable the operator
  bears directly.
- **Audit Hub's own users.** The operator decides how their accounts are processed (password,
  second factor, sessions, Audit Hub's own log of what they read), so for those data the operator
  acts as responsable and gives those users its own notice: [Privacy notice for Audit Hub's
  users]. Their accounts hold an email address, a name, a role, a password hash and a second
  factor ([security.md](../security.md#second-factor-and-recent-authentication)), and their reads
  are kept 730 days ([database.md](../database.md#audit-hubs-audit-tables)). An administrator
  disables an account, or removes it, keeping only its id for the log
  ([security.md](../security.md#disabling-and-removing-audit-hubs-accounts)). **Needs legal
  review:** the operator's role for accounts given to the controller's own staff (its auditors and
  viewers).
- **Self-hosting.** When the company that owns the application also operates Audit Hub, there is
  no encargado for Audit Hub itself: the encargado is a party "ajena a la organización del
  responsable" (Reglamento art. 49). The company is the responsable for the whole processing, and
  the contract becomes an internal policy (see
  [processor-contract.md](processor-contract.md#self-hosting-the-contract-as-an-internal-policy)).
  Its hosting, email and error-tracking providers are still encargados and need their own
  contracts. A separate company of the same group is a different person: use the contract.
- **Public bodies.** If a connected application belongs to a public body, the public-sector law
  (LGPDPPSO 2025) applies instead, with its own mandatory clauses (its art. 53). These templates do
  not cover it.

## Legal status

| Item                               | Status on 2026-10-17                                                                                                                                                                                                                                                 | Source                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Law                                | Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP), published in the DOF on 2025-03-20, in force since 2025-03-21. It abrogated the 2010 law.                                                                                   | LFPDPPP, Transitorios Primero and Segundo fr. I                |
| Later reform                       | DOF 2025-11-14: changes only art. 4 (supplementary codes). No effect on substantive duties.                                                                                                                                                                          | Decree of 2025-11-14, Artículo Trigésimo Octavo                |
| Regulator                          | Secretaría Anticorrupción y Buen Gobierno. It took over the INAI's data-protection functions.                                                                                                                                                                        | LFPDPPP art. 2 fr. XV, arts. 38–39; Transitorios Cuarto–Octavo |
| Reglamento                         | No Reglamento of the 2025 law found. The 2011 Reglamento is still listed as in force, but no transitorio keeps it in force: whether it applies is **NOT CONFIRMED (needs legal review)**. It cites the 2010 article numbers. Check the DOF for a new one before use. | LFPDPPP art. 2 fr. XIII, Transitorio Décimo Segundo            |
| Privacy-notice Lineamientos (2013) | Issued under the 2010 law. Status under the 2025 law **NOT CONFIRMED (needs legal review)**.                                                                                                                                                                         | DOF 2013-01-17                                                 |
| Contract with the encargado        | The 2025 law has no article on it. The requirements come only from the 2011 Reglamento (arts. 49–55, 57), whose status is not confirmed.                                                                                                                             | Reglamento arts. 49–55, 57                                     |
| Breach notice                      | To titulares, "de forma inmediata", when the breach significantly affects their property or moral rights. No duty to notify the regulator.                                                                                                                           | LFPDPPP art. 19                                                |
| Impact assessment                  | Not required of private parties. The regulator has the power to prepare impact studies.                                                                                                                                                                              | LFPDPPP art. 39 fr. IX                                         |
| ARCO deadlines                     | 20 business days to answer, 15 to carry out, each extendable once by the same period. Free, except reproduction or shipping costs.                                                                                                                                   | LFPDPPP arts. 2 fr. VIII, 31, 34                               |
| GDPR (Regulation (EU) 2016/679)    | Applies on its own terms to data subjects in the EU when the controller's processing falls within its territorial scope. **Needs legal review** for each controller.                                                                                                 | GDPR                                                           |

The 2011 Reglamento cites the 2010 law. The articles these templates use most moved down by one:

| Topic                                        | 2010 law   | 2025 law   |
| -------------------------------------------- | ---------- | ---------- |
| Privacy-notice contents                      | 16         | 15         |
| Security measures, breaches, confidentiality | 19, 20, 21 | 18, 19, 20 |
| ARCO rights                                  | 22–27      | 21–26      |
| ARCO deadlines, costs                        | 32, 35     | 31, 34     |
| Transfers                                    | 36–37      | 35–36      |

## How Audit Hub's features map to the obligations

| Obligation                       | Source                                                                  | What Audit Hub does                                                                                                                                                                                                                                                                                              | Where it is documented                                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security measures                | LFPDPPP art. 18; Reglamento arts. 50 fr. III, 57; GDPR art. 32          | A password and an authenticator code (TOTP) for every account; a fresh step-up before exports, keys, erasure, legal holds, response actions, account removal and the end of a service; access limited by application; an account disabled at once when its person leaves                                         | [security.md](../security.md#second-factor-and-recent-authentication), [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                                                                 |
| Integrity of the records         | LFPDPPP art. 18 ("alteración"); Reglamento art. 48 fr. X (traceability) | Append-only tables that refuse every update and delete; time-window seals signed with a key outside the database; a daily verification that names what changed                                                                                                                                                   | [database.md](../database.md#audit-hubs-audit-tables), [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                                    |
| Confidentiality                  | LFPDPPP art. 20; Reglamento art. 50 fr. IV                              | Every read of audit data is an event of Audit Hub's own log; auditors and viewers see only their assigned applications                                                                                                                                                                                           | [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                                                                                                                                        |
| Retention and deletion           | LFPDPPP arts. 10, 24                                                    | Retention inside the database, daily; minimums per class (security 730 days, audit 365, access 180, system 30, audit access 730, personal data 90, coordinates 30); emails stored only as a keyed pseudonym; at the end of the service, the application's whole log deleted and the application retired          | [database.md](../database.md#audit-hubs-audit-tables), [security.md](../security.md#audit-log-integrity-retention-and-erasure), [manual](../manual.md#1110-audit-hub-privacy-requests-its-accounts-and-the-end-of-an-application) |
| Access (ARCO)                    | LFPDPPP arts. 22, 32; GDPR art. 15                                      | `GET /api/connector/subjects/:subject/export`: every event of the user with what is still kept of it                                                                                                                                                                                                             | [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                                                                                                                                        |
| Rectification (ARCO)             | LFPDPPP art. 23; GDPR art. 16                                           | Events record facts and are not rectified; profile data, the name and the phone included, live in the application; Audit Hub keeps pseudonymous ids, and labels (names or masked emails) and masked phones that expire after 90 days                                                                             | [design README](../design/audit-hub/README.md#legal-framework-mexico-plus-the-gdpr)                                                                                                                                               |
| Cancellation and blocking (ARCO) | LFPDPPP arts. 24, 25; GDPR art. 17                                      | Erasure deletes the personal satellite data (names, masked phones, client hints and coordinates included) and what the rules derived, or the events too once the controller cancels them; what occurred up to the last erasure is blocked: left out of every per-person read; legal holds keep what a case needs | [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                                                                                           |
| Opposition, automated processing | LFPDPPP art. 26 fr. II; GDPR arts. 21, 22                               | Rules only raise alerts; every action on a person is a human's request, with a reason and, by default, a second administrator's approval                                                                                                                                                                         | [security.md](../security.md#detection-rules), [security.md](../security.md#webhooks-and-response-actions)                                                                                                                        |
| Breaches                         | LFPDPPP art. 19; Reglamento arts. 63–66; GDPR arts. 33, 34              | Runbooks for attacks, data loss, failed integrity checks and over-broad database rights; the verification names changed records by id                                                                                                                                                                            | [incident-response.md](../incident-response.md#11-authentication-or-security-attack), [runbook 20](../incident-response.md#20-audit-log-integrity-verification-failed)                                                            |
| Remission to sub-processors      | Reglamento arts. 53–55; GDPR art. 28(2), (4)                            | IP geolocation is local: no IP leaves Audit Hub for it; alert emails and chat messages carry ids, never an email or an IP; error reports are scrubbed                                                                                                                                                            | [ADR 0011](../adr/0011-geolocate-ips-with-an-optional-local-database.md), [security.md](../security.md#detection-rules), [security.md](../security.md#error-tracking-data)                                                        |
| Accountability                   | LFPDPPP art. 13                                                         | These templates                                                                                                                                                                                                                                                                                                  | This folder                                                                                                                                                                                                                       |

The data, where they live and how long, are in the
[privacy table of the design package](../design/audit-hub/README.md#privacy-at-a-glance).

## Documents

| Document                                       | Who uses it                                 | What it is                                                                                                               |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [processor-contract.md](processor-contract.md) | The controller and the operator             | The contract of encargo (data processing agreement), with Audit Hub's security measures and the candidate sub-processors |
| [privacy-notice.md](privacy-notice.md)         | Each controller                             | The paragraphs its privacy notice adds: full notice, simplified notice, GDPR items, the location consent                 |
| [impact-assessment.md](impact-assessment.md)   | Each controller, with the operator's help   | A data protection impact assessment, pre-filled for Audit Hub                                                            |
| [arco-procedure.md](arco-procedure.md)         | The controller's data-protection department | How to handle access, rectification, cancellation and opposition requests with Audit Hub, with letters and a register    |

## Before using them

1. Check the DOF for a new Reglamento or new Lineamientos, and the current text of the law at
   diputados.gob.mx.
2. Fill in every placeholder in [square brackets].
3. Have counsel answer every point marked "Needs legal review".
4. Have counsel prepare the binding Spanish text.
5. Update the date in each status block.

## Primary sources

| Source                                               | Where                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| LFPDPPP, consolidated current text                   | https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf                  |
| Reglamento de la LFPDPPP, DOF 2011-12-21             | https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LFPDPPP.pdf           |
| Lineamientos del Aviso de Privacidad, DOF 2013-01-17 | https://dof.gob.mx/nota_detalle.php?codigo=5284966&fecha=17/01/2013       |
| GDPR, Regulation (EU) 2016/679                       | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 |
