# Privacy-notice paragraphs for a connected application

Versión en español: [privacy-notice.es.md](privacy-notice.es.md).

> Template, not legal advice. Review by counsel before use. Last checked against the law: 2026-10-17.

The paragraphs a connected application adds to its own privacy notice to cover its security log
in Audit Hub. The application's owner, as responsable, gives the notice. Audit Hub's operator
never addresses the application's users, and its processing must stay within this notice
(Reglamento art. 50, last paragraph).

- The notice the users read in Mexico is the Spanish one: [privacy-notice.es.md](privacy-notice.es.md)
  holds the paragraphs ready to publish. This file is the English reference.
- Choose the options that match the application: the person's name sent or not, the masked phone
  sent or not, device location on or off, push notifications on or off, response actions accepted
  or not
  ([processor-contract.md](processor-contract.md#annex-1-applications-and-settings)).
- Placeholders: [Controller's name], [Address], [Data-protection department's email address],
  [Name of the application], [URL of the full notice].
- Remove the "Needs legal review" notes before publishing, once counsel has answered them. The
  facts behind each paragraph are in [Sources for each paragraph](#sources-for-each-paragraph).

## What the notice must contain

| Item                                                                | Source                                          | Paragraph                                 |
| ------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| Identity and address of the responsable                             | LFPDPPP art. 15 fr. I; GDPR art. 13(1)(a)       | [1](#1-who-is-responsible)                |
| The data processed, marking the sensitive ones                      | LFPDPPP art. 15 fr. II                          | [2](#2-what-the-security-log-records)     |
| Purposes, separating those that need consent                        | LFPDPPP art. 15 fr. III; GDPR art. 13(1)(c)     | [3](#3-purposes)                          |
| Options to limit use or disclosure                                  | LFPDPPP art. 15 fr. IV                          | [4](#4-how-to-limit-the-use-of-your-data) |
| Retention                                                           | GDPR art. 13(2)(a)                              | [5](#5-how-long-we-keep-it)               |
| Recipients (the processor)                                          | GDPR art. 13(1)(e)                              | [6](#6-who-processes-it-for-us)           |
| The transfer clause                                                 | LFPDPPP art. 35                                 | [7](#7-transfers)                         |
| How to exercise ARCO rights                                         | LFPDPPP art. 15 fr. V; GDPR art. 13(2)(b)       | [8](#8-your-rights)                       |
| Automated processing                                                | LFPDPPP art. 26 fr. II; GDPR arts. 13(2)(f), 22 | [9](#9-automated-processing)              |
| How changes to the notice are announced                             | LFPDPPP art. 15 fr. VI                          | [10](#10-changes-to-this-notice)          |
| Legal basis, withdrawal of consent, complaint to an authority       | GDPR art. 13(1)(c), (2)(c), (2)(d)              | [11](#11-for-users-in-the-european-union) |
| Simplified notice: items I to IV, and where to read the full notice | LFPDPPP art. 16 fr. II                          | [Simplified notice](#simplified-notice)   |

**Needs legal review.** The 2013 Lineamientos del Aviso de Privacidad set detailed rules (for
example the full name and address of the responsable, and no vague phrases such as "among other
data"). They were issued under the 2010 law, and their status under the 2025 law is not
confirmed. These paragraphs follow them anyway.

## Full notice (aviso de privacidad integral)

### 1. Who is responsible

[Controller's name], with its address at [Address], is responsible for the processing of your
personal data described here.

### 2. What the security log records

To protect your account and our service, [Name of the application] keeps a security log of events
such as sign-ins and failed attempts, closed sessions, password and email changes, changes to
roles and invitations, and refused or limited requests. For each event the log may record:

| Category            | Data                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identification      | Your user id in [Name of the application], your role, a coded form of your email address (never the address itself), and your name or, if the application does not send it, a masked label such as `a***@e***.com`; if your account has a phone linked, only its last four digits (`•••• 1234`)                                                                                                  |
| What happened       | The action, its result, the date and time, the record it concerns, and which fields changed                                                                                                                                                                                                                                                                                                      |
| Connection          | Your IP address; your browser or app (user agent) and, if your browser is built on Chromium (Chrome, Edge, Brave, Opera), the details it sends of itself (client hints): its brand and version, the operating system and its version, and a phone's model; and the country, region, city and network derived from the IP                                                                         |
| Device              | A random id of the app's installation, the app's version and build, the platform, the operating system and the device model                                                                                                                                                                                                                                                                      |
| Location (optional) | Only if you turn it on in the app, and only when a session starts (when you sign in, or open the app while signed in): your phone's approximate position, rounded to about 1 km, or, if you allow the precise one when your phone asks, its precise position, to about 1 metre, with the accuracy the phone measured. On the web no device location is taken: only the place derived from the IP |

The log also records attempts made with an email address that has no account; of that address it
keeps only the coded form. Your phone number is never recorded: only its last four digits, to
recognise your account (for example in an investigation); it is not used to call or message you.
**The security log contains no sensitive personal data**, and no passwords, codes or tokens: fields
marked as sensitive are replaced before they leave our systems. The precise location is not
sensitive data either, but it says more about you: that is why it needs your consent, is taken
only when a session starts, and is kept 30 days. [Confirm that the actions the application added
to its catalog carry no sensitive data.]

### 3. Purposes

**Purposes necessary for the service** ([legal ground chosen by counsel]):

1. protecting your account and our systems: detecting unusual sign-ins, password-guessing attempts
   and misuse;
2. preventing fraud and account takeover, including asking you "Was it you?" after an unusual
   sign-in;
3. accountability: keeping a record, which cannot be altered unnoticed, of who did what and when;
4. meeting our legal obligations and answering requests from competent authorities.

**Purpose that needs your consent:**

5. using your phone's location, taken when a session starts, to detect sign-ins from places that do
   not match where your phone is. Only if you turn it on in the app's Settings; your phone lets you
   choose whether to share the precise or the approximate location, and you can turn it off at any
   time.

**Needs legal review.** Whether purposes 1 to 4 rest on tacit consent through this notice (LFPDPPP
art. 7) or on an exception to consent (LFPDPPP art. 9); and which form of consent the location
needs, in particular the precise one.

### 4. How to limit the use of your data

- **Location:** turn it off in the app's Settings. From then on no position is sent, and the ones
  already recorded are deleted within 30 days. To share only the approximate location, choose it
  when your phone asks, or later in your phone's settings.
- **Notifications:** you can turn off the app's notifications in your phone's settings. The "Was
  it you?" question will still appear in the app the next time you open it.
- [Other options the application offers.]

### 5. How long we keep it

| Data                                                                                                                                                               | Kept for |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Your phone's location, approximate or precise                                                                                                                      | 30 days  |
| IP address, user agent and browser details (client hints), device id, your name or masked label, the masked phone, city, and the personal values of changed fields | 90 days  |
| Security events: sign-ins and failed attempts, sessions, password and email changes, account status                                                                | 730 days |
| Administration events: invitations, accounts created, role changes                                                                                                 | 365 days |
| Access events: viewing other users' records                                                                                                                        | 180 days |
| Technical events [if the application records any]                                                                                                                  | 30 days  |

[Longer periods set for the application, if any.] Records related to an investigation or a legal
claim are kept until it ends. After those periods the records are deleted.

**Needs legal review.** Which law requires, or justifies, keeping each class of events for these
periods.

### 6. Who processes it for us

The security log is kept by [Operator's name], which processes it only on our behalf and under our
instructions, under a contract that obliges it to keep it confidential and secure. Its servers are
in [Country and region of the hosting]. The services it uses are listed at [Where the list of
sub-processors is published].

### 7. Transfers

We do not transfer the data of the security log to third parties, except when a competent
authority requires it or the law allows it without your consent (LFPDPPP art. 36). [If the
application transfers them: the recipient, the purpose, and the clause by which you accept or
refuse the transfer (LFPDPPP art. 35).]

### 8. Your rights

You may access your data, ask for their rectification or cancellation, or object to their use
(ARCO rights) by writing to our data-protection department at [Data-protection department's email
address] or through [Other channel]. Your request must include your name and a means to answer
you; a document proving your identity or your representative's; a clear description of the data
and of the right you exercise; and anything that helps us find the data (LFPDPPP art. 28). We
answer within 20 business days and, if the answer is favourable, carry it out within the next 15;
each period may be extended once (LFPDPPP art. 31). The procedure is free, except for the costs of
reproduction, copies or shipping (LFPDPPP art. 34).

How each right applies to the security log:

- **Access:** we give you every event of your account with the data still kept, such as your name,
  the masked phone, your network and browser data, and your location.
- **Rectification:** you can correct your profile, your name and phone included, in [Name of the
  application]. The security log records facts as they happened and is not changed; it holds coded
  identifiers and, as they were at each event, your name or masked label and the masked phone,
  which are deleted after 90 days.
- **Cancellation:** we delete from the log your name or masked labels, the masked phone, your IP
  addresses, browser data (user agent and client hints), device id, places and location (precise
  or approximate), and what our security rules learned of you (your devices, countries and last
  place). The events themselves remain, with coded identifiers only, blocked: they are
  not used for you and nobody consults them as yours, only kept while a legal duty requires it, and
  then deleted (LFPDPPP arts. 24 and 25). If you keep your account, what you do afterwards is
  recorded as this notice says.
- **Opposition:** you may object to the processing (LFPDPPP art. 26), except where it is necessary
  to meet a legal obligation.

**Needs legal review.** A search for a security incident by something other than the person (an
address, an action, a period) still finds blocked events, coded: see
[arco-procedure.md](arco-procedure.md#cancellation).

### 9. Automated processing

Automatic rules look for signs of risk, such as a sign-in from a new device or country. They only
raise alerts and, in some cases, ask you "Was it you?". **These rules make no decision about your
account:** any measure, such as closing your sessions, is decided by an authorised person, with a
reason and, by default, the approval of a second person. If you answer "It wasn't me", your
sessions are closed because you asked for it. You may object to automated processing that affects
you (LFPDPPP art. 26 fr. II).

**Needs legal review.** If the application acts on alerts by itself (for example through its own
alert handler), this paragraph must say so, and the objection right of LFPDPPP art. 26 fr. II and
GDPR art. 22 apply to that decision.

### 10. Changes to this notice

We will announce any change to this notice through [Channel: the application, email, the
website], and publish the current version at [URL of the full notice].

### 11. For users in the European Union

[Only if the GDPR applies to the application. **Needs legal review.**]

- **Legal basis:** [for purposes 1 to 4, for example the legitimate interest in the security of
  the service, or a legal obligation (GDPR art. 6(1)(f) or (c)); for purpose 5, consent (GDPR art.
  6(1)(a))].
- **Withdrawing consent:** you can turn off the location at any time; this does not affect the
  processing done before.
- **Your rights:** also restriction of processing and portability, where they apply (GDPR arts. 18
  and 20). We answer within one month, extendable by two further months where necessary (GDPR art.
  12(3)).
- **Complaint:** you may complain to a data protection supervisory authority, in particular in the
  country where you live.
- **Outside the EU:** the log is kept in [Country]; [basis under GDPR Chapter V, for example
  standard contractual clauses].
- **Data protection officer or EU representative:** [Contact, if appointed].

## Simplified notice

For collection through the app or the website (LFPDPPP art. 16 fr. II: items I to IV of art. 15,
and where to read the full notice):

> [Controller's name], with its address at [Address], keeps a security log of your activity in
> [Name of the application]: your user id, your name, a coded form of your email, the last four
> digits of your phone if your account has one, your IP address, your browser or device, the place
> derived from your IP and, only if you turn it on, your phone's location when a session starts,
> approximate or, if you allow it, precise. We use it to protect your account, prevent fraud, keep
> a record of who did what, and meet our legal obligations. The location needs your consent, and
> you can turn it off in Settings. Read the full notice at [URL of the full notice].

## Consent text for the location

Shown in the app's Settings, next to the switch:

> **Use my location for sign-in alerts.** When you sign in or open the app, we check that sign-ins
> to your account come from where you are. When you turn this on, your phone asks whether to share
> your precise or your approximate location. Precise: we take your position once, at that moment
> (the GPS is used for 10 seconds at most), to about 1 metre. Approximate: we send the last
> position your phone already knows, rounded to about 1 km. Never in the background, never
> continuously. We keep it 30 days. You can turn this off at any time.

## Sources for each paragraph

What Audit Hub does, behind each paragraph. Remove this section before publishing.

| Paragraph                  | Fact                                                                                                                                                                                                                                                                                                     | Where it is documented                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2, events recorded         | The base catalog's actions and their classes                                                                                                                                                                                                                                                             | [connection-guide.md](../audit/connection-guide.md#integration-points), [contract.md](../design/audit-hub/contract.md#base-catalog-every-flow-of-project-template-web)                                                    |
| 2, data                    | Ids, email pseudonym, label (the person's name, or the email masked at the origin), phone masked at the origin (an unmasked one is refused); IP, user agent, client hints, device id, place; coordinates                                                                                                 | [privacy table](../design/audit-hub/README.md#privacy-at-a-glance), [connection-guide.md](../audit/connection-guide.md#recording-events)                                                                                  |
| 2, connection and device   | Country and network in the event, region and city apart; client hints of Chromium browsers (Chrome, Edge, Brave, Opera; not Firefox or Safari), forwarded by the connectors; the app's headers and installation id                                                                                       | [security.md](../security.md#ip-geolocation-data), [connection-guide.md](../audit/connection-guide.md#the-mobile-app)                                                                                                     |
| 2, no sensitive data       | Fields marked `sensitive` arrive as `[REDACTED]`                                                                                                                                                                                                                                                         | [connection-guide.md](../audit/connection-guide.md#your-own-actions)                                                                                                                                                      |
| 3, purposes 1–3            | Detection rules, "Was it you?", integrity seals                                                                                                                                                                                                                                                          | [security.md](../security.md#detection-rules), [connection-guide.md](../audit/connection-guide.md#webhooks-was-it-you-and-the-accounts-activity), [security.md](../security.md#audit-log-integrity-retention-and-erasure) |
| 3, purpose 5, consent text | A consent of its own, off by default, mobile app only; precise or approximate chosen in the phone's dialog; last known position or, when precise is allowed, one fresh fix at session start (the GPS 10 seconds at most); 0.01° or five decimals, rounded on the phone; never in the background; 30 days | [connection-guide.md](../audit/connection-guide.md#location-optional)                                                                                                                                                     |
| 4, notifications           | Without push, the prompt still appears in the app                                                                                                                                                                                                                                                        | [connection-guide.md](../audit/connection-guide.md#push-notifications)                                                                                                                                                    |
| 5, retention               | Minimums per class: security 730, audit 365, access 180, system 30, personal data 90, coordinates 30; legal holds                                                                                                                                                                                        | [database.md](../database.md#audit-hubs-audit-tables), [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                                            |
| 8, rights                  | Export of the user's events; erasure of the personal data (names, masked phones, client hints and coordinates included); events kept pseudonymous                                                                                                                                                        | [security.md](../security.md#audit-hubs-own-log-exports-and-the-query-api), [security.md](../security.md#audit-log-integrity-retention-and-erasure)                                                                       |
| 9, automated processing    | Rules only alert; response actions by administrators, with a reason and approval; "It wasn't me" closes sessions; the application's own alert handler                                                                                                                                                    | [security.md](../security.md#detection-rules), [security.md](../security.md#webhooks-and-response-actions), [connection-guide.md](../audit/connection-guide.md#webhooks-was-it-you-and-the-accounts-activity)             |
