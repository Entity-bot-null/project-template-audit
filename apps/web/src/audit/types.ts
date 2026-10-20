import type { operations } from '../api/client';

// The admin pages' shapes, from the generated contract: a contract change
// that breaks a page fails the type check.
type Success<Operation> = Operation extends { responses: { 200: infer Answer } }
  ? Answer
  : Operation extends { responses: { 201: infer Answer } }
    ? Answer
    : never;
type DataOf<Operation extends keyof operations> =
  Success<operations[Operation]> extends { content: { 'application/json': { data: infer Data } } }
    ? Data
    : never;

export type VisibleApps = DataOf<'AccountAppsController_apps'>;
export type VisibleApp = VisibleApps['items'][number];
export type Overview = DataOf<'ExplorerController_overview'>;
export type EventPage = DataOf<'ExplorerController_search'>;
export type EventSummary = EventPage['items'][number];
export type EventDetail = DataOf<'ExplorerController_detail'>;
export type SubjectActivity = DataOf<'ExplorerController_subject'>;
export type SecurityOverview = DataOf<'ExplorerController_security'>;
export type AlertPage = DataOf<'AlertsController_list'>;
export type Alert = AlertPage['items'][number];
export type AlertDetail = DataOf<'AlertsController_get'>;
export type AlertSummary = DataOf<'AlertsController_summary'>;
export type AlertMute = DataOf<'AlertMutesController_list'>['items'][number];
export type DetectionRules = DataOf<'DetectionController_listRules'>;
export type DetectionRule = DetectionRules['items'][number];
export type EscalationPolicies = DataOf<'DetectionController_listPolicies'>;
export type EscalationPolicy = EscalationPolicies['items'][number];
export type SourceList = DataOf<'SourcesController_list'>;
export type Source = SourceList['items'][number];
export type ResponseActionPage = DataOf<'ResponseActionsController_list'>;
export type ResponseAction = ResponseActionPage['items'][number];
export type ConnectedAppList = DataOf<'ConnectedAppsController_list'>;
export type ConnectedApp = DataOf<'ConnectedAppsController_get'>;
export type CreatedApp = DataOf<'ConnectedAppsController_create'>;
export type WebhookDeliveries = DataOf<'WebhooksController_deliveries'>;
export type RetentionPolicies = DataOf<'RetentionController_policies'>;
export type LegalHolds = DataOf<'RetentionController_holds'>;
export type IntegrityStatus = DataOf<'IntegrityController_get'>;
export type ExportJobPage = DataOf<'ExportsController_list'>;
export type ExportJob = ExportJobPage['items'][number];
export type UserAccess = DataOf<'UserAccessController_get'>;
export type MfaStatus = DataOf<'AccountMfaController_status'>;
