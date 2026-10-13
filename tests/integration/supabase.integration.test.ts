import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadHash, sha256Hex } from '../../src/domain/hash';
import { InjectingTransport, runSync, type AttachmentUpload, type SyncRecord, type SyncTransport } from '../../src/domain/sync/protocol';
import { SyncRequestError } from '../../src/domain/sync/retry';

const REQUIRED = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TEST_USER_OWNER_EMAIL',
  'TEST_USER_OWNER_PASSWORD',
  'TEST_USER_ADMIN_EMAIL',
  'TEST_USER_ADMIN_PASSWORD',
  'TEST_USER_RESEARCHER_EMAIL',
  'TEST_USER_RESEARCHER_PASSWORD',
  'TEST_USER_FIELDWORKER_EMAIL',
  'TEST_USER_FIELDWORKER_PASSWORD',
  'TEST_USER_VIEWER_EMAIL',
  'TEST_USER_VIEWER_PASSWORD',
  'TEST_USER_OUTSIDER_EMAIL',
  'TEST_USER_OUTSIDER_PASSWORD',
] as const;

export const BLOCKED_LIVE_TESTS = [
  'P1-01',
  'P1-02',
  'P1-03',
  'P1-04',
  'P1-05',
  'P1-06',
  'P1-07',
  'P1-08',
  'P1-09',
  'P1-10',
  'P2-08',
  'P7-01',
  'P7-02',
  'P7-03',
  'P7-04',
  'P7-05',
  'P7-06',
  'P7-07',
  'P7-08',
  'P7-09',
  'P7-10',
  'P7-11',
  'P7-12',
  'P7-13',
  'P7-14',
  'P8-02',
  'P8-03',
  'P8-04',
  'P8-07',
];

const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
const live = missing.length === 0;
const url = process.env.VITE_SUPABASE_URL ?? '';
const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const survey = {
  schemaVersion: 1,
  title: 'Integration plot',
  questions: [{ id: 'q_name', type: 'text', label: 'Name', required: true }],
};

type RoleName = 'owner' | 'admin' | 'researcher' | 'fieldworker' | 'viewer' | 'outsider';

interface Account {
  email: string;
  password: string;
  id: string;
  client: SupabaseClient;
}

describe('live Supabase integration availability', () => {
  it('records BLOCKED instead of a pass when credentials are absent', () => {
    mkdirSync('test-artifacts', { recursive: true });
    if (!live) {
      writeFileSync(
        'test-artifacts/integration-blocked.json',
        JSON.stringify(
          {
            status: 'BLOCKED',
            reason: 'No Supabase project credentials are configured. Docker and the Supabase CLI are not available in this environment, so the live RLS, storage, and sync checks did not run.',
            missing,
            tests: BLOCKED_LIVE_TESTS,
          },
          null,
          2,
        ),
      );
      expect(missing.length).toBeGreaterThan(0);
      return;
    }
    const host = new URL(url).hostname;
    const local = host === 'localhost' || host === '127.0.0.1';
    if (!local && process.env.SUPABASE_ALLOW_REMOTE_TEST !== '1') {
      throw new Error('Refusing to run integration tests against a non-local Supabase URL without SUPABASE_ALLOW_REMOTE_TEST=1.');
    }
  });
});

describe.skipIf(!live)('Supabase policies and sync', () => {
  let admin: SupabaseClient;
  const accounts = new Map<RoleName, Account>();
  let orgA = '';
  let orgB = '';
  let projectA = '';
  let projectB = '';
  let formId = '';
  let versionId = '';
  let otherVersionId = '';

  beforeAll(async () => {
    admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const specs: Array<[RoleName, string, string]> = [
      ['owner', 'TEST_USER_OWNER_EMAIL', 'TEST_USER_OWNER_PASSWORD'],
      ['admin', 'TEST_USER_ADMIN_EMAIL', 'TEST_USER_ADMIN_PASSWORD'],
      ['researcher', 'TEST_USER_RESEARCHER_EMAIL', 'TEST_USER_RESEARCHER_PASSWORD'],
      ['fieldworker', 'TEST_USER_FIELDWORKER_EMAIL', 'TEST_USER_FIELDWORKER_PASSWORD'],
      ['viewer', 'TEST_USER_VIEWER_EMAIL', 'TEST_USER_VIEWER_PASSWORD'],
      ['outsider', 'TEST_USER_OUTSIDER_EMAIL', 'TEST_USER_OUTSIDER_PASSWORD'],
    ];
    const listed = await admin.auth.admin.listUsers({ perPage: 200 });
    if (listed.error) throw new Error(listed.error.message);
    for (const [role, emailKey, passwordKey] of specs) {
      const email = process.env[emailKey] ?? '';
      const password = process.env[passwordKey] ?? '';
      const previous = listed.data.users.find((user) => user.email === email);
      if (previous) await admin.auth.admin.deleteUser(previous.id);
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: role },
      });
      if (created.error || !created.data.user) throw new Error(created.error?.message ?? `could not create ${role}`);
      const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error) throw new Error(signed.error.message);
      accounts.set(role, { email, password, id: created.data.user.id, client });
    }
    const owner = need('owner');
    const outsider = need('outsider');
    orgA = await createOrg(owner.client, `Org A ${crypto.randomUUID()}`);
    orgB = await createOrg(outsider.client, `Org B ${crypto.randomUUID()}`);
    for (const role of ['admin', 'researcher', 'fieldworker', 'viewer'] as const) {
      const inserted = await admin.from('organization_members').insert({ organization_id: orgA, user_id: need(role).id, role });
      if (inserted.error) throw new Error(inserted.error.message);
    }
    projectA = await createProject(owner.client, orgA, 'Plots');
    projectB = await createProject(outsider.client, orgB, 'Other plots');
    for (const role of ['researcher', 'fieldworker', 'viewer'] as const) {
      const inserted = await admin.from('project_members').insert({ project_id: projectA, user_id: need(role).id, role });
      if (inserted.error) throw new Error(inserted.error.message);
    }
    const researcher = need('researcher');
    const form = await researcher.client.from('forms').insert({ project_id: projectA, title: survey.title, draft_schema: survey }).select('id').single();
    if (form.error || !form.data) throw new Error(form.error?.message ?? 'form insert failed');
    formId = String((form.data as { id: string }).id);
    const published = await researcher.client.rpc('publish_form_version', { p_form_id: formId, p_schema: survey });
    if (published.error || !published.data) throw new Error(published.error?.message ?? 'publish failed');
    versionId = String(published.data);
    const otherForm = await outsider.client.from('forms').insert({ project_id: projectB, title: 'Other', draft_schema: survey }).select('id').single();
    if (otherForm.error || !otherForm.data) throw new Error(otherForm.error?.message ?? 'other form failed');
    const otherPublished = await outsider.client.rpc('publish_form_version', {
      p_form_id: (otherForm.data as { id: string }).id,
      p_schema: survey,
    });
    if (otherPublished.error || !otherPublished.data) throw new Error(otherPublished.error?.message ?? 'other publish failed');
    otherVersionId = String(otherPublished.data);
  }, 120_000);

  afterAll(async () => {
    if (!live) return;
    await admin.from('organizations').delete().in('id', [orgA, orgB].filter(Boolean));
    for (const account of accounts.values()) await admin.auth.admin.deleteUser(account.id);
  });

  it('P1-01 signs in with valid credentials and hides invalid-credential detail', async () => {
    const owner = need('owner');
    const fresh = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const ok = await fresh.auth.signInWithPassword({ email: owner.email, password: owner.password });
    expect(ok.error).toBeNull();
    const bad = await fresh.auth.signInWithPassword({ email: owner.email, password: 'not-the-password' });
    expect(bad.error).toBeTruthy();
    expect(JSON.stringify(bad.error)).not.toMatch(/service_role|stack|jwt secret/i);
  });

  it('P1-02 hides organization B from an organization A member', async () => {
    const read = await need('owner').client.from('organizations').select('id').eq('id', orgB);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);
    const projects = await need('owner').client.from('projects').select('id').eq('id', projectB);
    expect(projects.data).toEqual([]);
  });

  it('P1-03 stops a fieldworker from publishing, managing members, or reviewing', async () => {
    const field = need('fieldworker');
    expect((await field.client.rpc('publish_form_version', { p_form_id: formId, p_schema: survey })).error).toBeTruthy();
    expect((await field.client.rpc('set_member_role', { p_org_id: orgA, p_user_id: need('viewer').id, p_role: 'admin' })).error).toBeTruthy();
    const submissionId = await completeRecord(field.client, projectA, versionId);
    expect((await field.client.rpc('set_review_status', { p_id: submissionId, p_status: 'accepted' })).error).toBeTruthy();
  });

  it('P1-04 hides project resources from an organization member without project membership', async () => {
    const orgAdmin = need('admin');
    const orgs = await orgAdmin.client.from('organizations').select('id').eq('id', orgA);
    expect((orgs.data ?? []).map((row) => (row as { id: string }).id)).toContain(orgA);
    expect((await orgAdmin.client.from('projects').select('id').eq('id', projectA)).data).toEqual([]);
    expect((await orgAdmin.client.from('forms').select('id').eq('id', formId)).data).toEqual([]);
    expect((await orgAdmin.client.from('submissions').select('id').eq('project_id', projectA)).data).toEqual([]);
  });

  it('P1-05 rejects self-promotion and an admin grant of owner', async () => {
    const field = need('fieldworker');
    expect((await field.client.rpc('set_member_role', { p_org_id: orgA, p_user_id: field.id, p_role: 'owner' })).error).toBeTruthy();
    expect((await field.client.from('organization_members').update({ role: 'owner' }).eq('user_id', field.id)).error).toBeTruthy();
    expect((await need('admin').client.rpc('set_member_role', { p_org_id: orgA, p_user_id: need('owner').id, p_role: 'admin' })).error).toBeTruthy();
  });

  it('P1-06 rejects a submission whose form version belongs to another project', async () => {
    const result = await need('fieldworker').client.rpc('create_or_recover_submission', {
      p_id: crypto.randomUUID(),
      p_project_id: projectA,
      p_form_version_id: otherVersionId,
      p_answers: { q_name: 'cross' },
      p_location: null,
      p_client_captured_at: new Date().toISOString(),
      p_payload_hash: 'a'.repeat(64),
    });
    expect(result.error).toBeTruthy();
  });

  it('P1-07 and P8-07 keep attachment objects private', async () => {
    const uploaded = await completeRecord(need('fieldworker').client, projectA, versionId, {
      id: crypto.randomUUID(),
      questionId: 'q_photo',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('field-photo').buffer,
    });
    const outsider = need('outsider');
    const downloaded = await outsider.client.storage.from('attachments').download(uploaded.path);
    expect(downloaded.error).toBeTruthy();
    const signed = await outsider.client.storage.from('attachments').createSignedUrl(uploaded.path, 60);
    if (signed.data?.signedUrl) {
      const response = await fetch(signed.data.signedUrl);
      expect(response.ok).toBe(false);
    } else {
      expect(signed.error).toBeTruthy();
    }
  });

  it('P1-08 rolls back an organization when membership creation fails', async () => {
    const result = await admin.rpc('test_failing_org_creation', { p_user_id: need('owner').id });
    expect(result.error).toBeNull();
    const leftover = await admin.from('organizations').select('id').eq('name', 'should-rollback');
    expect(leftover.data).toEqual([]);
  });

  it('P1-09 refuses to demote the only owner', async () => {
    const sole = need('owner');
    expect((await sole.client.rpc('set_member_role', { p_org_id: orgA, p_user_id: sole.id, p_role: 'admin' })).error).toBeTruthy();
    const forced = await admin.from('organization_members').update({ role: 'admin' }).eq('organization_id', orgA).eq('user_id', sole.id);
    expect(forced.error).toBeTruthy();
    const still = await admin.from('organization_members').select('role').eq('organization_id', orgA).eq('user_id', sole.id).single();
    expect((still.data as { role: string } | null)?.role).toBe('owner');
  });

  it.skip('P1-10 clean migration requires supabase db reset against local Docker', () => {
    // Intentionally skipped until the Supabase CLI can rebuild a clean database.
  });

  it('P2-08 rejects a direct publish from a fieldworker and leaves version 1 unchanged', async () => {
    const publish = await need('fieldworker').client.rpc('publish_form_version', {
      p_form_id: formId,
      p_schema: { ...survey, title: 'Stolen' },
    });
    expect(publish.error).toBeTruthy();
    const version = await need('researcher').client.from('form_versions').select('schema').eq('id', versionId).single();
    expect((version.data as { schema: { title: string } }).schema.title).toBe('Integration plot');
  });

  it('P7 confirms one upload, collapses a duplicate, and conflicts on different content', async () => {
    const client = need('fieldworker').client;
    const id = crypto.randomUUID();
    const first = await runSync(queued(id, projectA, versionId), transportFor(client, projectA), async () => [], async () => undefined, true);
    expect(first.serverConfirmed).toBe(true);
    const second = await runSync(queued(id, projectA, versionId), transportFor(client, projectA), async () => [], async () => undefined, true);
    expect(second.serverConfirmed).toBe(true);
    const rows = await admin.from('submissions').select('id').eq('id', id);
    expect(rows.data).toHaveLength(1);
    const conflict = await runSync(
      { ...queued(id, projectA, versionId), answers: { q_name: 'different' } },
      transportFor(client, projectA),
      async () => [],
      async () => undefined,
      true,
    );
    expect(conflict.record.blockedReason).toBe('conflict');
    expect(conflict.serverConfirmed).toBe(false);
  });

  it('P7 recovers a lost response after create, register, and finalize', async () => {
    const client = need('fieldworker').client;
    for (const boundary of ['create_or_recover', 'register_attachments', 'finalize'] as const) {
      const id = crypto.randomUUID();
      const inner = transportFor(client, projectA);
      const transport = new InjectingTransport(inner, { boundary, times: 1, when: 'after', error: new TypeError('network unreachable') });
      const dropped = await runSync(queued(id, projectA, versionId), transport, async () => [], async () => undefined, true);
      expect(dropped.serverConfirmed).toBe(false);
      const recovered = await runSync({ ...dropped.record, status: 'failed', permanent: false }, inner, async () => [], async () => undefined, true);
      expect(recovered.serverConfirmed).toBe(true);
      expect((await admin.from('submissions').select('id').eq('id', id)).data).toHaveLength(1);
    }
  });

  it('P7 refuses completion when an expected attachment is absent', async () => {
    const client = need('fieldworker').client;
    const id = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    const bytes = new TextEncoder().encode('absent');
    const checksum = await sha256Hex(bytes.buffer);
    const record = queued(id, projectA, versionId);
    const meta = { id: attachmentId, questionId: 'q_photo', contentType: 'text/plain', byteSize: bytes.byteLength, checksum };
    const transport = transportFor(client, projectA);
    const created = await transport.createOrRecover({ ...record, attachments: [meta] });
    expect(created.status).toBe('created');
    await transport.registerAttachments(id, [meta]);
    await expect(transport.finalize(id, await payloadHash(record))).rejects.toThrow(/attachment/i);
    const row = await admin.from('submissions').select('ingestion_status').eq('id', id).single();
    expect((row.data as { ingestion_status: string }).ingestion_status).toBe('pending');
  });

  it('P7 keeps local answers when the caller is signed out or removed from the project', async () => {
    const anonymous = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const expired = await runSync(queued(crypto.randomUUID(), projectA, versionId), transportFor(anonymous, projectA), async () => [], async () => undefined, true);
    expect(expired.serverConfirmed).toBe(false);
    expect(expired.record.blockedReason).toBe('reauth');
    expect((expired.record.answers as { q_name: string }).q_name).toBe('North bank');

    const field = need('fieldworker');
    expect((await admin.from('project_members').delete().eq('project_id', projectA).eq('user_id', field.id)).error).toBeNull();
    const denied = await runSync(queued(crypto.randomUUID(), projectA, versionId), transportFor(field.client, projectA), async () => [], async () => undefined, true);
    expect(denied.serverConfirmed).toBe(false);
    expect(denied.record.blockedReason).toBe('forbidden');
    expect((denied.record.answers as { q_name: string }).q_name).toBe('North bank');
    expect((await admin.from('project_members').insert({ project_id: projectA, user_id: field.id, role: 'fieldworker' })).error).toBeNull();
  });

  it('P7 treats an unreachable server as retryable and does not mark the record synced', async () => {
    const transport = new InjectingTransport(transportFor(need('fieldworker').client, projectA), {
      boundary: 'create_or_recover',
      times: 1,
      when: 'before',
      error: new TypeError('failed to fetch'),
    });
    const outcome = await runSync(queued(crypto.randomUUID(), projectA, versionId), transport, async () => [], async () => undefined, true);
    expect(outcome.serverConfirmed).toBe(false);
    expect(outcome.record.status).toBe('failed');
  });

  it('P7 concurrent workers leave a single server row', async () => {
    const client = need('fieldworker').client;
    const id = crypto.randomUUID();
    const results = await Promise.all([
      runSync(queued(id, projectA, versionId), transportFor(client, projectA), async () => [], async () => undefined, true),
      runSync(queued(id, projectA, versionId), transportFor(client, projectA), async () => [], async () => undefined, true),
    ]);
    expect(results.filter((result) => result.serverConfirmed || result.record.blockedReason === 'conflict').length).toBeGreaterThan(0);
    expect((await admin.from('submissions').select('id').eq('id', id)).data).toHaveLength(1);
  });

  it('P7 reopens a failed upload from the persisted local status', async () => {
    const client = need('fieldworker').client;
    const id = crypto.randomUUID();
    let stored = queued(id, projectA, versionId);
    const transport = new InjectingTransport(transportFor(client, projectA), {
      boundary: 'finalize',
      times: 1,
      when: 'before',
      error: new TypeError('network unreachable'),
    });
    const dropped = await runSync(stored, transport, async () => [], async (next) => {
      stored = next;
    }, true);
    expect(dropped.serverConfirmed).toBe(false);
    const reopened = await runSync(stored, transportFor(client, projectA), async () => [], async () => undefined, true);
    expect(reopened.serverConfirmed).toBe(true);
  });

  it('P8-02 and P8-03 let a researcher change review status without changing answers', async () => {
    const id = await completeRecord(need('fieldworker').client, projectA, versionId);
    const before = await admin.from('submissions').select('answers').eq('id', id).single();
    expect((await need('researcher').client.rpc('set_review_status', { p_id: id, p_status: 'accepted' })).error).toBeNull();
    const after = await admin.from('submissions').select('answers, review_status').eq('id', id).single();
    expect(after.data).toMatchObject({ answers: (before.data as { answers: unknown }).answers, review_status: 'accepted' });
    expect((await need('viewer').client.rpc('set_review_status', { p_id: id, p_status: 'rejected' })).error).toBeTruthy();
  });

  it('P8-04 hides another organization submissions from direct reads', async () => {
    const id = await completeRecord(need('fieldworker').client, projectA, versionId);
    const read = await need('outsider').client.from('submissions').select('id, answers').eq('id', id);
    expect(read.data).toEqual([]);
  });

  function need(role: RoleName): Account {
    const value = accounts.get(role);
    if (!value) throw new Error(role);
    return value;
  }
});

async function createOrg(client: SupabaseClient, name: string): Promise<string> {
  const result = await client.rpc('create_organization', { org_name: name });
  if (result.error || !result.data) throw new Error(result.error?.message ?? 'create org failed');
  return String(result.data);
}

async function createProject(client: SupabaseClient, orgId: string, name: string): Promise<string> {
  const result = await client.rpc('create_project', { p_org_id: orgId, p_name: name, p_description: '' });
  if (result.error || !result.data) throw new Error(result.error?.message ?? 'create project failed');
  return String((result.data as { id: string }).id);
}

function queued(id: string, projectId: string, formVersionId: string): SyncRecord {
  return {
    id,
    projectId,
    formVersionId,
    answers: { q_name: 'North bank' },
    location: null,
    clientCapturedAt: '2026-04-01T12:00:00.000Z',
    status: 'queued',
    step: 'idle',
    attempts: 0,
    permanent: false,
  };
}

function transportFor(client: SupabaseClient, projectId: string): SyncTransport {
  return {
    async createOrRecover(body) {
      const hash = await payloadHash(body);
      const result = await client.rpc('create_or_recover_submission', {
        p_id: body.id,
        p_project_id: body.projectId,
        p_form_version_id: body.formVersionId,
        p_answers: body.answers,
        p_location: body.location,
        p_client_captured_at: body.clientCapturedAt,
        p_payload_hash: hash,
      });
      if (result.error) throw mapped(result.error);
      const payload = result.data as { status: 'created' | 'recovered' | 'conflict'; ingestion_status: 'pending' | 'complete'; payload_hash: string };
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
      if (result.error) throw mapped(result.error);
    },
    async uploadAttachment(submissionId, attachment) {
      const path = `${projectId}/${submissionId}/${attachment.id}`;
      const upload = await client.storage.from('attachments').upload(path, attachment.bytes, {
        contentType: attachment.contentType,
        upsert: true,
      });
      if (upload.error) throw new SyncRequestError(upload.error.message, 'retry', null);
      const marked = await client.rpc('mark_attachment_uploaded', { p_id: attachment.id, p_checksum: attachment.checksum });
      if (marked.error) throw mapped(marked.error);
    },
    async verifyAttachments(submissionId) {
      const result = await client.rpc('verify_submission_attachments', { p_submission_id: submissionId });
      if (result.error) throw mapped(result.error);
      return result.data as { ok: boolean; missing: string[] };
    },
    async finalize(submissionId, hash) {
      const result = await client.rpc('finalize_submission', { p_id: submissionId, p_payload_hash: hash });
      if (result.error) throw mapped(result.error);
      const payload = result.data as { ingestion_status?: string };
      if (payload.ingestion_status !== 'complete') throw new SyncRequestError('Server did not confirm complete ingestion', 'retry', 503);
      return { ingestionStatus: 'complete' };
    },
  };
}

function mapped(error: { message: string; code?: string; status?: number }): SyncRequestError {
  const status = error.status ?? (error.code === 'PGRST301' ? 401 : error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400);
  if (status === 401 || /jwt|not authenticated|unauthorized/i.test(error.message)) return new SyncRequestError(error.message, 'reauth', 401);
  if (status === 403) return new SyncRequestError(error.message, 'forbidden', 403);
  if (status === 409) return new SyncRequestError(error.message, 'conflict', 409);
  if (error.message.toLowerCase().includes('attachment')) return new SyncRequestError(error.message, 'permanent', 422);
  return new SyncRequestError(error.message, status >= 500 ? 'retry' : 'permanent', status);
}

async function completeRecord(
  client: SupabaseClient,
  projectId: string,
  formVersionId: string,
  file?: { id: string; questionId: string; contentType: string; bytes: ArrayBuffer },
): Promise<{ id: string; path: string }> {
  const id = crypto.randomUUID();
  const checksum = file ? await sha256Hex(file.bytes) : '';
  const attachment: AttachmentUpload | null = file
    ? { id: file.id, questionId: file.questionId, contentType: file.contentType, byteSize: file.bytes.byteLength, checksum, bytes: file.bytes }
    : null;
  const outcome = await runSync(
    queued(id, projectId, formVersionId),
    transportFor(client, projectId),
    async () => (attachment ? [attachment] : []),
    async () => undefined,
    true,
  );
  if (!outcome.serverConfirmed) throw new Error(outcome.record.lastError ?? 'sync failed');
  return { id, path: attachment ? `${projectId}/${id}/${attachment.id}` : '' };
}
