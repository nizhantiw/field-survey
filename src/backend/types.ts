import type { Role } from '../domain/authz/roles';
import type { MapManifest } from '../domain/maps/manifest';
import type { ExportRecord, SubmissionFilter } from '../domain/export/export';
import type { SurveyDefinition } from '../domain/survey/types';
import type { ReviewStatus } from '../domain/sync/states';
import type { SyncTransport } from '../domain/sync/protocol';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export interface Organization {
  id: string;
  name: string;
  role: Role;
}

export interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  role: Role;
}

export interface FormSummary {
  id: string;
  projectId: string;
  title: string;
  draft: SurveyDefinition;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
}

export interface FormVersionRecord {
  id: string;
  formId: string;
  projectId: string;
  versionNumber: number;
  definition: SurveyDefinition;
  publishedAt: string;
}

export interface FieldBackend {
  readonly kind: 'supabase' | 'harness';
  signIn(email: string, password: string): Promise<SessionUser>;
  signOut(): Promise<void>;
  getSession(): Promise<SessionUser | null>;
  listOrganizations(): Promise<Organization[]>;
  createOrganization(name: string): Promise<Organization>;
  listOrgMembers(organizationId: string): Promise<Member[]>;
  setOrgMemberRole(organizationId: string, userId: string, role: Role): Promise<void>;
  listProjects(organizationId: string): Promise<Project[]>;
  createProject(organizationId: string, name: string, description: string): Promise<Project>;
  listForms(projectId: string): Promise<FormSummary[]>;
  getForm(formId: string): Promise<FormSummary>;
  saveFormDraft(input: { id?: string; projectId: string; title: string; draft: SurveyDefinition }): Promise<FormSummary>;
  publishForm(formId: string, definition: SurveyDefinition): Promise<FormVersionRecord>;
  listVersions(formId: string): Promise<FormVersionRecord[]>;
  listPublishedVersions(projectId: string): Promise<FormVersionRecord[]>;
  getVersion(versionId: string): Promise<FormVersionRecord>;
  transport(): SyncTransport;
  listSubmissions(projectId: string, filter?: SubmissionFilter): Promise<ExportRecord[]>;
  setReviewStatus(submissionId: string, status: ReviewStatus): Promise<ExportRecord>;
  listMapManifests(projectId: string): Promise<MapManifest[]>;
}
