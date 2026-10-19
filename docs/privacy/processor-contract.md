# Processor contract template (contrato de encargo)

Versión en español: [processor-contract.es.md](processor-contract.es.md).

> Template, not legal advice. Review by counsel before use. Last checked against the law: 2026-10-17.

A fill-in agreement between the owner of a connected application (the controller, "responsable")
and the operator of an Audit Hub instance (the processor, "persona encargada"). It is built to meet
the 2011 Reglamento de la LFPDPPP, arts. 49–55 and 57, and GDPR art. 28(3).

How to use it:

- Fill in every [placeholder]. Delete the "Note" paragraphs before signing; they explain the
  sources to counsel.
- Each clause names its source. "(contractual)" marks a clause with no legal source in Mexico's
  private-sector law, kept because the GDPR requires it or because the parties need it.
- **Note on the sources.** The 2025 LFPDPPP has no article on the encargado's duties or on the
  content of this contract. The requirements come only from the 2011 Reglamento, and whether it
  still applies under the 2025 law is **NOT CONFIRMED (needs legal review)**. The 2011 Reglamento
  cites the 2010 article numbers; this template cites the 2025 law's.
- When the same company owns the application and operates Audit Hub, use the last section,
  [Self-hosting](#self-hosting-the-contract-as-an-internal-policy).

## Parties

- **The Controller:** [Controller's legal name], with its address at [Controller's address],
  represented by [Representative's name and position]. Responsable (LFPDPPP art. 2 fr. XIV);
  controller (GDPR art. 4(7)).
- **The Processor:** [Operator's legal name], with its address at [Operator's address],
  represented by [Representative's name and position]. Persona encargada (LFPDPPP art. 2 fr. XII);
  processor (GDPR art. 4(8)).
- **Related agreement:** [Main service agreement, its date and reference, or "none"].

This contract proves the existence, scope and content of the relationship (Reglamento art. 51)
and must agree with the Controller's privacy notice (Reglamento art. 50, last paragraph).

## 1. Definitions

The terms of LFPDPPP art. 2 apply: personal data (fr. V), sensitive personal data (fr. VI),
business days (fr. VIII), processing (fr. XIX), titular (fr. XVIII), transfer (fr. XX) and
blocking (fr. III). Also:

| Term                    | Meaning                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remission               | A communication of personal data between the Controller and the Processor, inside or outside Mexico (Reglamento art. 2 fr. IX)                                                                                                                                                                                                              |
| Deletion (supresión)    | Erasing the data once the blocking period ends (Reglamento art. 2 fr. XII)                                                                                                                                                                                                                                                                  |
| Security breach         | Loss, destruction, theft, copy, use, access, damage or alteration of personal data without authorisation (Reglamento art. 63)                                                                                                                                                                                                               |
| Audit Hub               | The audit-log service the Processor operates for the Controller at [Audit Hub URL]                                                                                                                                                                                                                                                          |
| Application             | Each of the Controller's systems listed in Annex 1, connected to Audit Hub through its connector                                                                                                                                                                                                                                            |
| Event                   | A security audit record an Application sends to Audit Hub                                                                                                                                                                                                                                                                                   |
| Personal satellite data | The parts of an event kept apart from it with a shorter retention: labels (the person's name, or the email masked at the origin), the masked phone, IP address, user agent and client hints, device id, place, personal values of changes, and device coordinates ([security.md](../security.md#audit-log-integrity-retention-and-erasure)) |
| Legal hold              | A record in Audit Hub that keeps matching events from retention and erasure until released ([security.md](../security.md#audit-log-integrity-retention-and-erasure))                                                                                                                                                                        |
| Sub-processor           | A third party the Processor engages that processes the Controller's personal data (Annex 3)                                                                                                                                                                                                                                                 |

## 2. Subject matter and duration

1. The Processor runs Audit Hub for the Applications in Annex 1: it receives, stores, seals,
   analyses and returns their events.
2. This contract runs from [start date] until [end date, or "the end of the related agreement"],
   and then for the end-of-service period of clause 14.

## 3. Nature and purposes

1. The processing is automated and continuous. Its operations are reception, recording,
   organisation, storage, consultation, analysis, return and deletion.
2. The Processor processes the data only for these purposes (Reglamento art. 50 fr. I and II):
   1. **Security audit logging:** receiving and keeping the events each Application's connector
      sends ([connection-guide.md](../audit/connection-guide.md#what-the-connector-does)).
   2. **Integrity:** sealing the log and verifying it, so that a change to a record is detected
      ([security.md](../security.md#audit-log-integrity-retention-and-erasure)).
   3. **Detection and alerts:** running the detection rules and notifying the Controller of
      their alerts by webhook and, where Annex 1 enables them, by email and chat
      ([security.md](../security.md#detection-rules)).
   4. **Response actions on the Controller's request:** passing to an Application an action that
      an authorised person requests (close sessions, require a password change, disable an
      account). The Processor never decides them
      ([security.md](../security.md#webhooks-and-response-actions)).
   5. **Rights and retention:** returning a user's events, erasing personal data, keeping legal
      holds and applying retention.
   6. **Operation:** backups, monitoring and error tracking needed to run the service, within
      Annex 3.
3. The Processor does not process the data for any other purpose. A processor that does so, or
   that transfers data against instructions, becomes a responsable (Reglamento art. 53).

## 4. Categories of data and of data subjects

1. **Data subjects:**
   - the users of each Application, including people who try to sign in or recover a password
     with an address that has no account (only a keyed pseudonym of that address is kept)
     ([connection-guide.md](../audit/connection-guide.md#integration-points));
   - their devices (an installation id) ([connection-guide.md](../audit/connection-guide.md#the-mobile-app));
   - Audit Hub's own users who read the Controller's events, whose reads are recorded
     ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)).
2. **Data**, as listed in the
   [design package](../design/audit-hub/README.md#privacy-at-a-glance):

| Data                                                                                                                                                  | Where it is kept                     | Retention (default; it can be extended, never shortened)            | After an erasure                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------- |
| The Application's user id, role, keyed pseudonym of the email                                                                                         | `audit_events`                       | The category's: security 730 days, audit 365, access 180, system 30 | Kept, pseudonymous                                    |
| Labels (the person's name, or the email masked at the origin), masked phone (last four digits), IP address, user agent, client hints, device id, city | `event_personal`                     | 90 days                                                             | Deleted, unless a legal hold matches                  |
| Device coordinates (separate consent; rounded to 0.01°, or to five decimals when the person allowed the precise position)                             | `event_locations`                    | 30 days                                                             | Deleted                                               |
| Country, network (ASN), IP scope, user-agent family, OS, device model                                                                                 | `audit_events`                       | The category's                                                      | Kept (not identifying on their own)                   |
| Values of personal fields in changes                                                                                                                  | `event_personal`                     | 90 days                                                             | Deleted; the event only says a personal field changed |
| Use of Audit Hub (searches, details, exports)                                                                                                         | Audit Hub's own log (`audit_access`) | 730 days                                                            | Not applicable                                        |

3. **Sensitive data.** Audit Hub is not designed to receive sensitive personal data (LFPDPPP
   art. 2 fr. VI). The base catalog records account and security events
   ([connection-guide.md](../audit/connection-guide.md#integration-points)), and fields the
   catalog marks `sensitive` arrive as `[REDACTED]`
   ([connection-guide.md](../audit/connection-guide.md#your-own-actions)). None of the data of
   point 2 is sensitive; the precise location's risk is higher, so it is collected only with its
   own consent, when a session starts, and kept 30 days. The Controller does not add actions whose
   fields carry sensitive data without telling the Processor in writing.

## 5. Documented instructions

1. The Controller's instructions are this contract, Annex 1, and any later instruction sent in
   writing by the people listed in Annex 4 through [instruction channel] (Reglamento art. 50 fr.
   I; GDPR art. 28(3)(a)).
2. The settings in Annex 1 are instructions: retention policies per Application and class (never
   below the minimums), the response actions accepted (none by default), the approval of response
   actions by a second administrator (on by default), cross-application correlation (off by
   default), and the email and chat channels.
3. The Processor tells the Controller at once if, in its opinion, an instruction breaks the
   applicable law (GDPR art. 28(3)).
4. If an authority orders the Processor to disclose data, the Processor tells the Controller
   before disclosing them, unless the law forbids it (Reglamento art. 50 fr. VI, art. 52 fr. II
   e); GDPR art. 28(3)(a)).

## 6. Confidentiality

1. The Processor keeps the data confidential, and this duty survives the end of the contract
   (LFPDPPP art. 20; Reglamento art. 50 fr. IV; GDPR art. 28(3)(b)).
2. Every person who takes part in the processing is bound by confidentiality: [the Processor's
   confidentiality agreement or policy].
3. Inside Audit Hub, administrators see every Application, and auditors and viewers only the
   ones assigned to them; an event of another Application answers as if it did not exist
   ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)). Every read of
   audit data is recorded in Audit Hub's own log.
4. Access to the servers, the database and the backups, outside Audit Hub's pages, is limited to
   [roles of the Processor's staff with such access].
5. When someone of the Processor's staff no longer needs access, an administrator disables their
   Audit Hub account (every session ends at once) or removes it (nothing of the person is kept
   but the account's id, which Audit Hub's own log still names)
   ([security.md](../security.md#disabling-and-removing-audit-hubs-accounts)), within [period].
6. **Note.** LFPDPPP art. 62 punishes with prison anyone authorised to process data who causes a
   breach for profit; it can reach the Processor's staff.

## 7. Security measures

1. The Processor maintains administrative, physical and technical security measures (LFPDPPP
   art. 18; Reglamento arts. 50 fr. III, 57; GDPR arts. 28(3)(c), 32). Annex 2 lists them: part A
   the controls built into Audit Hub, part B the Processor's own.
2. The Processor may improve the measures. It does not lower them below Annex 2 without
   [30 days'] written notice to the Controller.
3. The Processor reviews the measures after a substantial change in the processing and after a
   breach (Reglamento art. 62).

## 8. Sub-processors

1. The Controller authorises the sub-processors of Annex 3 in advance (Reglamento arts. 54–55;
   GDPR art. 28(2)). They act in the Controller's name and on its behalf.
2. The Processor tells the Controller [30 days] before adding or replacing a sub-processor. The
   Controller may object in writing within [15 days]; [consequence of an objection: for example
   termination without penalty].
3. Each sub-processor takes on, by contract, the same duties as the Processor (Reglamento art. 54;
   GDPR art. 28(4)). The Processor proves the authorisation (Reglamento art. 54) and answers for
   its sub-processors.
4. The Processor keeps the list of Annex 3 current and available to the Controller (Reglamento
   art. 52 fr. I b)).

## 9. Remissions and transfers

1. The communications from the Controller to the Processor, and from the Processor to the
   sub-processors of Annex 3, are remissions, not transfers, inside or outside Mexico (LFPDPPP
   art. 2 fr. XX; Reglamento art. 2 fr. IX). They need no notice to the titulares nor their
   consent (Reglamento art. 53).
2. The Processor does not transfer the data to third parties, except when the Controller
   instructs it, when a subcontract authorised under clause 8 requires it, or when a competent
   authority orders it (Reglamento art. 50 fr. VI).
3. The data are hosted in [country and region of the servers and the database]; the backups in
   [country and region of the backups]. The Processor tells the Controller [30 days] before moving
   them.
4. **Note.** The LFPDPPP has no adequacy test and no data-localisation rule. For data subjects in
   the EU, a processing outside the European Economic Area needs a basis under GDPR Chapter V
   (arts. 44–49): [adequacy decision, standard contractual clauses or another basis].
5. **Cross-application correlation** links one address or person across Applications
   ([connection-guide.md](../audit/connection-guide.md#which-applications-to-register)). It is
   enabled only between Applications of the same Controller. **Needs legal review:** between
   different controllers it would combine their data, which may be a transfer (art. 2 fr. XX).

## 10. Assistance with the titulares' rights

1. **Note.** Neither the LFPDPPP nor the Reglamento gives the encargado an express duty to help
   with ARCO requests (**NOT CONFIRMED (needs legal review)**). LFPDPPP art. 21 requires data to
   be kept so the rights can be exercised without delay. This clause is contractual and follows
   GDPR art. 28(3)(e).
2. The Controller receives and answers every request and verifies the requester's identity.
   Audit Hub never sees the requesters. If a request reaches the Processor, it forwards it to the
   Controller within [2 business days] and does not answer it.
3. The Processor provides these functions, and runs them itself when the Controller asks, within
   [5 business days]:

| Right                                            | Audit Hub function                                                                                                                                                                                                                                                                                                                                                                                  | Run by                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Access (LFPDPPP art. 22; GDPR art. 15)           | `GET /api/connector/subjects/:subject/export`: every event of the user, with the personal satellite data still kept, signed with the Application's key ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api))                                                                                                                                                                 | The Application                                                                          |
| Rectification (LFPDPPP art. 23; GDPR art. 16)    | None: events record facts and are append-only ([database.md](../database.md#audit-hubs-audit-tables)). The Application rectifies profile data, the name and the phone included; Audit Hub keeps pseudonymous ids, and labels and masked phones that expire after 90 days                                                                                                                            | The Application                                                                          |
| Cancellation (LFPDPPP arts. 24–25; GDPR art. 17) | `POST /api/connector/subjects/:subject/erasure` (the connector's `AuditErasureService`); an account-deletion event; or an administrator's erasure in the admin pages, after a step-up. Scope `personal` deletes the personal satellite data; scope `events`, once the Controller cancels the data, deletes the events too ([security.md](../security.md#audit-log-integrity-retention-and-erasure)) | The Application, or the Processor's administrator                                        |
| Blocking (LFPDPPP art. 24)                       | Automatic from the first erasure: the per-person reads (the subject's view, a search by id or email and its export, the query API) answer nothing of the user; legal holds, with the case reference and the reason, keep what a case needs and lift the block while active ([security.md](../security.md#audit-log-integrity-retention-and-erasure))                                                | Audit Hub; legal holds by the Processor's administrator, on the Controller's instruction |
| Opposition (LFPDPPP art. 26; GDPR arts. 21–22)   | Rules only raise alerts; the Controller chooses which response actions an Application accepts (none by default) ([security.md](../security.md#detection-rules))                                                                                                                                                                                                                                     | The Processor's administrator, on the Controller's instruction                           |

4. Each erasure is recorded in `erasure_runs` and in Audit Hub's own log
   ([security.md](../security.md#audit-log-integrity-retention-and-erasure)). The Processor
   confirms each erasure it runs in writing.
5. The Processor also helps the Controller with security, breach notices and impact assessments
   (GDPR art. 28(3)(f)), within [hours or fees, if any].

## 11. Security breaches

1. **Note.** The Controller must inform the titulares "de forma inmediata" of a breach that
   significantly affects their property or moral rights (LFPDPPP art. 19). The 2025 law has no
   duty to notify the regulator. Neither the law nor the Reglamento obliges the encargado to
   notify the responsable (**NOT CONFIRMED (needs legal review)**); GDPR art. 33(2) does ("without
   undue delay"). This clause is contractual.
2. The Processor notifies the Controller of any security breach affecting the Controller's data
   **without undue delay and within 24 hours of confirming it**, at [Controller's breach contact].
   **Proposal: the 24 hours are to be agreed by the parties and reviewed by counsel.**
3. The notice includes what is known, completed as it is learned: the nature of the incident;
   the data and the number of titulares affected; the likely consequences; the measures taken at
   once; recommendations the titulares can follow; and a contact for more information
   (following Reglamento art. 65, status not confirmed; GDPR arts. 33–34).
4. The Processor follows its incident procedure: the runbooks of
   [incident-response.md](../incident-response.md#roles-and-contacts), in particular
   [11, attack](../incident-response.md#11-authentication-or-security-attack),
   [14, data loss](../incident-response.md#14-data-corruption-or-suspected-data-loss),
   [20, integrity check failed](../incident-response.md#20-audit-log-integrity-verification-failed)
   and [23, database rights](../incident-response.md#23-database-role-can-change-audit-records).
   It keeps the evidence and analyses the causes (Reglamento art. 66), and shares the
   [postmortem](../incident-response.md#after-the-incident) with the Controller.
5. The Processor does not notify titulares or authorities on its own, unless the law requires it
   or the Controller asks it to.

## 12. Records

1. The Processor keeps a record of the processing it carries out for the Controller, where GDPR
   art. 30(2) applies.
2. Audit Hub keeps, for each Application: the erasures (`erasure_runs`), the legal holds and their
   releases, the exports with their digests, the integrity verifications, and every read of audit
   data ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api),
   [database.md](../database.md#audit-hubs-audit-tables)). The Processor gives the Controller
   copies on request.

## 13. Audits

1. **Note.** Mexico's private-sector texts do not require audit rights. This clause follows GDPR
   art. 28(3)(h) (contractual).
2. The Processor gives the Controller the information needed to show it meets this contract, and
   allows audits by the Controller or an auditor it appoints: [frequency], with [30 days'] notice,
   at [the Controller's cost], under confidentiality.
3. The Processor sends the Controller the daily checkpoint digests of its Applications through
   [channel]. Kept outside Audit Hub, they let the Controller detect a rebuilt chain of seals
   ([security.md](../security.md#audit-log-integrity-retention-and-erasure)).

## 14. End of service

1. **Export.** During [30 days] after the end, the Controller may export its events: from the
   admin pages (CSV or JSON Lines, without personal data, up to 100,000 rows per export, each with
   its SHA-256 digest; [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)),
   or as an export of each Application's log by period that the Processor produces with
   `audit export` and the Controller can check offline with `audit verify-export`
   ([runbook 20](../incident-response.md#20-audit-log-integrity-verification-failed)).
   That export holds, for each event, its own columns as they are hashed (ids, times, action,
   outcome, actor and resource ids, the email pseudonyms, details, the change, request and client
   metadata, the digests of its personal data but never those data), its content hash, and the
   seals of the period with their leaves; a last line gives the SHA-256 of the whole.
   **Note.** Returning the data is contractual: the Reglamento requires return only for cloud
   services ("que este último haya podido recuperarlos", art. 52 fr. II d)).
2. **Keys.** The Processor suspends the Applications on [end date], so no new event is accepted.
3. **Deletion.** The Processor then deletes the data, unless a legal provision requires keeping
   them (Reglamento art. 50 fr. V; GDPR art. 28(3)(g)), with Audit Hub's end of service: for each
   Application, its whole audit log, then what Audit Hub derived from it (alerts, response
   actions, what the rules remember, its keys), and the Application is retired
   ([manual](../manual.md#1110-audit-hub-privacy-requests-its-accounts-and-the-end-of-an-application)).
   The deletion runs inside the database's own function, so the daily verification still passes:
   the seals keep their digests and counts, and the records of the deletion say how many events
   each seal lost ([security.md](../security.md#audit-log-integrity-retention-and-erasure)). What a
   legal hold keeps is not deleted (point 6). Audit Hub records the deletion (`hub.app.deleted`,
   with the number of events) in its own log. With a dedicated instance for the Controller, the
   parties may agree instead to delete the instance with its database and backups: [method].
4. **Backups.** Deleted data remain in backups until those expire: [backup retention]
   ([disaster-recovery.md](../disaster-recovery.md#backup-strategy)).
5. **Certificate.** The Processor confirms the deletion in writing within [10 business days] of
   completing it.
6. **Legal holds.** Data under a legal hold are kept, blocked, until the Controller releases the
   hold or the legal period ends (LFPDPPP art. 2 fr. III).

## 15. Liability

1. Titulares harmed by a breach of the law by the responsable or the persona encargada may claim
   compensation (LFPDPPP art. 53).
2. A Processor that uses the data for other purposes, or transfers them against instructions,
   becomes a responsable (Reglamento art. 53).
3. [Limits of liability, indemnities and insurance agreed by the parties.]

## 16. Governing law and disputes

1. This contract is governed by [governing law, for example the federal laws of Mexico].
2. Disputes go to [courts or arbitration, and the place].
3. When the GDPR applies, the clauses that implement GDPR art. 28(3) stay in force whatever the
   governing law.

## 17. Changes and notices

1. Changes to this contract are made in writing and signed by both parties.
2. Notices go to the contacts of Annex 4.

Signed in [place] on [date].

| For the Controller          | For the Processor           |
| --------------------------- | --------------------------- |
| [Name, position, signature] | [Name, position, signature] |

## Annex 1. Applications and settings

One row per Application and environment
([connection-guide.md](../audit/connection-guide.md#which-applications-to-register)).

| Setting                           | Default                                                                                                                                                                                         | Value for [Application slug]                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Application and environment       | One per backend and environment                                                                                                                                                                 | [slug, environment]                          |
| Actions added to the base catalog | None                                                                                                                                                                                            | [list, or "none"]                            |
| Actor's label and phone           | The person's name when the Application passes it, else the email masked at the origin; the phone, masked to its last four digits, only when it passes one                                       | [name or masked email; masked phone or none] |
| Retention policies                | The minimums: security 730 days, audit 365, access 180, system 30, personal data 90, coordinates 30                                                                                             | [longer periods, if any]                     |
| Device location in the mobile app | Off; on only with the user's separate consent, approximate or, when the person allows it in the phone's dialog, precise ([connection-guide.md](../audit/connection-guide.md#location-optional)) | [on or off]                                  |
| Response actions accepted         | None ([security.md](../security.md#webhooks-and-response-actions))                                                                                                                              | [none, or the list]                          |
| Second administrator's approval   | On                                                                                                                                                                                              | [on or off]                                  |
| Cross-application correlation     | Off                                                                                                                                                                                             | [on or off, and with which Applications]     |
| Alert emails                      | To the administrators and to the auditors assigned to the Application, from high severity                                                                                                       | [on or off]                                  |
| Chat channels                     | Off ([environment.md](../environment.md#api-variables))                                                                                                                                         | [Slack, Teams or none]                       |
| "Was it you?" push notifications  | Off; the Application's own setting ([connection-guide.md](../audit/connection-guide.md#push-notifications))                                                                                     | [on or off]                                  |

## Annex 2. Security measures

### Part A. Controls built into Audit Hub

| Measure                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Where it is documented                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Second factor for every account | A password and a TOTP code from an authenticator app; codes work once; 10 recovery codes, each once; the secret sealed with `AUDIT_SECRETS_KEY`                                                                                                                                                                                                                                                                                                                                                                       | [security.md](../security.md#second-factor-and-recent-authentication), [ADR 0012](../adr/0012-require-totp-and-recent-authentication.md)                        |
| Recent authentication (step-up) | Exports, keys and webhook secrets, response actions, legal holds, retention policies, roles and assignments, disabling and removing accounts, erasure, the end of an application's service and second-factor resets need the password and a fresh code within 5 minutes                                                                                                                                                                                                                                               | [security.md](../security.md#second-factor-and-recent-authentication)                                                                                           |
| Passwords                       | 15 to 200 characters, no composition rules, the most used passwords refused, argon2id                                                                                                                                                                                                                                                                                                                                                                                                                                 | [security.md](../security.md#passwords)                                                                                                                         |
| Sessions                        | 15-minute access tokens held in memory; rotating refresh tokens with reuse detection; a password change ends every access at once                                                                                                                                                                                                                                                                                                                                                                                     | [security.md](../security.md#authentication-and-tokens)                                                                                                         |
| Access by role and application  | Roles `member`, `viewer`, `auditor`, `admin`; auditors and viewers see only their assigned applications; anything else answers 404                                                                                                                                                                                                                                                                                                                                                                                    | [security.md](../security.md#authorization), [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                         |
| Append-only log                 | A trigger refuses every update and delete on the audit tables, the owner's included; the API's database role cannot change them; its rights are checked at boot and alert                                                                                                                                                                                                                                                                                                                                             | [database.md](../database.md#audit-hubs-audit-tables)                                                                                                           |
| Integrity seals                 | A content hash per event; each stream sealed every minute in time windows, chained and signed with `AUDIT_INTEGRITY_KEY`; a daily verification and a daily checkpoint; failures page                                                                                                                                                                                                                                                                                                                                  | [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                         |
| Retention in the database       | Daily, per application and class, never below the minimums, never before a record is sealed, never what a legal hold matches; a stopped job alerts                                                                                                                                                                                                                                                                                                                                                                    | [security.md](../security.md#audit-log-integrity-retention-and-erasure), [database.md](../database.md#audit-hubs-audit-tables)                                  |
| Erasure and blocking            | Personal data, or the events too, deleted inside the database, never what a legal hold keeps; from the first erasure the user is blocked: the per-person reads answer nothing of them                                                                                                                                                                                                                                                                                                                                 | [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                         |
| End of service                  | A suspended application's whole log deleted inside the database, then what was derived from it; the application retired, its keys gone; the verification still passes                                                                                                                                                                                                                                                                                                                                                 | [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                         |
| Accounts that leave             | Disabling ends every session at once; removal keeps only the account's id; never one's own account or the last administrator                                                                                                                                                                                                                                                                                                                                                                                          | [security.md](../security.md#disabling-and-removing-audit-hubs-accounts)                                                                                        |
| Data minimisation               | Emails never stored, only a keyed pseudonym; labels are the person's name or the email masked at the origin; phones masked at the origin to their last four digits, any other refused; sensitive fields redacted at the origin; network and device data, client hints included, kept apart, 90 days; coordinates only with consent, when a session starts, never in the background: rounded to 0.01° on the device, or to five decimals from one fresh fix when the person allowed the precise position; kept 30 days | [security.md](../security.md#audit-log-integrity-retention-and-erasure), [connection-guide.md](../audit/connection-guide.md#location-optional)                  |
| Signed ingestion                | Each Application sends signed batches with its own key; Audit Hub never connects to an Application's database                                                                                                                                                                                                                                                                                                                                                                                                         | [connection-guide.md](../audit/connection-guide.md#what-the-connector-does), [connection-guide.md](../audit/connection-guide.md#which-applications-to-register) |
| Audit of the auditors           | Every search, view, export and query-API call is an event of Audit Hub's own log, sealed and kept 730 days; the rules read it                                                                                                                                                                                                                                                                                                                                                                                         | [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                                                                      |
| Exports                         | Administrators and auditors only, after a step-up; no personal data; spreadsheet formulas neutralised; a SHA-256 digest kept                                                                                                                                                                                                                                                                                                                                                                                          | [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)                                                                                      |
| Alerts without identifiers      | Alerts, emails and chat messages carry ids, counts, countries and signals, never an email or an IP                                                                                                                                                                                                                                                                                                                                                                                                                    | [security.md](../security.md#detection-rules)                                                                                                                   |
| Webhooks                        | Signed; destinations checked against private addresses after DNS resolution; no redirects; https in production                                                                                                                                                                                                                                                                                                                                                                                                        | [security.md](../security.md#webhooks-and-response-actions)                                                                                                     |
| Response actions                | Off by default in three places; administrators only; a reason; a second administrator's approval by default; requests expire                                                                                                                                                                                                                                                                                                                                                                                          | [security.md](../security.md#webhooks-and-response-actions), [ADR 0013](../adr/0013-deliver-webhooks-and-response-actions-through-an-outbox.md)                 |
| Local IP geolocation            | Lookups in local files; no IP leaves Audit Hub for them                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [security.md](../security.md#ip-geolocation-data), [ADR 0011](../adr/0011-geolocate-ips-with-an-optional-local-database.md)                                     |
| Secrets                         | Application keys, webhook secrets, pseudonymisation keys and second factors encrypted with `AUDIT_SECRETS_KEY`; the integrity key never in the database or its backups                                                                                                                                                                                                                                                                                                                                                | [environment.md](../environment.md#api-variables), [security.md](../security.md#secret-rotation)                                                                |
| Logs and error reports          | Credentials redacted automatically; no bodies, headers or query strings logged; error reports with explicit context only                                                                                                                                                                                                                                                                                                                                                                                              | [security.md](../security.md#logging), [security.md](../security.md#error-tracking-data)                                                                        |
| Rate limits                     | Per client IP and per route; sign-in and second-factor routes 10 a minute                                                                                                                                                                                                                                                                                                                                                                                                                                             | [security.md](../security.md#rate-limiting)                                                                                                                     |

### Part B. The Processor's own measures

| Measure                                                  | Value                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Hosting, physical security                               | [Hosting provider, region, certifications]                                                                                   |
| HTTPS and HSTS at the edge                               | [Configuration] ([security.md](../security.md#https))                                                                        |
| Encryption at rest of the database and backups           | [Method and key management] ([disaster-recovery.md](../disaster-recovery.md#backup-strategy))                                |
| Backups                                                  | [Frequency, retention, location, deletion protection] ([disaster-recovery.md](../disaster-recovery.md#backup-strategy))      |
| Staff with server or database access                     | [Roles, how access is granted and reviewed, second factor]                                                                   |
| Where the checkpoint digests are kept, outside Audit Hub | [Place]                                                                                                                      |
| Log retention and access                                 | [Period, who can read them] (logs hold client IPs and user ids: [security.md](../security.md#secrets))                       |
| Incident roles and contacts                              | [Table filled in] ([incident-response.md](../incident-response.md#roles-and-contacts))                                       |
| Training and confidentiality agreements                  | [Description]                                                                                                                |
| Vulnerability management                                 | Dependency and image scanning in CI ([security.md](../security.md#controls-by-owasp-top-10-2021-category)); [external tests] |

## Annex 3. Sub-processors

Fill in the ones in use and delete the others. Each optional service is off until configured.

| Sub-processor                                  | Service                                               | Enabled by                                                               | What it receives                                                                                                                                                                                                                                                                             | Location          |
| ---------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| [Hosting provider]                             | Servers (VPS) and the database                        | Always                                                                   | Everything Audit Hub stores                                                                                                                                                                                                                                                                  | [Country, region] |
| [Backup storage provider]                      | Database backups                                      | Always ([disaster-recovery.md](../disaster-recovery.md#backup-strategy)) | Full copies of the database, including personal data erased after a copy was made, until it expires                                                                                                                                                                                          | [Country, region] |
| [Email (SMTP) provider]                        | Alert emails and account emails for Audit Hub's users | `MAIL_SMTP_URL` ([security.md](../security.md#email))                    | The email addresses of Audit Hub's users who receive them; alert emails carry ids and the rule only ([security.md](../security.md#detection-rules)), never an email or an IP of the Application's users                                                                                      | [Country, region] |
| [Error-tracking service, Sentry or compatible] | Error reports of the API and the admin pages          | `SENTRY_DSN`, `WEB_SENTRY_DSN`                                           | The error, its stack, request id, method, route pattern, status, an opaque user id, environment and release; in the browser the page path without query; scrubbed before sending ([security.md](../security.md#error-tracking-data), [observability.md](../observability.md#error-tracking)) | [Country, region] |
| [OpenTelemetry backend]                        | Metrics and traces                                    | `OTEL_EXPORTER_OTLP_ENDPOINT`                                            | Metrics without users (the application's slug at most); spans with redacted attributes; a server span may carry the caller's IP and user agent ([security.md](../security.md#web-vitals), [observability.md](../observability.md#opentelemetry)). None if the collector is self-hosted       | [Country, region] |
| [Log platform]                                 | Collection of the service's logs                      | The platform's configuration                                             | Access-log lines with method, path, status, duration, the caller's IP and user id; no bodies, so no event content ([observability.md](../observability.md#logs), [security.md](../security.md#secrets))                                                                                      | [Country, region] |
| [Chat service: Slack or Microsoft Teams]       | Alert messages                                        | `AUDIT_SLACK_WEBHOOK_URL`, `AUDIT_TEAMS_WEBHOOK_URL`                     | The Application, the rule, the severity and a link; never an email or an IP ([ADR 0013](../adr/0013-deliver-webhooks-and-response-actions-through-an-outbox.md))                                                                                                                             | [Country, region] |
| [Managed Redis provider]                       | Shared rate limits, cache and locks                   | `REDIS_URL` ([security.md](../security.md#redis))                        | Rate-limit counters per client IP ([security.md](../security.md#rate-limiting)); no session or authorisation data                                                                                                                                                                            | [Country, region] |

Not sub-processors:

- **The IP geolocation database** (DB-IP Lite recommended) is a file the Processor downloads; no
  IP leaves Audit Hub for a lookup. Wherever a location derived from it is shown, "IP
  Geolocation by DB-IP" links to https://db-ip.com
  ([ADR 0011](../adr/0011-geolocate-ips-with-an-optional-local-database.md)).
- **The push service** that delivers "Was it you?" to phones is called by the Application's own
  API, not by Audit Hub ([connection-guide.md](../audit/connection-guide.md#push-notifications)).
  It is the Controller's own provider.

## Annex 4. Contacts

| Role                                                      | Contact                     |
| --------------------------------------------------------- | --------------------------- |
| People who may give instructions for the Controller       | [Names, positions, channel] |
| Controller's data-protection department (LFPDPPP art. 29) | [Department, channel]       |
| Controller's breach contact                               | [Channel, available hours]  |
| Processor's security contact                              | [Channel, available hours]  |
| Processor's contact for rights requests                   | [Channel]                   |

## Self-hosting: the contract as an internal policy

When the company that owns the Applications also operates Audit Hub, there is no persona encargada
for Audit Hub itself (Reglamento art. 49: the encargado is "ajena a la organización del
responsable"). Use this template as an internal policy:

1. Replace the parties with the data-protection department (LFPDPPP art. 29) and the team that
   runs Audit Hub, and the signatures with the approval of [the approving body].
2. Clauses 3 to 7 and 10 to 14 apply as they are, with "the team" in place of "the Processor":
   purposes, confidentiality, security measures, help with requests, breach notice to the
   data-protection department within the same period, end of use.
3. Clause 8 and Annex 3 still apply: the hosting, backup, email, error-tracking and chat providers
   are encargados of the company and need their own contracts.
4. Clause 9: hosting abroad is a remission to those providers; the GDPR note applies the same.
5. Clauses 15 and 16 do not apply; the company's internal rules and the law apply instead.
