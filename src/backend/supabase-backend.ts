import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '../domain/authz/roles';
import { payloadHash } from '../domain/hash';
import { applySubmissionFilter, type ExportRecord, type SubmissionFilter } from '../domain/export/export';
import type { MapManifest } from '../domain/maps/manifest';
import { parseManifest } from '../domain/maps/manifest';
import type { SurveyDefinition } from '../domain/survey/types';
import type { AttachmentUpload, CreateSubmissionBody, SyncTransport } from '../domain/sync/protocol';
import { SyncRequestError } from '../domain/sync/retry';
import type { IngestionStatus, ReviewStatus } from '../domain/sync/states';
import { AuthFailedError, PermissionError } from './harness';
import type { FieldBackend, FormSummary, FormVersionRecord, Organization, SessionUser } from './types';

interface RpcError {
  message: string;
  code?: string;
  status?: number;
}

type Loose = SupabaseClient;

function fail(error: RpcError | null, fallback: string): never {
  const status = error?.status ?? statusFromCode(error?.code);
  if (status === 401) throw new SyncRequestError('Sign in again to upload. Local answers were kept.', 'reauth', 401);
  if (status === 403) throw new PermissionError();
  if (status === 409) throw new SyncRequestError(error?.message || 'Conflict', 'conflict', 409);
  if (status === 422) throw new SyncRequestError(error?.message || fallback, 'permanent', 422);
  throw new Error(error?.message || fallback);
}

function statusFromCode(code: string | undefined): number | null {
  if (!code) return null;
  if (code === '42501' || code === 'PGRST301') return 403;
  if (code === '23505') return 409;
  return null;
}

function raiseIf<T>(result: { data: T | null; error: RpcError | null }, fallback: string): T {
  if (result.error || result.data === null) fail(result.error, fallback);
  return result.data;
}

export function createSupabaseBackend(url: string, anonKey: string, loadManifest: () => Promise<MapManifest>): FieldBackend {
  const client: Loose = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const sessionUser = async (): Promise<SessionUser | null> => {
    const { data } = await client.auth.getSession();
    const user = data.session?.user;
    if (!user?.email) return null;
    const profile = await client.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
    const displayName =
      profile.data && typeof profile.data === 'object' && 'display_name' in profile.data
        ? String((profile.data as { display_name: string }).display_name)
        : user.email;
    return { id: user.id, email: user.email, displayName };
  };

  const transport = (): SyncTransport => ({
    async createOrRecover(body: CreateSubmissionBody) {
      const result = await client.rpc('create_or_recover_submission', {
        p_id: body.id,
        p_project_id: body.projectId,
        p_form_version_id: body.formVersionId,
        p_answers: body.answers,
        p_location: body.location,
        p_client_captured_at: body.clientCapturedAt,
        p_payload_hash: await payloadHash(body),
      });
      if (result.error) fail(result.error, 'Could not save the submission');
      const payload = result.data as { status: 'created' | 'recovered' | 'conflict'; ingestion_status: IngestionStatus; payload_hash: string };
      if (payload.status === 'conflict') return { status: 'conflict', payloadHash: payload.payload_hash };
      return { status: payload.status, ingestionStatus: payload.ingestion_status, payloadHash: payload.payload_hash };
    },
    async registerAttachments(submissionId, attachments) {
      const result = await client.rpc('register_submission_attachments', {
        p_submission_id: submissionId,
        p_attachments: attachments.map((attachment) => ({
          id: attachment.id,
          question_id: attachment.questionId,
          content_type: attachment.contentType,
          byte_size: attachment.byteSize,
          checksum: attachment.checksum,
        })),
      });
      if (result.error) fail(result.error, 'Could not register attachments');
    },
    async uploadAttachment(submissionId, attachment: AttachmentUpload) {
      const submission = await client.from('submissions').select('project_id').eq('id', submissionId).single();
      if (submission.error || !submission.data) fail(submission.error, 'Submission is not available');
      const projectId = String((submission.data as { project_id: string }).project_id);
      const path = `${projectId}/${submissionId}/${attachment.id}`;
      const upload = await client.storage.from('attachments').upload(path, attachment.bytes, {
        contentType: attachment.contentType,
        upsert: true,
      });
      if (upload.error) fail({ message: upload.error.message }, 'Attachment upload failed');
      const marked = await client.rpc('mark_attachment_uploaded', { p_id: attachment.id, p_checksum: attachment.checksum });
      if (marked.error) fail(marked.error, 'Attachment verification failed');
    },
    async verifyAttachments(submissionId) {
      const result = await client.rpc('verify_submission_attachments', { p_submission_id: submissionId });
      if (result.error) fail(result.error, 'Could not verify attachments');
      const payload = result.data as { ok: boolean; missing: string[] };
      return payload;
    },
    async finalize(submissionId, hash) {
      const result = await client.rpc('finalize_submission', { p_id: submissionId, p_payload_hash: hash });
      if (result.error) fail(result.error, 'Could not finalize the submission');
      const payload = result.data as { ingestion_status: 'complete' };
      if (payload.ingestion_status !== 'complete') {
        throw new SyncRequestError('Server did not confirm complete ingestion', 'retry', 503);
      }
      return { ingestionStatus: 'complete' };
    },
  });

  return {
    kind: 'supabase',
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.user?.email) throw new AuthFailedError();
      const user = await sessionUser();
      if (!user) throw new AuthFailedError();
      return user;
    },
    async signOut() {
      await client.auth.signOut();
    },
    getSession: sessionUser,
    async listOrganizations() {
      const result = await client.from('organization_directory').select('id, name, role');
      if (result.error) fail(result.error, 'Could not load organizations');
      return (result.data ?? []) as Organization[];
    },
    async createOrganization(name) {
      const result = await client.rpc('create_organization', { org_name: name });
      if (result.error || !result.data) fail(result.error, 'Could not create the organization');
      return { id: String(result.data), name: name.trim(), role: 'owner' as const };
    },
    async listOrgMembers(organizationId) {
      const result = await client.from('organization_member_directory').select('user_id, email, display_name, role').eq('organization_id', organizationId);
      if (result.error) fail(result.error, 'Could not load members');
      return ((result.data ?? []) as { user_id: string; email: string; display_name: string; role: Role }[]).map((row) => ({
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
      }));
    },
    async setOrgMemberRole(organizationId, userId, role) {
      const result = await client.rpc('set_member_role', { p_org_id: organizationId, p_user_id: userId, p_role: role });
      if (result.error) fail(result.error, 'Could not change that role');
    },
    async listProjects(organizationId) {
      const result = await client.from('project_directory').select('id, organization_id, name, description, role').eq('organization_id', organizationId);
      if (result.error) fail(result.error, 'Could not load projects');
      return ((result.data ?? []) as { id: string; organization_id: string; name: string; description: string; role: Role }[]).map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        description: row.description,
        role: row.role,
      }));
    },
    async createProject(organizationId, name, description) {
      const result = await client.rpc('create_project', { p_org_id: organizationId, p_name: name, p_description: description });
      if (result.error || !result.data) fail(result.error, 'Could not create the project');
      const row = result.data as ProjectRow;
      return { id: row.id, organizationId: row.organization_id, name: row.name, description: row.description, role: row.role };
    },
    async listForms(projectId) {
      const result = await client.from('forms').select('id, project_id, title, draft_schema, current_version_id').eq('project_id', projectId);
      if (result.error) fail(result.error, 'Could not load forms');
      const forms = (result.data ?? []) as FormRow[];
      return Promise.all(forms.map((form) => toSummary(client, form)));
    },
    async getForm(formId) {
      const result = await client.from('forms').select('id, project_id, title, draft_schema, current_version_id').eq('id', formId).single();
      return toSummary(client, raiseIf(result, 'Could not load the form') as FormRow);
    },
    async saveFormDraft(input) {
      if (input.id) {
        const result = await client
          .from('forms')
          .update({ title: input.title, draft_schema: input.draft })
          .eq('id', input.id)
          .select('id, project_id, title, draft_schema, current_version_id')
          .single();
        return toSummary(client, raiseIf(result, 'Could not save the form') as FormRow);
      }
      const result = await client
        .from('forms')
        .insert({ id: input.draft.id, project_id: input.projectId, title: input.title, draft_schema: input.draft })
        .select('id, project_id, title, draft_schema, current_version_id')
        .single();
      return toSummary(client, raiseIf(result, 'Could not save the form') as FormRow);
    },
    async publishForm(formId, definition) {
      const result = await client.rpc('publish_form_version', { p_form_id: formId, p_schema: definition });
      if (result.error || !result.data) fail(result.error, 'Could not publish the form');
      return getVersion(client, String(result.data));
    },
    async listVersions(formId) {
      const result = await client.from('form_versions').select('id, form_id, project_id, version_number, schema, published_at').eq('form_id', formId).order('version_number');
      if (result.error) fail(result.error, 'Could not load versions');
      return ((result.data ?? []) as VersionRow[]).map(toVersion);
    },
    async listPublishedVersions(projectId) {
      const result = await client.from('form_versions').select('id, form_id, project_id, version_number, schema, published_at').eq('project_id', projectId);
      if (result.error) fail(result.error, 'Could not load published forms');
      return ((result.data ?? []) as VersionRow[]).map(toVersion);
    },
    async getVersion(versionId) {
      return getVersion(client, versionId);
    },
    transport,
    async listSubmissions(projectId, filter?: SubmissionFilter) {
      const result = await client
        .from('submissions')
        .select('id, project_id, form_id, form_version_id, collector_id, answers, location, client_captured_at, server_received_at, payload_hash, ingestion_status, review_status')
        .eq('project_id', projectId);
      if (result.error) fail(result.error, 'Could not load submissions');
      const versions = await client.from('form_versions').select('id, version_number').eq('project_id', projectId);
      const numbers = new Map(((versions.data ?? []) as { id: string; version_number: number }[]).map((row) => [row.id, row.version_number]));
      const records: ExportRecord[] = ((result.data ?? []) as SubmissionRow[]).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        formId: row.form_id,
        formVersionId: row.form_version_id,
        versionNumber: numbers.get(row.form_version_id) ?? 0,
        collectorId: row.collector_id,
        answers: row.answers,
        location: row.location,
        clientCapturedAt: row.client_captured_at,
        serverReceivedAt: row.server_received_at,
        payloadHash: row.payload_hash,
        ingestionStatus: row.ingestion_status,
        reviewStatus: row.review_status,
      }));
      return applySubmissionFilter(records, filter ?? { ingestion: 'complete' });
    },
    async setReviewStatus(submissionId, status: ReviewStatus) {
      const result = await client.rpc('set_review_status', { p_id: submissionId, p_status: status });
      if (result.error || !result.data) fail(result.error, 'Could not update the review status');
      const row = result.data as SubmissionRow;
      return {
        id: row.id,
        projectId: row.project_id,
        formId: row.form_id,
        formVersionId: row.form_version_id,
        versionNumber: 0,
        collectorId: row.collector_id,
        answers: row.answers,
        location: row.location,
        clientCapturedAt: row.client_captured_at,
        serverReceivedAt: row.server_received_at,
        payloadHash: row.payload_hash,
        ingestionStatus: row.ingestion_status,
        reviewStatus: row.review_status,
      };
    },
    async listMapManifests(_projectId: string) {
      const manifest = parseManifest(await loadManifest());
      return [manifest];
    },
  };
}

interface FormRow {
  id: string;
  project_id: string;
  title: string;
  draft_schema: SurveyDefinition;
  current_version_id: string | null;
}

interface VersionRow {
  id: string;
  form_id: string;
  project_id: string;
  version_number: number;
  schema: SurveyDefinition;
  published_at: string;
}

interface SubmissionRow {
  id: string;
  project_id: string;
  form_id: string;
  form_version_id: string;
  collector_id: string;
  answers: Record<string, unknown>;
  location: unknown;
  client_captured_at: string;
  server_received_at: string | null;
  payload_hash: string;
  ingestion_status: IngestionStatus;
  review_status: ReviewStatus;
}

interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  role: Role;
}

async function toSummary(client: Loose, form: FormRow): Promise<FormSummary> {
  let currentVersionNumber: number | null = null;
  if (form.current_version_id) {
    const version = await client.from('form_versions').select('version_number').eq('id', form.current_version_id).maybeSingle();
    if (version.data && typeof version.data === 'object' && 'version_number' in version.data) {
      currentVersionNumber = Number((version.data as { version_number: number }).version_number);
    }
  }
  return {
    id: form.id,
    projectId: form.project_id,
    title: form.title,
    draft: form.draft_schema,
    currentVersionId: form.current_version_id,
    currentVersionNumber,
  };
}

function toVersion(row: VersionRow): FormVersionRecord {
  return {
    id: row.id,
    formId: row.form_id,
    projectId: row.project_id,
    versionNumber: row.version_number,
    definition: row.schema,
    publishedAt: row.published_at,
  };
}

async function getVersion(client: Loose, versionId: string): Promise<FormVersionRecord> {
  const result = await client.from('form_versions').select('id, form_id, project_id, version_number, schema, published_at').eq('id', versionId).single();
  return toVersion(raiseIf(result, 'Could not load the form version') as VersionRow);
}

export async function loadBundledManifest(): Promise<MapManifest> {
  const response = await fetch('/map-package/manifest.json');
  if (!response.ok) throw new Error('The offline map manifest is missing from this installation.');
  return parseManifest(await response.json());
}
