# ARCO procedure with Audit Hub

Versión en español: [arco-procedure.es.md](arco-procedure.es.md).

> Template, not legal advice. Review by counsel before use. Last checked against the law: 2026-10-17.

The procedure the controller's data-protection department follows when a user of a connected
application exercises a right of access, rectification, cancellation or opposition (ARCO), and
what to do in Audit Hub for each. The department is the one the controller designates to handle
requests (LFPDPPP art. 29): [Name of the department].

## Who does what

| Who                                           | Does                                                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The data-protection department                | Receives, registers and decides each request; answers the titular; keeps the register                                                                                                                              |
| The application (its team)                    | Verifies the requester's identity, finds the user id, calls Audit Hub's query API, deletes or corrects profile data in the application                                                                             |
| The operator of Audit Hub (persona encargada) | Runs what the application cannot run itself (an erasure from the admin pages, a legal hold), within the contract's period ([processor-contract.md](processor-contract.md#10-assistance-with-the-titulares-rights)) |

**Audit Hub never sees the requesters.** It knows a person only by the application's user id
(`:subject` in its routes), and answers only the application's signed requests and its own
administrators ([contract.md](../design/audit-hub/contract.md#query-api-for-applications-audit-hub-signed)).
A request sent to the operator is forwarded to the department, not answered.

## Steps

1. Receive the request through a channel of the privacy notice (LFPDPPP art. 15 fr. V).
2. Register it with the date of receipt (register below).
3. Check that it contains what LFPDPPP art. 28 requires; if not, ask once for what is missing.
4. Verify the identity of the titular or the representative, through the application.
5. Find the user id in the application.
6. Decide, and send the decision within the deadline.
7. Carry out the decision, in the application and in Audit Hub.
8. Tell the titular it was carried out, and close the register entry.

## 1. Receive

- **Channels:** the ones in the privacy notice: [Data-protection department's email address],
  [Other channel]. The channels must be free; a paid service cannot be the only way to file a
  request (LFPDPPP art. 34; Reglamento art. 93).
- **Contents** (LFPDPPP art. 28): I. name, and an address or other means to answer; II. documents
  proving identity or representation; III. a clear description of the data, except for access;
  IV. the right exercised; V. anything that helps find the data. A rectification also states the
  changes and attaches the documents that support them (LFPDPPP art. 30).
- **Missing information:** ask for it once, within 5 business days; the titular has 10 business
  days to answer, or the request is treated as not filed; the deadline starts again the day after
  the answer (Reglamento art. 96, status not confirmed).
- **Cost:** free; only reproduction, copies or shipping may be charged; free if the titular
  provides the medium. A repeat request within 12 months may cost up to three UMA, unless the
  notice changed substantially (LFPDPPP art. 34).

## 2. Verify the identity

This is the application's job: Audit Hub cannot do it.

- Accept an ID document, an electronic means the application already uses to authenticate the
  user, or an advanced electronic signature; a representative shows a public instrument or a power
  of attorney signed before two witnesses (Reglamento art. 89, status not confirmed).
- For a signed-in user, the application's own authentication may serve: [Criteria the department
  accepts].
- Access is delivered only after the identity is proven (LFPDPPP art. 31).
- Then find the **user id** in the application: it is the `:subject` of Audit Hub's routes
  ([contract.md](../design/audit-hub/contract.md#query-api-for-applications-audit-hub-signed)).
  If the person has no account, Audit Hub holds at most a keyed pseudonym of the address they used
  ([connection-guide.md](../audit/connection-guide.md#integration-points)); Audit Hub's explorer
  can filter by an email address or an IP, and an export keeps such a filter only as `(given)`
  ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)).

## 3. Register the date

The deadline runs from the day the request is received, and the receipt must show that date
(LFPDPPP art. 31; Reglamento art. 95). Business days count, not calendar days (LFPDPPP art. 2 fr.
VIII). Calendar of non-business days: [Calendar the department uses].

## 4. Deadlines

| Step                            | LFPDPPP                                                                                                                                          | GDPR (users in the EU)                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Answer with the decision        | 20 business days from receipt (art. 31)                                                                                                          | Without undue delay, within one month of receipt (art. 12(3))                                    |
| Carry out a favourable decision | 15 business days from the answer (art. 31)                                                                                                       | Within the same month                                                                            |
| Extension                       | Each period once, by the same length, when the case justifies it (art. 31); the reasons notified within the original period (Reglamento art. 97) | By two further months where necessary, telling the requester within the first month (art. 12(3)) |
| Longest case                    | 40 + 30 = 70 business days                                                                                                                       | Three months                                                                                     |

When both laws apply, work to the shorter deadline. The operator's part, under the contract:
[5 business days] ([processor-contract.md](processor-contract.md#10-assistance-with-the-titulares-rights)).

## 5. Each right in Audit Hub

### Access

The titular has the right to the data and to the conditions of their processing (LFPDPPP art.
22; GDPR art. 15).

1. The application calls `GET /api/connector/subjects/:subject/export?cursor`, signed with its
   key: every event of the user, with the personal satellite data still kept (the name or masked
   label, the masked phone, IP address, user agent and client hints, device id, place, and
   coordinates, precise or approximate), 100 a page
   ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api),
   [contract.md](../design/audit-hub/contract.md#query-api-for-applications-audit-hub-signed)).
   Follow the cursor until the last page.
2. Or an administrator or an auditor opens the user's page in the admin pages,
   `/apps/:app/actors/:id`: what the user did and what was done to them
   ([manual.md](../manual.md#118-audit-hub-the-admin-pages)).
3. Do not use the explorer's exports for this: they carry no personal data (no IP, user agent,
   client hints, label or phone)
   ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)).
4. Add what the application itself keeps for the connector: events still queued (`audit_outbox`),
   "Was it you?" prompts (7 days) and push tokens
   ([connection-guide.md](../audit/connection-guide.md#webhooks-was-it-you-and-the-accounts-activity),
   [connection-guide.md](../audit/connection-guide.md#push-notifications)).
5. Deliver the data in a legible form, explaining codes and abbreviations (Reglamento art. 98),
   by the means set in the notice (LFPDPPP art. 32). Add the attribution "IP Geolocation by
   DB-IP" where places derived from it are shown
   ([ADR 0011](../adr/0011-geolocate-ips-with-an-optional-local-database.md)).

Each call to the query API is recorded in Audit Hub's own log.

### Rectification

The right applies to data that are inaccurate, incomplete or out of date (LFPDPPP art. 23; GDPR
art. 16).

- **Audit events record facts and are not rectified.** An event says what the application
  observed at a moment: who signed in, from which address, with what result. It stays accurate as
  a record of that moment even if the person's data change later. The tables are append-only and
  sealed: changing a record would make the log worthless as evidence, and the daily verification
  would report it ([database.md](../database.md#audit-hubs-audit-tables),
  [security.md](../security.md#audit-log-integrity-retention-and-erasure)).
- **Profile data live in the application.** The application rectifies the name, the email, the
  phone or any other profile field there. Audit Hub keeps no profile: only pseudonymous ids, the
  keyed pseudonym of the email and, as they were at each event, the person's name or masked label
  and the masked phone, deleted after 90 days; events after the correction carry the corrected
  name ([design README](../design/audit-hub/README.md#legal-framework-mexico-plus-the-gdpr)).
- **An event shown to be wrong** (for example, attributed to the wrong account): the application
  records a new event of its own catalog that states the correction
  ([connection-guide.md](../audit/connection-guide.md#your-own-actions)); the original stays.
  **Needs legal review:** whether this meets LFPDPPP art. 23 and GDPR art. 16.
- Answer the titular with what was corrected in the application and why the log is not changed.

### Cancellation

Cancellation leads to a blocking period, then deletion; the blocking period equals the limitation
period of the actions arising from the legal relationship, under the law that governs it, and the
titular is told once the data are cancelled (LFPDPPP art. 24; art. 2 fr. III).

1. **Check whether something must be kept.** The controller is not obliged to cancel when, among
   other cases, the data must be processed by legal provision (LFPDPPP art. 25 fr. II), or
   cancelling them would obstruct proceedings on tax obligations, the investigation of crimes or
   administrative sanctions (art. 25 fr. III); it may refuse when a legal impediment or an
   authority's resolution prevents it (art. 33 fr. IV). Check the legal holds that match the user:
   they keep what they match from erasure until released
   ([security.md](../security.md#audit-log-integrity-retention-and-erasure)); the admin pages show
   them with the retention policies ([manual.md](../manual.md#118-audit-hub-the-admin-pages)).
2. **Run the erasure**, one of:
   - the account is deleted in the application: its deletion event (`account.user.deleted`)
     erases the user's personal data in Audit Hub when it arrives, even if Audit Hub was down at
     that moment ([security.md](../security.md#detection-rules),
     [contract.md](../design/audit-hub/contract.md#query-api-for-applications-audit-hub-signed));
   - the account stays: the application calls its connector's
     `AuditErasureService.erase(userId)` (`POST /api/connector/subjects/:subject/erasure`,
     signed) ([connection-guide.md](../audit/connection-guide.md#a-users-data-erasure-and-blocking));
   - or an administrator erases from the user's page in the admin pages, after a step-up
     (`POST /api/connected-apps/:appId/subjects/:subject/erasure`).
3. **What it does.** It deletes the personal satellite rows of every event where the user is the
   actor or the resource (the person's name or masked labels, the masked phone, IP address, user
   agent and client hints, device id, place, personal values of changes, and coordinates, precise
   or approximate) and what the rules derived of them (their devices, countries, last
   sign-in and place), except what a legal hold keeps. The events remain, pseudonymous, and
   **blocked**: what occurred up to the erasure is left out of every per-person read (the user's
   page, a search by their id or email, its export, the query API) and is not processed for them
   ([security.md](../security.md#audit-log-integrity-retention-and-erasure)). Each erasure is
   recorded in `erasure_runs` and in Audit Hub's own log. Record the run in the register.
4. **In the application:** the push tokens are deleted with the user
   ([connection-guide.md](../audit/connection-guide.md#push-notifications)). Events still in the
   application's queue (`audit_outbox`) reach Audit Hub later, in order: one that occurred before
   the erasure loses its personal data when Audit Hub's rules read it, and is blocked like the
   rest. If the account stays, its new events are new data, recorded and shown as the notice says.
5. **At the end of the blocking period:** the suppression. Ask Audit Hub to delete the events too:
   `AuditErasureService.erase(userId, 'events')`, or the scope "Their events too" on the user's
   page. The sealed ones go at once, the rest within a day once sealed; what a legal hold keeps
   stays. Without it, retention deletes them at the end of their class's period. Record it in the
   register.
6. **Backups:** erased data remain in the backups until they expire: [backup retention]. After a
   restore, the erasures requested after the recovery point are run again from this register
   ([disaster-recovery.md](../disaster-recovery.md#restore-procedure)).
7. **Tell the titular** the result, the blocking period, and when the data were cancelled (LFPDPPP
   art. 24).

**Needs legal review:**

- **The blocking period.** Its length is the limitation period of the law that governs the
  relationship with the user (LFPDPPP art. 24); the research behind this procedure did not
  establish it. [Limitation period that applies, by class of event.]
- **The retention minimums** (security 730 days, audit 365, access 180, system 30) are Audit Hub's
  defaults ([database.md](../database.md#audit-hubs-audit-tables)), not periods set by the
  LFPDPPP. They justify keeping the pseudonymous events after a cancellation only to the extent a
  law requires it (art. 25 fr. II) or a legal impediment exists (art. 33 fr. IV).
- **Blocked data.** During the blocking period the data may not be processed (LFPDPPP art. 2 fr.
  III), except their storage (Reglamento art. 108). Audit Hub blocks them as point 3 says; a
  search by something other than the person (an address, an action, a period) still finds them,
  pseudonymous, so that the log of an incident stays whole. Whether that use for security is
  "storage" in the sense of the Reglamento, or needs a legal hold in each case, is for counsel:
  [Procedure for searches that reach blocked events].
- **Pseudonymous is not anonymous.** The application can link its user ids to people, so the
  remaining events are still personal data (LFPDPPP art. 2 fr. V).

### Opposition

The titular may object for a legitimate cause, when continued processing would cause them harm,
or to automated processing that produces unwanted
legal effects or significantly affects them and evaluates them without human intervention
(LFPDPPP art. 26 fr. I and II; GDPR arts. 21, 22). Opposition does not apply where the processing
is necessary to meet a legal obligation of the controller (LFPDPPP art. 26, last paragraph).

- **Rules only alert.** Audit Hub's rules raise alerts and may send the application a "Was it
  you?" question; they never act on a person
  ([security.md](../security.md#detection-rules)).
- **Every action is a human's.** Closing sessions, requiring a password change or disabling an
  account are requested by an administrator, with a reason of 10 to 500 characters, and approved
  by a second administrator by default; each application accepts none until it turns them on
  ([security.md](../security.md#webhooks-and-response-actions),
  [ADR 0013](../adr/0013-deliver-webhooks-and-response-actions-through-an-outbox.md)).
- **"It wasn't me"** closes the user's sessions because the user asked for it
  ([connection-guide.md](../audit/connection-guide.md#webhooks-was-it-you-and-the-accounts-activity)).
- **What can be stopped:** the device location, by turning off its consent in the app, or kept
  approximate by the person's choice in the phone's dialog
  ([connection-guide.md](../audit/connection-guide.md#location-optional)); response actions for
  the application, by the controller's instruction to the operator. Audit Hub's documentation
  describes no switch that stops logging one user; weigh the objection against the security
  purpose and the legal-obligation exception.
- **Needs legal review:** whether alerts and "Was it you?" questions are automated processing in
  the sense of LFPDPPP art. 26 fr. II; and, if the application acts on alerts by itself (its own
  alert handler), whether that decision is.

### Rights under the GDPR only

- **Restriction** (art. 18): the blocking after an erasure (above) restricts the per-person
  processing; a restriction without an erasure has no switch in Audit Hub, and a legal hold keeps
  data, it does not restrict them. Handle that case by procedure: [Procedure].
- **Portability** (art. 20), where it applies: the query API's export answers in JSON.
- **Withdrawal of consent:** the location, as above.
- **Notice to recipients** (art. 19; also LFPDPPP art. 24): Audit Hub, as the processor, receives
  the erasure; tell any other recipient of earlier copies (for example an export already shared).

## 6. Answer

- Always answer, even when no data of the person are held, in a legible and understandable form
  (Reglamento art. 98).
- A refusal may be partial. It gives its reasons, through the same channel as the request and
  within the deadlines: identity not proven; data not held; third parties' rights; a legal
  impediment or an authority's resolution; already done (LFPDPPP art. 33 fr. I–V). It tells the titular they may start a rights-protection procedure before the
  Secretaría Anticorrupción y Buen Gobierno (Reglamento art. 100), within 15 business days of the
  answer, or of the end of the period without one (LFPDPPP art. 40).

## 7. Letter templates

Short texts for the department; adapt them and send them through the request's channel. In Mexico
send the Spanish ones ([arco-procedure.es.md](arco-procedure.es.md#7-plantillas-de-respuesta)).

**Acknowledgement**

> We received your request on [date], with folio [folio]. We will answer by [date: 20 business
> days].

**Missing information**

> To handle your request [folio] we need [what is missing]. Please send it within 10 business days
> of this message; the period to answer starts again the day after we receive it.

**Extension**

> Your request [folio] needs more time because [reason]. We extend the period by [20 or 15]
> business days, until [date] (LFPDPPP art. 31).

**Access**

> Attached are the data of the security log of your account [user id], with an explanation of
> each field. [Means of delivery.] The places derived from IP addresses come from "IP Geolocation
> by DB-IP" (https://db-ip.com).

**Rectification**

> We corrected [data] in [Name of the application]. The security log records what happened at
> each moment and is not modified: it holds coded identifiers and, for 90 days, your name and the
> last four digits of your phone as they were at each event. Your events from now on carry the
> corrected data.

**Cancellation done**

> We deleted from the security log your name or masked labels, the last four digits of your phone,
> your IP addresses, browser data, device id, places and location, on [date]. The events of your account remain, with coded identifiers only, blocked
> until [date or period] because [legal ground], and will then be deleted.

**Cancellation refused in part**

> We cannot cancel [data] because [ground: LFPDPPP art. 25 fr. (number), or art. 33 fr. IV]. We
> did cancel [the rest]. You may start a rights-protection procedure before the Secretaría
> Anticorrupción y Buen Gobierno within 15 business days.

**Opposition**

> Our automatic rules only raise alerts; every measure on an account is decided by a person.
> [Decision on the objection and its ground.] [If granted: what stops and from when.]

**No data held**

> We searched our records, including the security log, and hold no personal data of yours linked
> to [identifier given].

## 8. Register

One row per request. Keep the register for [retention of the register].

| Folio   | Received | Channel   | Right   | Identity verified (date, means) | User id   | Missing info asked / received | Answer due | Extended (date notified) | Answer sent | Decision | Carry out by | Done   | Audit Hub action (export, erasure run, legal hold) | Notes   |
| ------- | -------- | --------- | ------- | ------------------------------- | --------- | ----------------------------- | ---------- | ------------------------ | ----------- | -------- | ------------ | ------ | -------------------------------------------------- | ------- |
| [folio] | [date]   | [channel] | [right] | [date, means]                   | [user id] | [dates]                       | [date]     | [no, or date]            | [date]      | [result] | [date]       | [date] | [reference]                                        | [notes] |

## Requests from Audit Hub's own users

Administrators, auditors and viewers of Audit Hub address their requests to the operator, which is
their responsable ([README.md](README.md#roles)). They manage their password, email and second
factor on their Account page ([manual.md](../manual.md#118-audit-hub-the-admin-pages)); their actions and reads are events of Audit Hub's own application, kept
730 days for accountability ([security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api)).
An administrator disables an account (every session ends at once; sign-in is refused) or removes
it: the address, name, password, second factor, sessions and assignments are deleted, and the
account keeps only its id, which Audit Hub's own log still names
([manual.md](../manual.md#1110-audit-hub-privacy-requests-its-accounts-and-the-end-of-an-application)).
What the person did stays in that log, under its own retention (its network and device data
expire first): it is the security record of the instance, kept under LFPDPPP art. 25 fr. II or
III where they apply. **Needs legal review:** that ground, and the period.
