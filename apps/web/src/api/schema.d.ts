// Generated from openapi/openapi.json by `pnpm contract`. Do not edit.

export interface paths {
    "/api/connected-apps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Connected applications, by name */
        get: operations["ConnectedAppsController_list"];
        put?: never;
        /**
         * Register an application
         * @description Answers the variables the application needs, its signing key secret and pseudonymization key included: shown this once, Audit Hub keeps only ciphertexts. 409: the slug is taken.
         */
        post: operations["ConnectedAppsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One connected application and its keys */
        get: operations["ConnectedAppsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change an application: name, webhook URL, status, limits, response actions */
        patch: operations["ConnectedAppsController_update"];
        trace?: never;
    };
    "/api/connected-apps/{id}/keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate the signing key
         * @description A new key, shown once; the current one keeps verifying for 7 days. 409: a replaced key is still valid (revoke it first).
         */
        post: operations["ConnectedAppsController_rotateKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{id}/keys/{keyId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke a signing key: its requests are refused at once */
        delete: operations["ConnectedAppsController_revokeKey"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{id}/webhook-secret": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate the webhook secret
         * @description A new secret, shown once; deliveries carry both signatures for 7 days.
         */
        post: operations["ConnectedAppsController_rotateWebhookSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{id}/deletion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Delete a suspended application's audit log at the end of its service, and retire it
         * @description Deletes its events for at most 10 seconds a call, then, once none is left, what Audit Hub derived from them (alerts, response actions, what the rules remember, its keys), and retires the application: its seals, catalog and the records of the deletion stay, so the verification still passes. Never what a legal hold keeps. Confirm with the application's slug. Status deleting or waiting (events not sealed yet, 2 minutes): call again. 409: the application is not suspended.
         */
        post: operations["ConnectedAppsController_deleteLog"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in with email and password: the second factor comes next
         * @description Audit Hub (docs/adr/0012): a right password answers a challenge, mfa: verify (POST /api/auth/mfa/verify with a code) or, for an account without a second factor yet, mfa: enroll (POST /api/auth/mfa/enroll, then enroll/confirm). The session (an access token, and the refresh token as an httpOnly cookie: __Host-refresh_token on Path=/ in production, refresh_token scoped to /api/auth elsewhere) starts there; a session this browser already had ends then. 403: the password is right, but the account may not use the panel (a member, or an auditor or a viewer without an application: docs/security.md#who-may-sign-in); no second factor is asked.
         */
        post: operations["AuthController_signIn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate the refresh cookie and mint a new access token
         * @description Reads the refresh cookie (__Host-refresh_token in production, refresh_token elsewhere). Each refresh token works once; presenting one that was rotated more than 30 seconds ago ends its whole session family. An account that may no longer use the panel (docs/security.md#who-may-sign-in) gets 401, and its session ends.
         */
        post: operations["AuthController_refresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** End the current session family and clear the cookies */
        post: operations["AuthController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** What this deployment offers: password recovery, public sign-up, change of email, invitations */
        get: operations["AuthController_capabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sign-ups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign up: ask for a confirmation link
         * @description Answers 202 for any well-formed request whose password follows the policy. A new address gets a one-time link (valid 24 hours) to confirm it; one that already has an account gets a notice to its owner instead. No account exists until the link is confirmed. 400: the password is refused (too short, too common, too easy to guess, or containing the email or name). 403: sign-up is closed here.
         */
        post: operations["AuthController_requestSignUp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sign-ups/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm a sign-up with its link's token and its password
         * @description Creates the account and answers a challenge to set up its second factor (mfa: enroll): the session starts once it is confirmed (docs/adr/0012). 401: not the password chosen at sign-up (a few wrong ones drop the sign-up). 403: sign-up is closed here. 404: the link is invalid, replaced, used or expired. 409: the address got an account meanwhile.
         */
        post: operations["AuthController_confirmSignUp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/password-resets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ask for a password reset link
         * @description Answers 204 for any well-formed address. If it has an account, a message with a one-time link (valid 30 minutes) is on its way. 503 when this deployment sends no email.
         */
        post: operations["AuthController_requestPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/password-resets/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Choose a new password with a reset link's token
         * @description The token works once. Every session of the account ends; nobody is signed in. 400: the new password is refused (too short, too common, too easy to guess, or containing the email or name), the link still works. 404: the link is invalid, used or expired.
         */
        post: operations["AuthController_confirmPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/mfa/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Finish signing in with a code from the authenticator app, or a recovery code
         * @description Starts the session like the template's sign-in did (refresh cookie, access token). A recovery code works once and sends a notice by email. 401: the code is wrong or used (5 attempts per challenge), or the challenge expired or was used: sign in again. 403: the account may no longer use the panel (docs/security.md#who-may-sign-in).
         */
        post: operations["MfaController_verify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/mfa/enroll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start setting up the second factor: a new secret, as a QR and as text
         * @description For a challenge with mfa: enroll. Each call makes a new secret; the last one is the one a code confirms. 401: the challenge expired or was used. 409: a factor is set up already.
         */
        post: operations["MfaController_enroll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/mfa/enroll/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm the new second factor with a code: the session starts
         * @description Answers the session and ten recovery codes, shown this once. 401: the code is wrong (5 attempts per challenge) or the challenge expired. 403: the account may not use the panel (docs/security.md#who-may-sign-in): nothing is set up, and no session starts. 409: start the set-up again.
         */
        post: operations["MfaController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/account/step-up": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm the password and a code again, for a sensitive action
         * @description Answers a new access token that allows sensitive actions for 5 minutes (exports, keys, response actions, legal holds, retention, roles, resetting a second factor). It is not carried over by a refresh. 403: the password or the code is wrong.
         */
        post: operations["AccountMfaController_stepUp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/account/mfa": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The second factor of the account: since when, recovery codes left */
        get: operations["AccountMfaController_status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/account/mfa/recovery-codes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Replace the recovery codes (after a step-up)
         * @description Ten new codes, shown this once; the old ones stop working.
         */
        post: operations["AccountMfaController_recoveryCodes"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/mfa-reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reset a person's second factor; they set up a new one at their next sign-in
         * @description Every session of theirs ends; they get a notice by email. 403: no recent step-up, or your own account (use a recovery code). 404: no such user. 409: a removed account.
         */
        post: operations["MfaAdminController_reset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/account/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Change the password, confirming the current one
         * @description Every other session ends; this browser gets a new session (a new access token in the body and a new refresh cookie). 400: the new password is refused (too short, too common, too easy to guess, or containing the email or name). 403: the current password is wrong. 409: the password changed meanwhile.
         */
        post: operations["AccountController_changePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/account/email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ask to change the email address, confirming the current password
         * @description Answers 202 once the current password is checked: a one-time link (valid 24 hours) goes to the new address, which changes only when it is opened; if the new address already has an account, its owner gets a notice instead. 400: the new address is the current one. 403: the current password is wrong. 503: this deployment sends no email.
         */
        post: operations["AccountController_changeEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/email-changes/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm a new email address with the link sent to it
         * @description The token works once, while the account is as it was when the link was sent. The address changes, every session ends (sign in again with the new address), and the previous address gets a notice with a link to undo it. 404: the link is invalid, used or expired. 409: the new address got an account meanwhile.
         */
        post: operations["EmailChangeController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/email-changes/revert": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Undo a change of email with the link sent to the previous address
         * @description The token works once, for 7 days, whatever happened to the account since. The previous address comes back with the new password given here, and every session ends. 400: the password is refused (too short, too common, too easy to guess, or containing the email or name); the link still works. 404: the link is invalid, used or expired. 409: the previous address got another account meanwhile.
         */
        post: operations["EmailChangeController_revert"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/account/notification-preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Your notification preferences: sounds, browser notices, quiet times */
        get: operations["NotificationPreferencesController_get"];
        /** Change your notification preferences */
        put: operations["NotificationPreferencesController_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Pending invitations, newest first */
        get: operations["InvitationsController_list"];
        put?: never;
        /**
         * Invite an address to create an account with a role
         * @description Sends a one-time link (valid 7 days); the account exists once it is accepted with a name and a password the person chooses. An administrator, or an auditor or a viewer with the applications they will see (assigned on acceptance: without one they could not sign in). Inviting an address again replaces its invitation and link. 400: a role without its applications, or an administrator with some. 404: an application is unknown, Audit Hub's own or retired. 409: the address has an account. 429: the address got a message moments ago (or several today). 503: this deployment sends no email.
         */
        post: operations["InvitationsController_invite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/invitations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke an invitation: its link stops working at once */
        delete: operations["InvitationsController_revoke"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/invitations/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept an invitation with its link's token, choosing a name and a password
         * @description Creates the account with the invitation's role and applications, and answers a challenge to set up its second factor (mfa: enroll): the session starts once it is confirmed (docs/adr/0012). 400: the password is refused (too short, too common, too easy to guess, or containing the email or name); the link still works. 404: the invitation is invalid, replaced, revoked, used or expired, or no longer opens the panel (its applications were retired, or it invites a member). 409: the address got an account meanwhile.
         */
        post: operations["InvitationAcceptController_accept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The signed-in user */
        get: operations["UsersController_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List users, newest first (admins only) */
        get: operations["UsersController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One user
         * @description Members may read only themselves; any other id answers 404. Admins read any.
         */
        get: operations["UsersController_findOne"];
        put?: never;
        post?: never;
        /**
         * Remove a person from Audit Hub
         * @description Their account keeps its id, so the records that name it still resolve, but nothing of them: address, name, password, second factor, sessions and assignments go, and it stays disabled for good. Open alerts assigned to them are assigned to nobody. 409: your own account, the last administrator who may sign in, or an account already removed.
         */
        delete: operations["UserAccessController_remove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ingest/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a batch of events
         * @description At most 100 events and 100 kB. Answers one result per event (accepted, duplicate, or rejected with its reason): one bad event never fails the batch. 400 with Audit-Error contract_version_unsupported: update the connector.
         */
        post: operations["IngestController_ingest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ingest/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Publish the application's catalog of actions
         * @description Idempotent: the same document answers unchanged. 400: the catalog is invalid, or moves an action to a category kept for less time.
         */
        put: operations["IngestController_publish"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ingest/heartbeat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A connector instance's heartbeat
         * @description Every minute: its version, its queue, its sequence. Answers what Audit Hub has received.
         */
        post: operations["IngestController_heartbeat"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/integrity/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Sealing and verification state of every stream
         * @description Per application and category: the last seal, the events waiting for one, and the latest verifications.
         */
        get: operations["IntegrityController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{appId}/retention": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** An application's retention per class, with each class's minimum */
        get: operations["RetentionController_policies"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{appId}/retention/{class}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set how long a class is kept for an application
         * @description 400: below the class minimum (the database refuses it too).
         */
        put: operations["RetentionController_setPolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{appId}/legal-holds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** An application's legal holds, newest first */
        get: operations["RetentionController_holds"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/legal-holds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Place a legal hold
         * @description Retention and erasure skip what it matches until it is released.
         */
        post: operations["RetentionController_createHold"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/legal-holds/{id}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Release a legal hold: retention applies again to what it kept */
        post: operations["RetentionController_release"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A person's role, second factor and applications */
        get: operations["UserAccessController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change a person's role
         * @description Their access tokens stop at once; the next refresh brings the new role. 409: the last administrator cannot be demoted.
         */
        patch: operations["UserAccessController_changeRole"];
        trace?: never;
    };
    "/api/users/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Disable a person's account, or enable it again
         * @description Disabling ends every session and access token at once; sign-in answers as for a wrong password until the account is enabled. 409: your own account, the last administrator who may sign in, or a removed account.
         */
        patch: operations["UserAccessController_changeStatus"];
        trace?: never;
    };
    "/api/users/{id}/apps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the applications an auditor or a viewer may see
         * @description The whole list: assignments not in it end. 404: an application that does not exist.
         */
        put: operations["UserAccessController_assignApps"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/account/apps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The applications the caller may see
         * @description Administrators: every one, Audit Hub's own last; auditors and viewers: the ones assigned to them; members: none.
         */
        get: operations["AccountAppsController_apps"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{id}/webhook-test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a test webhook (ping) to the application
         * @description Queued at once and sent by the worker; its outcome shows in the deliveries. 400: the application has no webhook URL.
         */
        post: operations["WebhooksController_ping"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{id}/webhook-deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The application's webhook deliveries, newest first */
        get: operations["WebhooksController_deliveries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/alerts/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The live stream of alert changes (Server-Sent Events)
         * @description text/event-stream, read with fetch (the Bearer token in its header, never in the URL). Events: `alert` (data `{ alert, replay }`: the alert as the list answers it; `id`: the stream position), `ready` (caught up), `resync` (too many changes missed: reload the lists), `end` (`reason`: renew, access or shutdown: reconnect, except after access). Send `Last-Event-ID` to replay what changed after it. At most 5 streams per account (429); each ends after 10 minutes, its access checked again every minute.
         */
        get: operations["AlertsController_live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/alerts/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The unresolved alerts by severity: open (unacknowledged) and in review */
        get: operations["AlertsController_summary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Alerts, most recent activity first */
        get: operations["AlertsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/alerts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One alert: why it fired, its evidence, its history and the events behind it */
        get: operations["AlertsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change the status or the assignee of an alert
         * @description 409: the alert changed since `version` was read, the transition is not allowed, or the assignee cannot work on the application.
         */
        patch: operations["AlertsController_update"];
        trace?: never;
    };
    "/api/alerts/{id}/acknowledge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Acknowledge an alert: take it on (In review, yours when nobody has it); its escalation stops
         * @description 409: closed, already acknowledged, or changed since `version` was read.
         */
        post: operations["AlertsController_acknowledge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/alerts/{id}/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a note to an alert */
        post: operations["AlertsController_addNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/alert-mutes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Silences of alerts: those in force first, then the most recent */
        get: operations["AlertMutesController_list"];
        put?: never;
        /**
         * Silence an application's alerts, of one rule or all, for a while
         * @description The alerts are still raised, kept and shown; email, chat, escalation and the panel's sounds and browser notices stay quiet until it ends.
         */
        post: operations["AlertMutesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/alert-mutes/{id}/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Lift a silence now (kept, as ended) */
        post: operations["AlertMutesController_end"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/detection-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The detection rules: what each detects, its parameters and its settings */
        get: operations["DetectionController_listRules"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/detection-rules/{rule}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Turn a rule on or off, give it a severity, tune its parameters
         * @description 400: a parameter out of its bounds, or a severity for a rule that decides its own.
         */
        put: operations["DetectionController_updateRule"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/escalation-policies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The escalation policies, per severity, and the channels available */
        get: operations["DetectionController_listPolicies"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/escalation-policies/{severity}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Change a severity's escalation policy */
        put: operations["DetectionController_updatePolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every visible application at a glance: activity, alerts, ingestion health */
        get: operations["ExplorerController_overview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search the audit log, newest first
         * @description Combinable filters; `email` is matched by its pseudonym and needs `appId`. Cursor pagination: pass `nextCursor` back as `cursor`. Every search is recorded (audit_access).
         */
        get: operations["ExplorerController_search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/events/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One event: every section, its personal data while kept, its request, its integrity */
        get: operations["ExplorerController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{appId}/subjects/{subject}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A user's activity in an application (360°)
         * @description `acrossApps=true` adds the same person in other applications with correlation on, by email pseudonym.
         */
        get: operations["ExplorerController_subject"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{appId}/resources/{resourceType}/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A resource's history in an application, newest first */
        get: operations["ExplorerController_resource"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{appId}/security": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** An application's security: failed sign-ins, addresses, countries, a heatmap, anomalies */
        get: operations["ExplorerController_security"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connected-apps/{appId}/subjects/{subject}/erasure": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Erase a user's personal data in an application, or their events too (right to erasure)
         * @description Scope personal (the default): deletes the satellite rows (network, device, labels, coordinates) of every event of the user, except what a legal hold keeps; the events stay, pseudonymous, and the user is blocked in the per-person views. Scope events, once the controller cancels them: the events go too, the sealed ones at once and the rest within a day (docs/security.md). Needs a recent step-up.
         */
        post: operations["ExplorerController_erase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/exports/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export events as CSV or JSON Lines, streamed
         * @description The explorer's filters; at most 100000 rows (status truncated past it). No personal data. Spreadsheet formulas are neutralized. The body's digest is the Content-Digest trailer, and GET /api/exports/{Audit-Export-Id} gives it too. Needs a recent step-up.
         */
        get: operations["ExportsController_events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Exports, newest first
         * @description The caller's own; an administrator sees everyone's.
         */
        get: operations["ExportsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/exports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** An export's outcome: rows, status and digest */
        get: operations["ExportsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/response-actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Response actions, newest first */
        get: operations["ResponseActionsController_list"];
        put?: never;
        /**
         * Ask an application to act on one of its users
         * @description pending_approval when the application requires a second administrator (the default), else dispatched at once as a signed webhook. 409: the action is not accepted for the application (Audit Hub setting or its catalog), or it has no webhook URL.
         */
        post: operations["ResponseActionsController_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/response-actions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One response action */
        get: operations["ResponseActionsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/response-actions/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve a pending response action (someone other than its requester)
         * @description 403: the requester cannot approve. 409: not waiting for approval any more.
         */
        post: operations["ResponseActionsController_approve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/response-actions/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Withdraw a response action still waiting for approval */
        post: operations["ResponseActionsController_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The event sources: connected, delayed, idle, disconnected; queues, refusals and gaps */
        get: operations["SourcesController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connector/subjects/{subject}/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The user's own security activity ("My account's security")
         * @description The actions the catalog marks user-visible, newest first, with minimal fields and no IP. The application shows them only to that user.
         */
        get: operations["ConnectorController_activity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connector/subjects/{subject}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Right of access: every event of the user, with what is still kept of it
         * @description 100 events a page, newest first; pass nextCursor back as cursor.
         */
        get: operations["ConnectorController_export"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connector/subjects/{subject}/erasure": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Right to erasure: delete the user's personal data in Audit Hub, or their events too
         * @description Scope personal (the default, and what an account deletion event does): the satellite rows of every event of the user, except what a legal hold keeps; the events stay, pseudonymous, and the user is blocked in the per-person views. Scope events, once the controller cancels them: the events go too, the sealed ones at once and the rest within a day (docs/security.md).
         */
        post: operations["ConnectorController_erase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness: the process is up (restart it when this fails) */
        get: operations["HealthController_live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Readiness: dependencies are reachable (route traffic only while this passes) */
        get: operations["HealthController_ready"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/telemetry/web-vitals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Report the Web Vitals of a page load
         * @description Sent by the web app when the page is hidden. Recorded as metrics by route pattern, metric, rating and navigation type (docs/observability.md#web-vitals); answered 204 also when metrics are off.
         */
        post: operations["WebVitalsController_report"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ErrorResponse: {
            /** @enum {unknown|null} */
            data: null;
            message: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    ConnectedAppsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            name: string;
                            environment: string;
                            /** @enum {string} */
                            status: "active" | "suspended" | "retired";
                            webhookUrl: string | null;
                            correlationEnabled: boolean;
                            acceptedResponseActions: ("revoke_sessions" | "require_password_change" | "disable_account")[];
                            requireActionApproval: boolean;
                            heartbeatTimeoutSec: number;
                            rateLimitPerMinute: number;
                            /** Format: date-time */
                            createdAt: string;
                            keys: {
                                /** Format: uuid */
                                id: string;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                expiresAt: string | null;
                                /** Format: date-time */
                                revokedAt: string | null;
                                /** Format: date-time */
                                lastUsedAt: string | null;
                            }[];
                        }[];
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ConnectedAppsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    slug: string;
                    name: string;
                    environment: string;
                    /** Format: uri */
                    webhookUrl?: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            app: {
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                name: string;
                                environment: string;
                                /** @enum {string} */
                                status: "active" | "suspended" | "retired";
                                webhookUrl: string | null;
                                correlationEnabled: boolean;
                                acceptedResponseActions: ("revoke_sessions" | "require_password_change" | "disable_account")[];
                                requireActionApproval: boolean;
                                heartbeatTimeoutSec: number;
                                rateLimitPerMinute: number;
                                /** Format: date-time */
                                createdAt: string;
                                keys: {
                                    /** Format: uuid */
                                    id: string;
                                    /** Format: date-time */
                                    createdAt: string;
                                    /** Format: date-time */
                                    expiresAt: string | null;
                                    /** Format: date-time */
                                    revokedAt: string | null;
                                    /** Format: date-time */
                                    lastUsedAt: string | null;
                                }[];
                            };
                            credentials: {
                                variables: {
                                    [key: string]: string;
                                };
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ConnectedAppsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            name: string;
                            environment: string;
                            /** @enum {string} */
                            status: "active" | "suspended" | "retired";
                            webhookUrl: string | null;
                            correlationEnabled: boolean;
                            acceptedResponseActions: ("revoke_sessions" | "require_password_change" | "disable_account")[];
                            requireActionApproval: boolean;
                            heartbeatTimeoutSec: number;
                            rateLimitPerMinute: number;
                            /** Format: date-time */
                            createdAt: string;
                            keys: {
                                /** Format: uuid */
                                id: string;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                expiresAt: string | null;
                                /** Format: date-time */
                                revokedAt: string | null;
                                /** Format: date-time */
                                lastUsedAt: string | null;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ConnectedAppsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    /** Format: uri */
                    webhookUrl?: string | null;
                    /** @enum {string} */
                    status?: "active" | "suspended";
                    heartbeatTimeoutSec?: number;
                    rateLimitPerMinute?: number;
                    correlationEnabled?: boolean;
                    acceptedResponseActions?: ("revoke_sessions" | "require_password_change" | "disable_account")[];
                    requireActionApproval?: boolean;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            name: string;
                            environment: string;
                            /** @enum {string} */
                            status: "active" | "suspended" | "retired";
                            webhookUrl: string | null;
                            correlationEnabled: boolean;
                            acceptedResponseActions: ("revoke_sessions" | "require_password_change" | "disable_account")[];
                            requireActionApproval: boolean;
                            heartbeatTimeoutSec: number;
                            rateLimitPerMinute: number;
                            /** Format: date-time */
                            createdAt: string;
                            keys: {
                                /** Format: uuid */
                                id: string;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                expiresAt: string | null;
                                /** Format: date-time */
                                revokedAt: string | null;
                                /** Format: date-time */
                                lastUsedAt: string | null;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ConnectedAppsController_rotateKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            variables: {
                                [key: string]: string;
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ConnectedAppsController_revokeKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                keyId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ConnectedAppsController_rotateWebhookSecret: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            variables: {
                                [key: string]: string;
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ConnectedAppsController_deleteLog: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    confirm: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            status: "deleting" | "waiting" | "held" | "deleted";
                            deleted: number;
                            held: number;
                            waiting: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_signIn: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: email */
                    email: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            mfa: "verify" | "enroll";
                            challengeToken: string;
                            expiresIn: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_refresh: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            accessToken: string;
                            expiresIn: number;
                            user: {
                                /** Format: uuid */
                                id: string;
                                /** Format: email */
                                email: string;
                                name: string;
                                /** @enum {string} */
                                role: "member" | "viewer" | "auditor" | "admin";
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed out */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_capabilities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            passwordReset: boolean;
                            signUp: boolean;
                            emailChange: boolean;
                            invitations: boolean;
                        };
                        message: string;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_requestSignUp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: email */
                    email: string;
                    name: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_confirmSignUp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            mfa: "verify" | "enroll";
                            challengeToken: string;
                            expiresIn: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_requestPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: email */
                    email: string;
                };
            };
        };
        responses: {
            /** @description Accepted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AuthController_confirmPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description Password changed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    MfaController_verify: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    challengeToken: string;
                    code?: string;
                    recoveryCode?: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            accessToken: string;
                            expiresIn: number;
                            user: {
                                /** Format: uuid */
                                id: string;
                                /** Format: email */
                                email: string;
                                name: string;
                                /** @enum {string} */
                                role: "member" | "viewer" | "auditor" | "admin";
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    MfaController_enroll: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    challengeToken: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            secret: string;
                            uri: string;
                            qr: string[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    MfaController_confirm: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    challengeToken: string;
                    code: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            accessToken: string;
                            expiresIn: number;
                            user: {
                                /** Format: uuid */
                                id: string;
                                /** Format: email */
                                email: string;
                                name: string;
                                /** @enum {string} */
                                role: "member" | "viewer" | "auditor" | "admin";
                            };
                            recoveryCodes: string[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountMfaController_stepUp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    password: string;
                    code: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            accessToken: string;
                            expiresIn: number;
                            user: {
                                /** Format: uuid */
                                id: string;
                                /** Format: email */
                                email: string;
                                name: string;
                                /** @enum {string} */
                                role: "member" | "viewer" | "auditor" | "admin";
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountMfaController_status: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            confirmedAt: string | null;
                            recoveryCodesLeft: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountMfaController_recoveryCodes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            recoveryCodes: string[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    MfaAdminController_reset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Reset */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountController_changePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    currentPassword: string;
                    newPassword: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            accessToken: string;
                            expiresIn: number;
                            user: {
                                /** Format: uuid */
                                id: string;
                                /** Format: email */
                                email: string;
                                name: string;
                                /** @enum {string} */
                                role: "member" | "viewer" | "auditor" | "admin";
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountController_changeEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    currentPassword: string;
                    /** Format: email */
                    newEmail: string;
                };
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    EmailChangeController_confirm: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description Address changed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    EmailChangeController_revert: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description Change undone */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    NotificationPreferencesController_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            sound: {
                                enabled: boolean;
                                volume: number;
                                severities: ("info" | "low" | "medium" | "high" | "critical")[];
                            };
                            browser: {
                                enabled: boolean;
                                severities: ("info" | "low" | "medium" | "high" | "critical")[];
                            };
                            criticalRepeat: {
                                enabled: boolean;
                                intervalSeconds: number;
                                times: number;
                            };
                            /** Format: date-time */
                            quietUntil: string | null;
                            mutedAppIds: string[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    NotificationPreferencesController_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    sound: {
                        enabled: boolean;
                        volume: number;
                        severities: ("info" | "low" | "medium" | "high" | "critical")[];
                    };
                    browser: {
                        enabled: boolean;
                        severities: ("info" | "low" | "medium" | "high" | "critical")[];
                    };
                    criticalRepeat: {
                        enabled: boolean;
                        intervalSeconds: number;
                        times: number;
                    };
                    /** Format: date-time */
                    quietUntil: string | null;
                    mutedAppIds: string[];
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            sound: {
                                enabled: boolean;
                                volume: number;
                                severities: ("info" | "low" | "medium" | "high" | "critical")[];
                            };
                            browser: {
                                enabled: boolean;
                                severities: ("info" | "low" | "medium" | "high" | "critical")[];
                            };
                            criticalRepeat: {
                                enabled: boolean;
                                intervalSeconds: number;
                                times: number;
                            };
                            /** Format: date-time */
                            quietUntil: string | null;
                            mutedAppIds: string[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    InvitationsController_list: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: email */
                                email: string;
                                /** @enum {string} */
                                role: "member" | "viewer" | "auditor" | "admin";
                                apps: {
                                    /** Format: uuid */
                                    appId: string;
                                    slug: string;
                                    name: string;
                                }[];
                                invitedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                expiresAt: string | null;
                            }[];
                            total: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    InvitationsController_invite: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: email */
                    email: string;
                    /** @enum {string} */
                    role: "viewer" | "auditor" | "admin";
                    /** @default [] */
                    appIds?: string[];
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: email */
                            email: string;
                            /** @enum {string} */
                            role: "member" | "viewer" | "auditor" | "admin";
                            apps: {
                                /** Format: uuid */
                                appId: string;
                                slug: string;
                                name: string;
                            }[];
                            invitedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            expiresAt: string | null;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    InvitationsController_revoke: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    InvitationAcceptController_accept: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                    name: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            mfa: "verify" | "enroll";
                            challengeToken: string;
                            expiresIn: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    UsersController_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: email */
                            email: string;
                            name: string;
                            /** @enum {string} */
                            role: "member" | "viewer" | "auditor" | "admin";
                            /** Format: date-time */
                            disabledAt: string | null;
                            /** Format: date-time */
                            removedAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    UsersController_list: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: email */
                                email: string;
                                name: string;
                                /** @enum {string} */
                                role: "member" | "viewer" | "auditor" | "admin";
                                /** Format: date-time */
                                disabledAt: string | null;
                                /** Format: date-time */
                                removedAt: string | null;
                                /** Format: date-time */
                                createdAt: string;
                            }[];
                            total: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    UsersController_findOne: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: email */
                            email: string;
                            name: string;
                            /** @enum {string} */
                            role: "member" | "viewer" | "auditor" | "admin";
                            /** Format: date-time */
                            disabledAt: string | null;
                            /** Format: date-time */
                            removedAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    UserAccessController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    IngestController_ingest: {
        parameters: {
            query?: never;
            header: {
                /** @description The key's public id (UUID) */
                "Audit-Key-Id": string;
                /** @description Unix seconds, within ±300 s */
                "Audit-Timestamp": string;
                /** @description 16 random bytes, base64url; single use */
                "Audit-Nonce": string;
                /** @description sha-256=<base64url> of the canonical JSON (RFC 8785) of the body */
                "Audit-Body-Digest": string;
                /** @description v1=<base64url HMAC-SHA256> over the canonical string (contract.md) */
                "Audit-Signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    contractVersion: number;
                    connector: {
                        name: string;
                        version: string;
                    };
                    /** Format: uuid */
                    sequenceEpoch: string;
                    events: unknown[];
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            results: {
                                index: number;
                                eventId?: string;
                                sourceSeq?: number;
                                /** @enum {string} */
                                status: "accepted" | "duplicate" | "rejected";
                                /** @enum {string} */
                                reason?: "schema_invalid" | "too_large" | "action_unknown" | "catalog_version_unknown" | "details_invalid" | "category_mismatch" | "category_reserved" | "outcome_not_allowed" | "source_not_allowed" | "occurred_at_too_old" | "sequence_conflict" | "contract_version_unsupported";
                                retryable?: boolean;
                                truncatedFields?: string[];
                                droppedFields?: string[];
                            }[];
                            accepted: number;
                            duplicates: number;
                            rejected: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    IngestController_publish: {
        parameters: {
            query?: never;
            header: {
                /** @description The key's public id (UUID) */
                "Audit-Key-Id": string;
                /** @description Unix seconds, within ±300 s */
                "Audit-Timestamp": string;
                /** @description 16 random bytes, base64url; single use */
                "Audit-Nonce": string;
                /** @description sha-256=<base64url> of the canonical JSON (RFC 8785) of the body */
                "Audit-Body-Digest": string;
                /** @description v1=<base64url HMAC-SHA256> over the canonical string (contract.md) */
                "Audit-Signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    contractVersion: number;
                    catalog: {
                        /** @enum {number} */
                        catalogFormat: 1;
                        app: {
                            name: string;
                            version: string;
                        };
                        responseActions?: ("revoke_sessions" | "require_password_change" | "disable_account")[];
                        actions: {
                            [key: string]: {
                                /** @enum {string} */
                                category: "security" | "audit" | "access" | "system";
                                /** @enum {string} */
                                severity: "info" | "low" | "medium" | "high" | "critical";
                                description: string;
                                /** @enum {string} */
                                source: "server" | "client" | "both";
                                outcomes?: ("success" | "failure" | "denied")[];
                                tags?: ("auth.sign_in" | "auth.sign_in_failed" | "auth.sign_out" | "auth.session_reuse" | "auth.credential_changed" | "auth.recovery" | "iam.privilege_changed" | "iam.account_created" | "iam.account_disabled" | "data.bulk_export" | "data.bulk_delete" | "data.read_other_user" | "http.rejected" | "security.prompt_answered" | "response.executed" | "privacy.erasure_requested")[];
                                resourceType?: string;
                                userVisible?: boolean;
                                details?: {
                                    fields: {
                                        [key: string]: {
                                            /** @enum {string} */
                                            type: "string";
                                            maxLength?: number;
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "integer";
                                            min?: number;
                                            max?: number;
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "number";
                                            min?: number;
                                            max?: number;
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "boolean";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "enum";
                                            values: string[];
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "uuid";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "datetime";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "id";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "ip";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "country";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "string[]";
                                            maxItems?: number;
                                            maxLength?: number;
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        };
                                    };
                                };
                                change?: {
                                    fields: {
                                        [key: string]: {
                                            /** @enum {string} */
                                            type: "string";
                                            maxLength?: number;
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "integer";
                                            min?: number;
                                            max?: number;
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "number";
                                            min?: number;
                                            max?: number;
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "boolean";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "enum";
                                            values: string[];
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "uuid";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "datetime";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "id";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "ip";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "country";
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        } | {
                                            /** @enum {string} */
                                            type: "string[]";
                                            maxItems?: number;
                                            maxLength?: number;
                                            required?: boolean;
                                            personal?: boolean;
                                            sensitive?: boolean;
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            version: string;
                            /** @enum {string} */
                            status: "created" | "unchanged";
                            actions: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    IngestController_heartbeat: {
        parameters: {
            query?: never;
            header: {
                /** @description The key's public id (UUID) */
                "Audit-Key-Id": string;
                /** @description Unix seconds, within ±300 s */
                "Audit-Timestamp": string;
                /** @description 16 random bytes, base64url; single use */
                "Audit-Nonce": string;
                /** @description sha-256=<base64url> of the canonical JSON (RFC 8785) of the body */
                "Audit-Body-Digest": string;
                /** @description v1=<base64url HMAC-SHA256> over the canonical string (contract.md) */
                "Audit-Signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    contractVersion: number;
                    connector: {
                        name: string;
                        version: string;
                    };
                    /** Format: uuid */
                    instanceId: string;
                    appVersion: string;
                    catalogVersion: string;
                    /** Format: uuid */
                    sequenceEpoch: string;
                    lastAssignedSeq: number;
                    queue: {
                        size: number;
                        oldestAgeSeconds: number;
                        retrying: number;
                        discardedAtSignOut: number;
                    };
                    responseActions: string[];
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            serverTime: string;
                            contractVersions: number[];
                            lastContiguousSeq: number;
                            connectorNotice: string | null;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    IntegrityController_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            streams: {
                                /** Format: uuid */
                                appId: string;
                                slug: string;
                                category: string;
                                lastSealNo: string | null;
                                /** Format: date-time */
                                sealedThrough: string | null;
                                unsealedEvents: number;
                            }[];
                            verifications: {
                                /** Format: uuid */
                                id: string;
                                trigger: string;
                                /** @enum {string} */
                                outcome: "passed" | "failed" | "error";
                                sealsChecked: number;
                                eventsChecked: string;
                                failures: number;
                                failureSample: {
                                    [key: string]: string;
                                }[] | null;
                                /** Format: date-time */
                                startedAt: string;
                                /** Format: date-time */
                                finishedAt: string;
                            }[];
                            lastCheckpoint: {
                                /** Format: uuid */
                                id: string;
                                digest: string;
                                /** Format: date-time */
                                createdAt: string;
                            } | null;
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    RetentionController_policies: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            class: "security" | "audit" | "access" | "system" | "audit_access" | "personal" | "location";
                            minimumDays: number;
                            days: number;
                            custom: boolean;
                        }[];
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    RetentionController_setPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
                class: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    days: number;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            class: "security" | "audit" | "access" | "system" | "audit_access" | "personal" | "location";
                            minimumDays: number;
                            days: number;
                            custom: boolean;
                        }[];
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    RetentionController_holds: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            caseRef: string;
                            reason: string;
                            actorId: string | null;
                            byEmail: boolean;
                            resourceType: string | null;
                            resourceId: string | null;
                            /** Format: date-time */
                            fromAt: string | null;
                            /** Format: date-time */
                            toAt: string | null;
                            /** Format: uuid */
                            createdById: string;
                            /** Format: date-time */
                            createdAt: string;
                            release: {
                                reason: string;
                                /** Format: uuid */
                                releasedById: string;
                                /** Format: date-time */
                                releasedAt: string;
                            } | null;
                        }[];
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    RetentionController_createHold: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    appId: string;
                    caseRef: string;
                    reason: string;
                    actorId?: string;
                    actorEmail?: string;
                    resourceType?: string;
                    resourceId?: string;
                    /** Format: date-time */
                    fromAt?: string;
                    /** Format: date-time */
                    toAt?: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            caseRef: string;
                            reason: string;
                            actorId: string | null;
                            byEmail: boolean;
                            resourceType: string | null;
                            resourceId: string | null;
                            /** Format: date-time */
                            fromAt: string | null;
                            /** Format: date-time */
                            toAt: string | null;
                            /** Format: uuid */
                            createdById: string;
                            /** Format: date-time */
                            createdAt: string;
                            release: {
                                reason: string;
                                /** Format: uuid */
                                releasedById: string;
                                /** Format: date-time */
                                releasedAt: string;
                            } | null;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    RetentionController_release: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            caseRef: string;
                            reason: string;
                            actorId: string | null;
                            byEmail: boolean;
                            resourceType: string | null;
                            resourceId: string | null;
                            /** Format: date-time */
                            fromAt: string | null;
                            /** Format: date-time */
                            toAt: string | null;
                            /** Format: uuid */
                            createdById: string;
                            /** Format: date-time */
                            createdAt: string;
                            release: {
                                reason: string;
                                /** Format: uuid */
                                releasedById: string;
                                /** Format: date-time */
                                releasedAt: string;
                            } | null;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    UserAccessController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            userId: string;
                            /** @enum {string} */
                            role: "member" | "viewer" | "auditor" | "admin";
                            /** Format: date-time */
                            mfaConfirmedAt: string | null;
                            /** Format: date-time */
                            disabledAt: string | null;
                            /** Format: date-time */
                            removedAt: string | null;
                            apps: {
                                /** Format: uuid */
                                appId: string;
                                slug: string;
                                name: string;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    UserAccessController_changeRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    role: "member" | "viewer" | "auditor" | "admin";
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            userId: string;
                            /** @enum {string} */
                            role: "member" | "viewer" | "auditor" | "admin";
                            /** Format: date-time */
                            mfaConfirmedAt: string | null;
                            /** Format: date-time */
                            disabledAt: string | null;
                            /** Format: date-time */
                            removedAt: string | null;
                            apps: {
                                /** Format: uuid */
                                appId: string;
                                slug: string;
                                name: string;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    UserAccessController_changeStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    disabled: boolean;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            userId: string;
                            /** @enum {string} */
                            role: "member" | "viewer" | "auditor" | "admin";
                            /** Format: date-time */
                            mfaConfirmedAt: string | null;
                            /** Format: date-time */
                            disabledAt: string | null;
                            /** Format: date-time */
                            removedAt: string | null;
                            apps: {
                                /** Format: uuid */
                                appId: string;
                                slug: string;
                                name: string;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    UserAccessController_assignApps: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    appIds: string[];
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            userId: string;
                            /** @enum {string} */
                            role: "member" | "viewer" | "auditor" | "admin";
                            /** Format: date-time */
                            mfaConfirmedAt: string | null;
                            /** Format: date-time */
                            disabledAt: string | null;
                            /** Format: date-time */
                            removedAt: string | null;
                            apps: {
                                /** Format: uuid */
                                appId: string;
                                slug: string;
                                name: string;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AccountAppsController_apps: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                appId: string;
                                slug: string;
                                name: string;
                                environment: string;
                                status: string;
                                system: boolean;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    WebhooksController_ping: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    WebhooksController_deliveries: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                target: "app" | "slack" | "teams";
                                type: string;
                                /** @enum {string} */
                                status: "pending" | "sending" | "delivered" | "failed" | "expired";
                                attempts: number;
                                lastStatus: number | null;
                                lastError: string | null;
                                /** Format: date-time */
                                nextAttemptAt: string;
                                /** Format: date-time */
                                deliveredAt: string | null;
                                /** Format: date-time */
                                expiresAt: string;
                                /** Format: date-time */
                                createdAt: string;
                            }[];
                            total: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AlertsController_live: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AlertsController_summary: {
        parameters: {
            query?: {
                appId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            open: {
                                info: number;
                                low: number;
                                medium: number;
                                high: number;
                                critical: number;
                            };
                            inReview: {
                                info: number;
                                low: number;
                                medium: number;
                                high: number;
                                critical: number;
                            };
                            muted: number;
                            /** Format: date-time */
                            oldestOpenAt: string | null;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AlertsController_list: {
        parameters: {
            query?: {
                appId?: string;
                status?: ("open" | "in_review" | "resolved" | "false_positive")[];
                severity?: ("info" | "low" | "medium" | "high" | "critical")[];
                rule?: string;
                assigneeId?: string;
                q?: string;
                from?: string;
                to?: string;
                muted?: "true" | "false";
                sort?: "last_seen" | "first_seen" | "severity" | "status";
                order?: "asc" | "desc";
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                appId: string;
                                appSlug: string;
                                rule: string;
                                /** @enum {string} */
                                severity: "info" | "low" | "medium" | "high" | "critical";
                                /** @enum {string} */
                                status: "open" | "in_review" | "resolved" | "false_positive";
                                subject: string | null;
                                subjectLabel: string | null;
                                title: string;
                                occurrences: number;
                                /** Format: date-time */
                                firstSeenAt: string;
                                /** Format: date-time */
                                lastSeenAt: string;
                                /** Format: uuid */
                                assigneeId: string | null;
                                /** Format: date-time */
                                resolvedAt: string | null;
                                /** Format: uuid */
                                resolvedById: string | null;
                                /** Format: date-time */
                                acknowledgedAt: string | null;
                                /** Format: uuid */
                                acknowledgedById: string | null;
                                escalations: number;
                                /** Format: date-time */
                                lastEscalatedAt: string | null;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                mutedUntil: string | null;
                                /** Format: date-time */
                                updatedAt: string;
                                version: number;
                            }[];
                            total: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AlertsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            appSlug: string;
                            rule: string;
                            /** @enum {string} */
                            severity: "info" | "low" | "medium" | "high" | "critical";
                            /** @enum {string} */
                            status: "open" | "in_review" | "resolved" | "false_positive";
                            subject: string | null;
                            subjectLabel: string | null;
                            title: string;
                            occurrences: number;
                            /** Format: date-time */
                            firstSeenAt: string;
                            /** Format: date-time */
                            lastSeenAt: string;
                            /** Format: uuid */
                            assigneeId: string | null;
                            /** Format: date-time */
                            resolvedAt: string | null;
                            /** Format: uuid */
                            resolvedById: string | null;
                            /** Format: date-time */
                            acknowledgedAt: string | null;
                            /** Format: uuid */
                            acknowledgedById: string | null;
                            escalations: number;
                            /** Format: date-time */
                            lastEscalatedAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            mutedUntil: string | null;
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                            summary: {
                                [key: string]: unknown;
                            };
                            explanation: {
                                looksFor: string | null;
                                saw: string[];
                            };
                            evidence: {
                                events: number;
                                /** Format: date-time */
                                from: string | null;
                                /** Format: date-time */
                                to: string | null;
                                outcomes: {
                                    value: string;
                                    count: number;
                                }[];
                                reasons: {
                                    value: string;
                                    count: number;
                                }[];
                                actions: {
                                    value: string;
                                    count: number;
                                }[];
                                accounts: number;
                                countries: {
                                    value: string;
                                    count: number;
                                }[];
                                devices: {
                                    value: string;
                                    count: number;
                                }[];
                            };
                            assigneeLabel: string | null;
                            resolvedByLabel: string | null;
                            acknowledgedByLabel: string | null;
                            activities: {
                                /** Format: uuid */
                                id: string;
                                kind: string;
                                /** Format: uuid */
                                userId: string | null;
                                userLabel: string | null;
                                fromStatus: string | null;
                                toStatus: string | null;
                                note: string | null;
                                assigneeLabel: string | null;
                                /** Format: date-time */
                                createdAt: string;
                            }[];
                            events: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                eventId: string;
                                /** Format: uuid */
                                appId: string;
                                appSlug: string;
                                /** Format: date-time */
                                recordedAt: string;
                                /** Format: date-time */
                                occurredAt: string;
                                category: string;
                                action: string;
                                description: string | null;
                                outcome: string;
                                severity: string;
                                riskScore: number;
                                actor: {
                                    type: string;
                                    id: string | null;
                                    role: string | null;
                                    label: string | null;
                                };
                                resource: {
                                    type: string;
                                    id: string;
                                } | null;
                                requestId: string | null;
                                httpStatus: number | null;
                                clientType: string | null;
                                country: string | null;
                                ipScope: string | null;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AlertsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    status?: "open" | "in_review" | "resolved" | "false_positive";
                    /** Format: uuid */
                    assigneeId?: string | null;
                    reason?: string;
                    version: number;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            appSlug: string;
                            rule: string;
                            /** @enum {string} */
                            severity: "info" | "low" | "medium" | "high" | "critical";
                            /** @enum {string} */
                            status: "open" | "in_review" | "resolved" | "false_positive";
                            subject: string | null;
                            subjectLabel: string | null;
                            title: string;
                            occurrences: number;
                            /** Format: date-time */
                            firstSeenAt: string;
                            /** Format: date-time */
                            lastSeenAt: string;
                            /** Format: uuid */
                            assigneeId: string | null;
                            /** Format: date-time */
                            resolvedAt: string | null;
                            /** Format: uuid */
                            resolvedById: string | null;
                            /** Format: date-time */
                            acknowledgedAt: string | null;
                            /** Format: uuid */
                            acknowledgedById: string | null;
                            escalations: number;
                            /** Format: date-time */
                            lastEscalatedAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            mutedUntil: string | null;
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                            summary: {
                                [key: string]: unknown;
                            };
                            explanation: {
                                looksFor: string | null;
                                saw: string[];
                            };
                            evidence: {
                                events: number;
                                /** Format: date-time */
                                from: string | null;
                                /** Format: date-time */
                                to: string | null;
                                outcomes: {
                                    value: string;
                                    count: number;
                                }[];
                                reasons: {
                                    value: string;
                                    count: number;
                                }[];
                                actions: {
                                    value: string;
                                    count: number;
                                }[];
                                accounts: number;
                                countries: {
                                    value: string;
                                    count: number;
                                }[];
                                devices: {
                                    value: string;
                                    count: number;
                                }[];
                            };
                            assigneeLabel: string | null;
                            resolvedByLabel: string | null;
                            acknowledgedByLabel: string | null;
                            activities: {
                                /** Format: uuid */
                                id: string;
                                kind: string;
                                /** Format: uuid */
                                userId: string | null;
                                userLabel: string | null;
                                fromStatus: string | null;
                                toStatus: string | null;
                                note: string | null;
                                assigneeLabel: string | null;
                                /** Format: date-time */
                                createdAt: string;
                            }[];
                            events: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                eventId: string;
                                /** Format: uuid */
                                appId: string;
                                appSlug: string;
                                /** Format: date-time */
                                recordedAt: string;
                                /** Format: date-time */
                                occurredAt: string;
                                category: string;
                                action: string;
                                description: string | null;
                                outcome: string;
                                severity: string;
                                riskScore: number;
                                actor: {
                                    type: string;
                                    id: string | null;
                                    role: string | null;
                                    label: string | null;
                                };
                                resource: {
                                    type: string;
                                    id: string;
                                } | null;
                                requestId: string | null;
                                httpStatus: number | null;
                                clientType: string | null;
                                country: string | null;
                                ipScope: string | null;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AlertsController_acknowledge: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            appSlug: string;
                            rule: string;
                            /** @enum {string} */
                            severity: "info" | "low" | "medium" | "high" | "critical";
                            /** @enum {string} */
                            status: "open" | "in_review" | "resolved" | "false_positive";
                            subject: string | null;
                            subjectLabel: string | null;
                            title: string;
                            occurrences: number;
                            /** Format: date-time */
                            firstSeenAt: string;
                            /** Format: date-time */
                            lastSeenAt: string;
                            /** Format: uuid */
                            assigneeId: string | null;
                            /** Format: date-time */
                            resolvedAt: string | null;
                            /** Format: uuid */
                            resolvedById: string | null;
                            /** Format: date-time */
                            acknowledgedAt: string | null;
                            /** Format: uuid */
                            acknowledgedById: string | null;
                            escalations: number;
                            /** Format: date-time */
                            lastEscalatedAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            mutedUntil: string | null;
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                            summary: {
                                [key: string]: unknown;
                            };
                            explanation: {
                                looksFor: string | null;
                                saw: string[];
                            };
                            evidence: {
                                events: number;
                                /** Format: date-time */
                                from: string | null;
                                /** Format: date-time */
                                to: string | null;
                                outcomes: {
                                    value: string;
                                    count: number;
                                }[];
                                reasons: {
                                    value: string;
                                    count: number;
                                }[];
                                actions: {
                                    value: string;
                                    count: number;
                                }[];
                                accounts: number;
                                countries: {
                                    value: string;
                                    count: number;
                                }[];
                                devices: {
                                    value: string;
                                    count: number;
                                }[];
                            };
                            assigneeLabel: string | null;
                            resolvedByLabel: string | null;
                            acknowledgedByLabel: string | null;
                            activities: {
                                /** Format: uuid */
                                id: string;
                                kind: string;
                                /** Format: uuid */
                                userId: string | null;
                                userLabel: string | null;
                                fromStatus: string | null;
                                toStatus: string | null;
                                note: string | null;
                                assigneeLabel: string | null;
                                /** Format: date-time */
                                createdAt: string;
                            }[];
                            events: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                eventId: string;
                                /** Format: uuid */
                                appId: string;
                                appSlug: string;
                                /** Format: date-time */
                                recordedAt: string;
                                /** Format: date-time */
                                occurredAt: string;
                                category: string;
                                action: string;
                                description: string | null;
                                outcome: string;
                                severity: string;
                                riskScore: number;
                                actor: {
                                    type: string;
                                    id: string | null;
                                    role: string | null;
                                    label: string | null;
                                };
                                resource: {
                                    type: string;
                                    id: string;
                                } | null;
                                requestId: string | null;
                                httpStatus: number | null;
                                clientType: string | null;
                                country: string | null;
                                ipScope: string | null;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AlertsController_addNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    note: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            appSlug: string;
                            rule: string;
                            /** @enum {string} */
                            severity: "info" | "low" | "medium" | "high" | "critical";
                            /** @enum {string} */
                            status: "open" | "in_review" | "resolved" | "false_positive";
                            subject: string | null;
                            subjectLabel: string | null;
                            title: string;
                            occurrences: number;
                            /** Format: date-time */
                            firstSeenAt: string;
                            /** Format: date-time */
                            lastSeenAt: string;
                            /** Format: uuid */
                            assigneeId: string | null;
                            /** Format: date-time */
                            resolvedAt: string | null;
                            /** Format: uuid */
                            resolvedById: string | null;
                            /** Format: date-time */
                            acknowledgedAt: string | null;
                            /** Format: uuid */
                            acknowledgedById: string | null;
                            escalations: number;
                            /** Format: date-time */
                            lastEscalatedAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            mutedUntil: string | null;
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                            summary: {
                                [key: string]: unknown;
                            };
                            explanation: {
                                looksFor: string | null;
                                saw: string[];
                            };
                            evidence: {
                                events: number;
                                /** Format: date-time */
                                from: string | null;
                                /** Format: date-time */
                                to: string | null;
                                outcomes: {
                                    value: string;
                                    count: number;
                                }[];
                                reasons: {
                                    value: string;
                                    count: number;
                                }[];
                                actions: {
                                    value: string;
                                    count: number;
                                }[];
                                accounts: number;
                                countries: {
                                    value: string;
                                    count: number;
                                }[];
                                devices: {
                                    value: string;
                                    count: number;
                                }[];
                            };
                            assigneeLabel: string | null;
                            resolvedByLabel: string | null;
                            acknowledgedByLabel: string | null;
                            activities: {
                                /** Format: uuid */
                                id: string;
                                kind: string;
                                /** Format: uuid */
                                userId: string | null;
                                userLabel: string | null;
                                fromStatus: string | null;
                                toStatus: string | null;
                                note: string | null;
                                assigneeLabel: string | null;
                                /** Format: date-time */
                                createdAt: string;
                            }[];
                            events: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                eventId: string;
                                /** Format: uuid */
                                appId: string;
                                appSlug: string;
                                /** Format: date-time */
                                recordedAt: string;
                                /** Format: date-time */
                                occurredAt: string;
                                category: string;
                                action: string;
                                description: string | null;
                                outcome: string;
                                severity: string;
                                riskScore: number;
                                actor: {
                                    type: string;
                                    id: string | null;
                                    role: string | null;
                                    label: string | null;
                                };
                                resource: {
                                    type: string;
                                    id: string;
                                } | null;
                                requestId: string | null;
                                httpStatus: number | null;
                                clientType: string | null;
                                country: string | null;
                                ipScope: string | null;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AlertMutesController_list: {
        parameters: {
            query?: {
                appId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                appId: string;
                                appSlug: string;
                                rule: string | null;
                                reason: string;
                                /** Format: date-time */
                                until: string;
                                /** Format: uuid */
                                createdById: string;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                endedAt: string | null;
                                /** Format: uuid */
                                endedById: string | null;
                                active: boolean;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AlertMutesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    appId: string;
                    rule: string | null;
                    minutes: number;
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            appSlug: string;
                            rule: string | null;
                            reason: string;
                            /** Format: date-time */
                            until: string;
                            /** Format: uuid */
                            createdById: string;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            endedAt: string | null;
                            /** Format: uuid */
                            endedById: string | null;
                            active: boolean;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    AlertMutesController_end: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            appSlug: string;
                            rule: string | null;
                            reason: string;
                            /** Format: date-time */
                            until: string;
                            /** Format: uuid */
                            createdById: string;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            endedAt: string | null;
                            /** Format: uuid */
                            endedById: string | null;
                            active: boolean;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    DetectionController_listRules: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                id: string;
                                name: string;
                                description: string;
                                kind: string;
                                /** @enum {string|null} */
                                severity: "info" | "low" | "medium" | "high" | "critical" | null;
                                grouping: string;
                                window: string | null;
                                autoResolves: boolean;
                                params: {
                                    name: string;
                                    label: string;
                                    unit: string;
                                    default: number;
                                    min: number;
                                    max: number;
                                }[];
                                settings: {
                                    enabled: boolean;
                                    /** @enum {string|null} */
                                    severity: "info" | "low" | "medium" | "high" | "critical" | null;
                                    params: {
                                        [key: string]: number;
                                    };
                                    /** Format: uuid */
                                    updatedById: string | null;
                                    /** Format: date-time */
                                    updatedAt: string | null;
                                };
                            }[];
                            maxNewAlertsPerHour: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    DetectionController_updateRule: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rule: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    enabled: boolean;
                    /** @enum {string|null} */
                    severity: "info" | "low" | "medium" | "high" | "critical" | null;
                    /** @default {} */
                    params?: {
                        [key: string]: number;
                    };
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            name: string;
                            description: string;
                            kind: string;
                            /** @enum {string|null} */
                            severity: "info" | "low" | "medium" | "high" | "critical" | null;
                            grouping: string;
                            window: string | null;
                            autoResolves: boolean;
                            params: {
                                name: string;
                                label: string;
                                unit: string;
                                default: number;
                                min: number;
                                max: number;
                            }[];
                            settings: {
                                enabled: boolean;
                                /** @enum {string|null} */
                                severity: "info" | "low" | "medium" | "high" | "critical" | null;
                                params: {
                                    [key: string]: number;
                                };
                                /** Format: uuid */
                                updatedById: string | null;
                                /** Format: date-time */
                                updatedAt: string | null;
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    DetectionController_listPolicies: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** @enum {string} */
                                severity: "info" | "low" | "medium" | "high" | "critical";
                                enabled: boolean;
                                firstAfterMinutes: number;
                                repeatEveryMinutes: number;
                                maxEscalations: number;
                                channels: ("email" | "chat")[];
                                /** Format: uuid */
                                updatedById: string | null;
                                /** Format: date-time */
                                updatedAt: string;
                            }[];
                            available: {
                                email: boolean;
                                chat: string[];
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    DetectionController_updatePolicy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                severity: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    enabled: boolean;
                    firstAfterMinutes: number;
                    repeatEveryMinutes: number;
                    maxEscalations: number;
                    channels: ("email" | "chat")[];
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            severity: "info" | "low" | "medium" | "high" | "critical";
                            enabled: boolean;
                            firstAfterMinutes: number;
                            repeatEveryMinutes: number;
                            maxEscalations: number;
                            channels: ("email" | "chat")[];
                            /** Format: uuid */
                            updatedById: string | null;
                            /** Format: date-time */
                            updatedAt: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ExplorerController_overview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            since: string;
                            integrity: {
                                /** @enum {string} */
                                outcome: "passed" | "failed" | "error";
                                /** Format: date-time */
                                finishedAt: string;
                            } | null;
                            apps: {
                                /** Format: uuid */
                                appId: string;
                                slug: string;
                                name: string;
                                status: string;
                                events24h: number;
                                highRisk24h: number;
                                rejected24h: number;
                                openAlerts: {
                                    [key: string]: number;
                                };
                                /** Format: date-time */
                                lastHeartbeatAt: string | null;
                                queueSize: number;
                                openGaps: number;
                                trend: number[];
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ExplorerController_search: {
        parameters: {
            query?: {
                appId?: string;
                from?: string;
                to?: string;
                category?: "security" | "audit" | "access" | "system" | "audit_access";
                action?: string;
                outcome?: "success" | "failure" | "denied";
                severity?: "info" | "low" | "medium" | "high" | "critical";
                minRisk?: number;
                actorId?: string;
                email?: string;
                resourceType?: string;
                resourceId?: string;
                ip?: string;
                country?: string;
                clientType?: "web" | "ios" | "android" | "api" | "job";
                requestId?: string;
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                eventId: string;
                                /** Format: uuid */
                                appId: string;
                                appSlug: string;
                                /** Format: date-time */
                                recordedAt: string;
                                /** Format: date-time */
                                occurredAt: string;
                                category: string;
                                action: string;
                                description: string | null;
                                outcome: string;
                                severity: string;
                                riskScore: number;
                                actor: {
                                    type: string;
                                    id: string | null;
                                    role: string | null;
                                    label: string | null;
                                };
                                resource: {
                                    type: string;
                                    id: string;
                                } | null;
                                requestId: string | null;
                                httpStatus: number | null;
                                clientType: string | null;
                                country: string | null;
                                ipScope: string | null;
                            }[];
                            nextCursor: string | null;
                            /** @enum {boolean} */
                            blocked?: true;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ExplorerController_detail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            eventId: string;
                            /** Format: uuid */
                            appId: string;
                            appSlug: string;
                            /** Format: date-time */
                            recordedAt: string;
                            /** Format: date-time */
                            occurredAt: string;
                            category: string;
                            action: string;
                            description: string | null;
                            outcome: string;
                            severity: string;
                            riskScore: number;
                            actor: {
                                type: string;
                                id: string | null;
                                role: string | null;
                                label: string | null;
                            };
                            resource: {
                                type: string;
                                id: string;
                            } | null;
                            requestId: string | null;
                            httpStatus: number | null;
                            clientType: string | null;
                            country: string | null;
                            ipScope: string | null;
                            /** Format: date-time */
                            blockedSince: string | null;
                            sequence: {
                                epoch: string;
                                seq: string;
                            } | null;
                            catalog: {
                                description: string | null;
                                tags: string[];
                            };
                            reason: string | null;
                            actorDetail: {
                                emailPseudonym: string | null;
                                impersonatorId: string | null;
                                sessionRef: string | null;
                            };
                            parentResource: {
                                type: string;
                                id: string;
                            } | null;
                            change: {
                                before: unknown;
                                after: unknown;
                                fields: string[];
                            };
                            request: {
                                method: string | null;
                                route: string | null;
                                traceId: string | null;
                                durationMs: number | null;
                            };
                            client: {
                                appVersion: string | null;
                                appBuild: string | null;
                                os: string | null;
                                osVersion: string | null;
                                deviceModel: string | null;
                                locale: string | null;
                                timeZone: string | null;
                                networkType: string | null;
                                route: string | null;
                                sdk: string | null;
                                declared: string[];
                            };
                            network: {
                                asn: number | null;
                                browser: string | null;
                                os: string | null;
                                deviceClass: string | null;
                            };
                            details: unknown;
                            personal: {
                                ip: string | null;
                                userAgent: string | null;
                                agent: {
                                    browser: string | null;
                                    os: string | null;
                                    device: string | null;
                                } | null;
                                deviceId: string | null;
                                actorLabel: string | null;
                                actorPhone: string | null;
                                resourceLabel: string | null;
                                subdivision: string | null;
                                city: string | null;
                                approximateLocation: {
                                    latitude: number;
                                    longitude: number;
                                    accuracyKm: number | null;
                                } | null;
                                change: unknown;
                            } | null;
                            location: {
                                latitude: number;
                                longitude: number;
                                accuracyM: number;
                                /** Format: date-time */
                                capturedAt: string;
                            } | null;
                            quality: {
                                truncatedFields: string[];
                                droppedFields: string[];
                                flags: string[];
                            };
                            integrity: {
                                sealed: boolean;
                                sealNo: string | null;
                                /** Format: date-time */
                                verifiedAt: string | null;
                                contentHash: string;
                                seal: {
                                    hash: string;
                                    signature: string;
                                    keyId: string;
                                } | null;
                            };
                            related: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                eventId: string;
                                /** Format: uuid */
                                appId: string;
                                appSlug: string;
                                /** Format: date-time */
                                recordedAt: string;
                                /** Format: date-time */
                                occurredAt: string;
                                category: string;
                                action: string;
                                description: string | null;
                                outcome: string;
                                severity: string;
                                riskScore: number;
                                actor: {
                                    type: string;
                                    id: string | null;
                                    role: string | null;
                                    label: string | null;
                                };
                                resource: {
                                    type: string;
                                    id: string;
                                } | null;
                                requestId: string | null;
                                httpStatus: number | null;
                                clientType: string | null;
                                country: string | null;
                                ipScope: string | null;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ExplorerController_subject: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                acrossApps?: "true" | "false";
            };
            header?: never;
            path: {
                appId: string;
                subject: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            subject: string;
                            /** Format: uuid */
                            appId: string;
                            /** Format: date-time */
                            blockedSince: string | null;
                            /** Format: date-time */
                            blockedThrough: string | null;
                            summary: {
                                /** Format: date-time */
                                firstSeenAt: string | null;
                                /** Format: date-time */
                                lastSeenAt: string | null;
                                /** Format: date-time */
                                lastSignInAt: string | null;
                                devices: number;
                                countries: string[];
                                openAlerts: number;
                                otherApps: {
                                    /** Format: uuid */
                                    appId: string;
                                    slug: string;
                                }[];
                            };
                            events: {
                                items: {
                                    /** Format: uuid */
                                    id: string;
                                    /** Format: uuid */
                                    eventId: string;
                                    /** Format: uuid */
                                    appId: string;
                                    appSlug: string;
                                    /** Format: date-time */
                                    recordedAt: string;
                                    /** Format: date-time */
                                    occurredAt: string;
                                    category: string;
                                    action: string;
                                    description: string | null;
                                    outcome: string;
                                    severity: string;
                                    riskScore: number;
                                    actor: {
                                        type: string;
                                        id: string | null;
                                        role: string | null;
                                        label: string | null;
                                    };
                                    resource: {
                                        type: string;
                                        id: string;
                                    } | null;
                                    requestId: string | null;
                                    httpStatus: number | null;
                                    clientType: string | null;
                                    country: string | null;
                                    ipScope: string | null;
                                }[];
                                nextCursor: string | null;
                                /** @enum {boolean} */
                                blocked?: true;
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ExplorerController_resource: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                appId: string;
                resourceType: string;
                resource: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                eventId: string;
                                /** Format: uuid */
                                appId: string;
                                appSlug: string;
                                /** Format: date-time */
                                recordedAt: string;
                                /** Format: date-time */
                                occurredAt: string;
                                category: string;
                                action: string;
                                description: string | null;
                                outcome: string;
                                severity: string;
                                riskScore: number;
                                actor: {
                                    type: string;
                                    id: string | null;
                                    role: string | null;
                                    label: string | null;
                                };
                                resource: {
                                    type: string;
                                    id: string;
                                } | null;
                                requestId: string | null;
                                httpStatus: number | null;
                                clientType: string | null;
                                country: string | null;
                                ipScope: string | null;
                            }[];
                            nextCursor: string | null;
                            /** @enum {boolean} */
                            blocked?: true;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ExplorerController_security: {
        parameters: {
            query?: {
                days?: number;
            };
            header?: never;
            path: {
                appId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            appId: string;
                            days: number;
                            geolocation: boolean;
                            failedSignIns: {
                                day: string;
                                count: number;
                            }[];
                            topIps: {
                                ip: string;
                                count: number;
                                accounts: number;
                            }[];
                            topCountries: {
                                country: string;
                                count: number;
                            }[];
                            heatmap: {
                                dow: number;
                                hour: number;
                                count: number;
                            }[];
                            anomalies: {
                                rule: string;
                                severity: string;
                                open: number;
                            }[];
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ExplorerController_erase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
                subject: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /**
                     * @default personal
                     * @enum {string}
                     */
                    scope?: "personal" | "events";
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            personalDeleted: number;
                            locationDeleted: number;
                            held: number;
                            eventsDeleted?: number;
                            eventsPending?: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ExportsController_events: {
        parameters: {
            query: {
                appId?: string;
                from?: string;
                to?: string;
                category?: "security" | "audit" | "access" | "system" | "audit_access";
                action?: string;
                outcome?: "success" | "failure" | "denied";
                severity?: "info" | "low" | "medium" | "high" | "critical";
                minRisk?: number;
                actorId?: string;
                email?: string;
                resourceType?: string;
                resourceId?: string;
                ip?: string;
                country?: string;
                clientType?: "web" | "ios" | "android" | "api" | "job";
                requestId?: string;
                format: "csv" | "jsonl";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The export, streamed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": components["schemas"]["ErrorResponse"];
                    "application/x-ndjson": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": components["schemas"]["ErrorResponse"];
                    "application/x-ndjson": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ExportsController_list: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                requestedById: string;
                                format: string;
                                status: string;
                                rowCap: number;
                                rowCount: number | null;
                                digest: string | null;
                                filters: {
                                    [key: string]: unknown;
                                };
                                /** Format: date-time */
                                startedAt: string;
                                /** Format: date-time */
                                finishedAt: string | null;
                            }[];
                            total: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ExportsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            requestedById: string;
                            format: string;
                            status: string;
                            rowCap: number;
                            rowCount: number | null;
                            digest: string | null;
                            filters: {
                                [key: string]: unknown;
                            };
                            /** Format: date-time */
                            startedAt: string;
                            /** Format: date-time */
                            finishedAt: string | null;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ResponseActionsController_list: {
        parameters: {
            query?: {
                appId?: string;
                status?: "pending_approval" | "dispatched" | "succeeded" | "failed" | "refused" | "unsupported" | "expired" | "cancelled";
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                appId: string;
                                subject: string;
                                /** @enum {string} */
                                action: "revoke_sessions" | "require_password_change" | "disable_account";
                                reason: string;
                                /** @enum {string} */
                                status: "pending_approval" | "dispatched" | "succeeded" | "failed" | "refused" | "unsupported" | "expired" | "cancelled";
                                /** Format: uuid */
                                alertId: string | null;
                                /** Format: uuid */
                                requestedById: string;
                                /** Format: uuid */
                                approvedById: string | null;
                                /** Format: date-time */
                                approvedAt: string | null;
                                /** Format: date-time */
                                expiresAt: string;
                                /** Format: date-time */
                                completedAt: string | null;
                                /** Format: date-time */
                                createdAt: string;
                            }[];
                            total: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ResponseActionsController_request: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    appId: string;
                    subject: string;
                    /** @enum {string} */
                    action: "revoke_sessions" | "require_password_change" | "disable_account";
                    reason: string;
                    /** Format: uuid */
                    alertId?: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            subject: string;
                            /** @enum {string} */
                            action: "revoke_sessions" | "require_password_change" | "disable_account";
                            reason: string;
                            /** @enum {string} */
                            status: "pending_approval" | "dispatched" | "succeeded" | "failed" | "refused" | "unsupported" | "expired" | "cancelled";
                            /** Format: uuid */
                            alertId: string | null;
                            /** Format: uuid */
                            requestedById: string;
                            /** Format: uuid */
                            approvedById: string | null;
                            /** Format: date-time */
                            approvedAt: string | null;
                            /** Format: date-time */
                            expiresAt: string;
                            /** Format: date-time */
                            completedAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ResponseActionsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            subject: string;
                            /** @enum {string} */
                            action: "revoke_sessions" | "require_password_change" | "disable_account";
                            reason: string;
                            /** @enum {string} */
                            status: "pending_approval" | "dispatched" | "succeeded" | "failed" | "refused" | "unsupported" | "expired" | "cancelled";
                            /** Format: uuid */
                            alertId: string | null;
                            /** Format: uuid */
                            requestedById: string;
                            /** Format: uuid */
                            approvedById: string | null;
                            /** Format: date-time */
                            approvedAt: string | null;
                            /** Format: date-time */
                            expiresAt: string;
                            /** Format: date-time */
                            completedAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ResponseActionsController_approve: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            subject: string;
                            /** @enum {string} */
                            action: "revoke_sessions" | "require_password_change" | "disable_account";
                            reason: string;
                            /** @enum {string} */
                            status: "pending_approval" | "dispatched" | "succeeded" | "failed" | "refused" | "unsupported" | "expired" | "cancelled";
                            /** Format: uuid */
                            alertId: string | null;
                            /** Format: uuid */
                            requestedById: string;
                            /** Format: uuid */
                            approvedById: string | null;
                            /** Format: date-time */
                            approvedAt: string | null;
                            /** Format: date-time */
                            expiresAt: string;
                            /** Format: date-time */
                            completedAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /**
             * @description Not allowed
             *
             *     Not allowed
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ResponseActionsController_cancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            appId: string;
                            subject: string;
                            /** @enum {string} */
                            action: "revoke_sessions" | "require_password_change" | "disable_account";
                            reason: string;
                            /** @enum {string} */
                            status: "pending_approval" | "dispatched" | "succeeded" | "failed" | "refused" | "unsupported" | "expired" | "cancelled";
                            /** Format: uuid */
                            alertId: string | null;
                            /** Format: uuid */
                            requestedById: string;
                            /** Format: uuid */
                            approvedById: string | null;
                            /** Format: date-time */
                            approvedAt: string | null;
                            /** Format: date-time */
                            expiresAt: string;
                            /** Format: date-time */
                            completedAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    SourcesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                /** Format: uuid */
                                appId: string;
                                slug: string;
                                name: string;
                                environment: string;
                                /** @enum {string} */
                                status: "never" | "disconnected" | "delayed" | "idle" | "active";
                                heartbeatTimeoutSec: number;
                                /** Format: date-time */
                                lastHeartbeatAt: string | null;
                                queueSize: number;
                                queueOldestAgeSec: number | null;
                                retrying: number;
                                /** Format: date-time */
                                lastEventAt: string | null;
                                rejected15m: number;
                                gaps: number;
                                missingEvents: number;
                                /** Format: date-time */
                                oldestGapAt: string | null;
                            }[];
                            /** Format: date-time */
                            checkedAt: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ConnectorController_activity: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header: {
                /** @description The key's public id (UUID) */
                "Audit-Key-Id": string;
                /** @description Unix seconds, within ±300 s */
                "Audit-Timestamp": string;
                /** @description 16 random bytes, base64url; single use */
                "Audit-Nonce": string;
                /** @description sha-256=<base64url> of the canonical JSON (RFC 8785) of the body */
                "Audit-Body-Digest": string;
                /** @description v1=<base64url HMAC-SHA256> over the canonical string (contract.md) */
                "Audit-Signature": string;
            };
            path: {
                subject: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                eventId: string;
                                action: string;
                                description: string;
                                /** @enum {string} */
                                outcome: "success" | "failure" | "denied";
                                /** Format: date-time */
                                occurredAt: string;
                                client?: {
                                    /** @enum {string} */
                                    type?: "web" | "ios" | "android" | "api" | "job";
                                    os?: string;
                                    deviceModel?: string;
                                    appVersion?: string;
                                    browser?: string;
                                };
                                location?: {
                                    country?: string;
                                    city?: string;
                                };
                            }[];
                            nextCursor?: string;
                            attribution?: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ConnectorController_export: {
        parameters: {
            query?: {
                cursor?: string;
            };
            header: {
                /** @description The key's public id (UUID) */
                "Audit-Key-Id": string;
                /** @description Unix seconds, within ±300 s */
                "Audit-Timestamp": string;
                /** @description 16 random bytes, base64url; single use */
                "Audit-Nonce": string;
                /** @description sha-256=<base64url> of the canonical JSON (RFC 8785) of the body */
                "Audit-Body-Digest": string;
                /** @description v1=<base64url HMAC-SHA256> over the canonical string (contract.md) */
                "Audit-Signature": string;
            };
            path: {
                subject: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            items: {
                                eventId: string;
                                action: string;
                                /** @enum {string} */
                                category: "security" | "audit" | "access" | "system" | "audit_access";
                                /** @enum {string} */
                                outcome: "success" | "failure" | "denied";
                                /** Format: date-time */
                                occurredAt: string;
                                /** Format: date-time */
                                recordedAt: string;
                                /** @enum {string} */
                                role: "actor" | "resource";
                                details?: unknown;
                                change?: {
                                    before?: unknown;
                                    after?: unknown;
                                };
                                client?: {
                                    /** @enum {string} */
                                    type?: "web" | "ios" | "android" | "api" | "job";
                                    os?: string;
                                    deviceModel?: string;
                                    appVersion?: string;
                                };
                                network?: {
                                    ip?: string;
                                    userAgent?: string;
                                    country?: string;
                                    city?: string;
                                };
                                location?: {
                                    latitude: number;
                                    longitude: number;
                                    /** Format: date-time */
                                    capturedAt: string;
                                };
                            }[];
                            nextCursor?: string;
                            attribution?: string;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ConnectorController_erase: {
        parameters: {
            query?: never;
            header: {
                /** @description The key's public id (UUID) */
                "Audit-Key-Id": string;
                /** @description Unix seconds, within ±300 s */
                "Audit-Timestamp": string;
                /** @description 16 random bytes, base64url; single use */
                "Audit-Nonce": string;
                /** @description sha-256=<base64url> of the canonical JSON (RFC 8785) of the body */
                "Audit-Body-Digest": string;
                /** @description v1=<base64url HMAC-SHA256> over the canonical string (contract.md) */
                "Audit-Signature": string;
            };
            path: {
                subject: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /**
                     * @default personal
                     * @enum {string}
                     */
                    scope?: "personal" | "events";
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            personalDeleted: number;
                            locationDeleted: number;
                            held: number;
                            eventsDeleted?: number;
                            eventsPending?: number;
                        };
                        message: string;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    HealthController_live: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            status: "ok";
                            uptime: number;
                        };
                        message: string;
                    };
                };
            };
        };
    };
    HealthController_ready: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            status: "ok" | "degraded";
                            checks: {
                                /** @enum {string} */
                                database: "ok";
                                /** @enum {string} */
                                redis: "ok" | "unavailable" | "disabled";
                                /** @enum {string} */
                                mail: "ok" | "degraded" | "disabled";
                            };
                        };
                        message: string;
                    };
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    WebVitalsController_report: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    route: "/" | "/sign-in" | "/forgot-password" | "/reset-password" | "/sign-up" | "/confirm-sign-up" | "/confirm-email-change" | "/revert-email-change" | "/accept-invitation" | "/account" | "/account/notifications" | "/admin/users" | "/admin/invitations" | "/events" | "/events/:eventId" | "/apps/:appId/actors/:actorId" | "/apps/:appId/resources/:resourceType/:resourceId" | "/security" | "/alerts" | "/alerts/:alertId" | "/soc" | "/detection-rules" | "/exports" | "/apps" | "/apps/new" | "/apps/:appId" | "/response-actions" | "/retention" | "/integrity" | "/admin/users/:userId" | "/*";
                    metrics: ({
                        /** @enum {string} */
                        name: "FCP" | "INP" | "LCP" | "TTFB";
                        value: number;
                        /** @enum {string} */
                        navigationType: "navigate" | "reload" | "back-forward" | "back-forward-cache" | "prerender" | "restore" | "soft-navigation";
                    } | {
                        /** @enum {string} */
                        name: "CLS";
                        value: number;
                        /** @enum {string} */
                        navigationType: "navigate" | "reload" | "back-forward" | "back-forward-cache" | "prerender" | "restore" | "soft-navigation";
                    })[];
                };
            };
        };
        responses: {
            /** @description Recorded */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}
