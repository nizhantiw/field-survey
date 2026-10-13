import infrastructure from '../../fixtures/forms/infrastructure.json';
import siteVisit from '../../fixtures/forms/site-visit.json';
import wildlife from '../../fixtures/forms/wildlife-count.json';
import { canAssignRole, canPublish, canReview, isLastOwnerRemoval, type Role } from '../domain/authz/roles';
import { applySubmissionFilter, type ExportRecord } from '../domain/export/export';
import { payloadHash } from '../domain/hash';
import { parseManifest, type MapManifest } from '../domain/maps/manifest';
import { validateForPublish } from '../domain/survey/schema';
import type { SurveyDefinition } from '../domain/survey/types';
import { MemorySyncServer, type SyncTransport } from '../domain/sync/protocol';
import { SyncRequestError } from '../domain/sync/retry';
import { createKeyMutex } from './mutex';
import type { FieldBackend, FormSummary, FormVersionRecord } from './types';

const STORAGE_KEY = 'fieldsurvey.harness.v1';
const SESSION_KEY = 'fieldsurvey.harness.session';

const ORG_NORTH = '55555555-5555-4555-8555-555555555555';
const ORG_SOUTH = '66666666-6666-4666-8666-666666666666';
const PROJECT_RIPARIAN = '44444444-4444-4444-8444-444444444444';
const PROJECT_SOUTH = '77777777-7777-4777-8777-777777777777';

interface HarnessUser {
  id: string;
  email: string;
  displayName: string;
  password: string;
}

interface HarnessState {
  users: HarnessUser[];
  organizations: { id: string; name: string; createdBy: string }[];
  orgMembers: { organizationId: string; userId: string; role: Role }[];
  projects: { id: string; organizationId: string; name: string; description: string; createdBy: string }[];
  projectMembers: { projectId: string; userId: string; role: Role }[];
  forms: {
    id: string;
    projectId: string;
    title: string;
    draft: SurveyDefinition;
    currentVersionId: string | null;
  }[];
  versions: FormVersionRecord[];
  submissions: ExportRecord[];
}

function requireSurvey(input: unknown): SurveyDefinition {
  const parsed = validateForPublish(input as SurveyDefinition);
  if (!parsed.ok) {
    throw new Error(`Invalid sample survey: ${parsed.issues.map((issue) => issue.message).join('; ')}`);
  }
  return structuredClone(input) as SurveyDefinition;
}

function seed(password: string): HarnessState {
  const users: HarnessUser[] = [
    { id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa1', email: 'owner@fieldsurvey.test', displayName: 'Olivia Owner', password },
    { id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa2', email: 'researcher@fieldsurvey.test', displayName: 'Riley Researcher', password },
    { id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa3', email: 'fieldworker@fieldsurvey.test', displayName: 'Finn Fieldworker', password },
    { id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa4', email: 'viewer@fieldsurvey.test', displayName: 'Vera Viewer', password },
    { id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa5', email: 'outsider@fieldsurvey.test', displayName: 'Omar Outsider', password },
  ];
  const samples = [requireSurvey(siteVisit), requireSurvey(wildlife), requireSurvey(infrastructure)];
  const forms = samples.map((definition, index) => ({
    id: definition.id,
    projectId: PROJECT_RIPARIAN,
    title: definition.title,
    draft: definition,
    currentVersionId: `88888888-8888-4888-8888-88888888888${index + 1}`,
  }));
  const versions: FormVersionRecord[] = forms.map((form) => ({
    id: form.currentVersionId ?? '',
    formId: form.id,
    projectId: PROJECT_RIPARIAN,
    versionNumber: 1,
    definition: structuredClone(form.draft),
    publishedAt: '2026-01-15T12:00:00.000Z',
  }));
  return {
    users,
    organizations: [
      { id: ORG_NORTH, name: 'North Basin Survey', createdBy: users[0]!.id },
      { id: ORG_SOUTH, name: 'South Range', createdBy: users[4]!.id },
    ],
    orgMembers: [
      { organizationId: ORG_NORTH, userId: users[0]!.id, role: 'owner' },
      { organizationId: ORG_NORTH, userId: users[1]!.id, role: 'researcher' },
      { organizationId: ORG_NORTH, userId: users[2]!.id, role: 'fieldworker' },
      { organizationId: ORG_NORTH, userId: users[3]!.id, role: 'viewer' },
      { organizationId: ORG_SOUTH, userId: users[4]!.id, role: 'owner' },
    ],
    projects: [
      {
        id: PROJECT_RIPARIAN,
        organizationId: ORG_NORTH,
        name: 'Riparian plots',
        description: 'Repeat visits along the north basin.',
        createdBy: users[0]!.id,
      },
      {
        id: PROJECT_SOUTH,
        organizationId: ORG_SOUTH,
        name: 'South fences',
        description: 'Restricted to the south organization.',
        createdBy: users[4]!.id,
      },
    ],
    projectMembers: [
      { projectId: PROJECT_RIPARIAN, userId: users[0]!.id, role: 'owner' },
      { projectId: PROJECT_RIPARIAN, userId: users[1]!.id, role: 'researcher' },
      { projectId: PROJECT_RIPARIAN, userId: users[2]!.id, role: 'fieldworker' },
      { projectId: PROJECT_RIPARIAN, userId: users[3]!.id, role: 'viewer' },
      { projectId: PROJECT_SOUTH, userId: users[4]!.id, role: 'owner' },
    ],
    forms,
    versions,
    submissions: [
      {
        id: '99999999-9999-4999-8999-999999999991',
        projectId: PROJECT_RIPARIAN,
        formId: '22222222-2222-4222-8222-222222222222',
        formVersionId: '88888888-8888-4888-8888-888888888882',
        versionNumber: 1,
        collectorId: users[2]!.id,
        answers: { q_count: 2, q_sign: false, q_species: '=cmd|calc' },
        location: {
          latitude: 12.5,
          longitude: 7.25,
          accuracy: 15,
          timestamp: '2026-02-02T00:00:00.000Z',
          source: 'device',
        },
        clientCapturedAt: '2026-02-02T00:00:00.000Z',
        serverReceivedAt: '2026-02-02T00:05:00.000Z',
        payloadHash: 'fixture-complete-hash',
        ingestionStatus: 'complete',
        reviewStatus: 'unreviewed',
      },
      {
        id: '99999999-9999-4999-8999-999999999992',
        projectId: PROJECT_RIPARIAN,
        formId: '22222222-2222-4222-8222-222222222222',
        formVersionId: '88888888-8888-4888-8888-888888888882',
        versionNumber: 1,
        collectorId: users[2]!.id,
        answers: { q_count: 1, q_sign: false },
        location: null,
        clientCapturedAt: '2026-02-03T00:00:00.000Z',
        serverReceivedAt: '2026-02-03T00:05:00.000Z',
        payloadHash: 'fixture-pending-hash',
        ingestionStatus: 'pending',
        reviewStatus: 'unreviewed',
      },
    ],
  };
}

export class PermissionError extends Error {
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'PermissionError';
  }
}

export class AuthFailedError extends Error {
  constructor() {
    super('Sign-in failed. Check your email and password.');
    this.name = 'AuthFailedError';
  }
}

export function createHarnessBackend(password: string, loadManifest: () => Promise<MapManifest>): FieldBackend {
  const exclusive = createKeyMutex();
  const memory = new MemorySyncServer();
  let manifestPromise: Promise<MapManifest> | null = null;

  const load = (): HarnessState => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = seed(password);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    return JSON.parse(raw) as HarnessState;
  };
  const save = (state: HarnessState) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  };
  const sessionUser = (): HarnessUser | null => {
    const id = localStorage.getItem(SESSION_KEY);
    if (!id) return null;
    return load().users.find((user) => user.id === id) ?? null;
  };
  const requireUser = (): HarnessUser => {
    const user = sessionUser();
    if (!user) throw new AuthFailedError();
    return user;
  };
  const projectRole = (state: HarnessState, projectId: string, userId: string): Role | null => {
    return state.projectMembers.find((member) => member.projectId === projectId && member.userId === userId)?.role ?? null;
  };
  const requireProject = (state: HarnessState, projectId: string, userId: string): Role => {
    const role = projectRole(state, projectId, userId);
    if (!role) throw new PermissionError('You do not have access to this project.');
    return role;
  };

  const transport = (): SyncTransport => {
    const inner = memory.transport();
    return {
      createOrRecover: async (body) => {
        const user = requireUser();
        const state = load();
        const role = projectRole(state, body.projectId, user.id);
        if (!role || role === 'viewer') throw new SyncRequestError('Upload was rejected. Local answers were kept.', 'forbidden', 403);
        if (localStorage.getItem('fieldsurvey.harness.revoke') === user.id) {
          throw new SyncRequestError('Upload was rejected. Local answers were kept.', 'forbidden', 403);
        }
        if (localStorage.getItem('fieldsurvey.harness.reauth') === '1') {
          throw new SyncRequestError('Sign in again to upload. Local answers were kept.', 'reauth', 401);
        }
        const version = state.versions.find((item) => item.id === body.formVersionId && item.projectId === body.projectId);
        if (!version) throw new SyncRequestError('Form version does not belong to this project', 'permanent', 422);
        const result = await inner.createOrRecover(body);
        if (result.status !== 'conflict') {
          const hash = await payloadHash(body);
          const existing = state.submissions.find((item) => item.id === body.id);
          if (!existing) {
            state.submissions.push({
              id: body.id,
              projectId: body.projectId,
              formId: version.formId,
              formVersionId: version.id,
              versionNumber: version.versionNumber,
              collectorId: user.id,
              answers: body.answers as Record<string, unknown>,
              location: body.location,
              clientCapturedAt: body.clientCapturedAt,
              serverReceivedAt: new Date().toISOString(),
              payloadHash: hash,
              ingestionStatus: 'pending',
              reviewStatus: 'unreviewed',
            });
            save(state);
          }
        }
        return result;
      },
      registerAttachments: (submissionId, attachments) => inner.registerAttachments(submissionId, attachments),
      uploadAttachment: (submissionId, attachment) => inner.uploadAttachment(submissionId, attachment),
      verifyAttachments: (submissionId) => inner.verifyAttachments(submissionId),
      finalize: async (submissionId, hash) => {
        const result = await inner.finalize(submissionId, hash);
        const state = load();
        const submission = state.submissions.find((item) => item.id === submissionId);
        if (submission && submission.payloadHash === hash) {
          submission.ingestionStatus = 'complete';
          save(state);
        }
        return result;
      },
    };
  };

  return {
    kind: 'harness',
    async signIn(email, givenPassword) {
      const state = load();
      const user = state.users.find((item) => item.email.toLowerCase() === email.trim().toLowerCase());
      if (!user || user.password !== givenPassword) throw new AuthFailedError();
      localStorage.setItem(SESSION_KEY, user.id);
      return { id: user.id, email: user.email, displayName: user.displayName };
    },
    async signOut() {
      localStorage.removeItem(SESSION_KEY);
    },
    async getSession() {
      const user = sessionUser();
      if (!user) return null;
      return { id: user.id, email: user.email, displayName: user.displayName };
    },
    async listOrganizations() {
      const user = requireUser();
      const state = load();
      return state.orgMembers
        .filter((member) => member.userId === user.id)
        .map((member) => {
          const org = state.organizations.find((item) => item.id === member.organizationId);
          if (!org) throw new PermissionError();
          return { id: org.id, name: org.name, role: member.role };
        });
    },
    async createOrganization(name) {
      const user = requireUser();
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Enter an organization name.');
      const state = load();
      if (localStorage.getItem('fieldsurvey.harness.fail-org') === '1') {
        throw new Error('Organization creation failed.');
      }
      const organization = { id: crypto.randomUUID(), name: trimmed, createdBy: user.id };
      const next: HarnessState = {
        ...state,
        organizations: [...state.organizations, organization],
        orgMembers: [...state.orgMembers, { organizationId: organization.id, userId: user.id, role: 'owner' }],
      };
      save(next);
      return { id: organization.id, name: organization.name, role: 'owner' };
    },
    async listOrgMembers(organizationId) {
      const user = requireUser();
      const state = load();
      if (!state.orgMembers.some((member) => member.organizationId === organizationId && member.userId === user.id)) {
        throw new PermissionError();
      }
      return state.orgMembers
        .filter((member) => member.organizationId === organizationId)
        .map((member) => {
          const person = state.users.find((item) => item.id === member.userId);
          return {
            userId: member.userId,
            email: person?.email ?? '',
            displayName: person?.displayName ?? 'Member',
            role: member.role,
          };
        });
    },
    async setOrgMemberRole(organizationId, userId, role) {
      const actor = requireUser();
      const state = load();
      const actorMember = state.orgMembers.find((member) => member.organizationId === organizationId && member.userId === actor.id);
      const target = state.orgMembers.find((member) => member.organizationId === organizationId && member.userId === userId);
      if (!actorMember || !target) throw new PermissionError();
      if (!canAssignRole(actorMember.role, target.role, role, actor.id === userId)) throw new PermissionError();
      const owners = state.orgMembers.filter((member) => member.organizationId === organizationId && member.role === 'owner').length;
      if (isLastOwnerRemoval(owners, target.role === 'owner', role)) {
        throw new Error('The last owner cannot be removed or demoted.');
      }
      target.role = role;
      save(state);
    },
    async listProjects(organizationId) {
      const user = requireUser();
      const state = load();
      const orgMember = state.orgMembers.find((member) => member.organizationId === organizationId && member.userId === user.id);
      if (!orgMember) throw new PermissionError();
      return state.projects
        .filter((project) => project.organizationId === organizationId)
        .filter((project) => projectRole(state, project.id, user.id))
        .map((project) => ({
          id: project.id,
          organizationId: project.organizationId,
          name: project.name,
          description: project.description,
          role: projectRole(state, project.id, user.id) ?? orgMember.role,
        }));
    },
    async createProject(organizationId, name, description) {
      const user = requireUser();
      const state = load();
      const orgMember = state.orgMembers.find((member) => member.organizationId === organizationId && member.userId === user.id);
      if (!orgMember || (orgMember.role !== 'owner' && orgMember.role !== 'admin' && orgMember.role !== 'researcher')) {
        throw new PermissionError();
      }
      const project = {
        id: crypto.randomUUID(),
        organizationId,
        name: name.trim(),
        description: description.trim(),
        createdBy: user.id,
      };
      state.projects.push(project);
      state.projectMembers.push({ projectId: project.id, userId: user.id, role: orgMember.role === 'researcher' ? 'researcher' : 'owner' });
      save(state);
      return { ...project, role: orgMember.role === 'researcher' ? 'researcher' : 'owner' };
    },
    async listForms(projectId) {
      const user = requireUser();
      const state = load();
      requireProject(state, projectId, user.id);
      return state.forms.filter((form) => form.projectId === projectId).map((form) => toSummary(state, form));
    },
    async getForm(formId) {
      const user = requireUser();
      const state = load();
      const form = state.forms.find((item) => item.id === formId);
      if (!form) throw new PermissionError('That form is not available.');
      requireProject(state, form.projectId, user.id);
      return toSummary(state, form);
    },
    async saveFormDraft(input) {
      const user = requireUser();
      const state = load();
      const role = requireProject(state, input.projectId, user.id);
      if (!canPublish(role)) throw new PermissionError();
      const existing = input.id ? state.forms.find((form) => form.id === input.id) : undefined;
      if (existing) {
        existing.title = input.title;
        existing.draft = structuredClone(input.draft);
        save(state);
        return toSummary(state, existing);
      }
      const form = {
        id: input.draft.id,
        projectId: input.projectId,
        title: input.title,
        draft: structuredClone(input.draft),
        currentVersionId: null,
      };
      state.forms.push(form);
      save(state);
      return toSummary(state, form);
    },
    async publishForm(formId, definition) {
      return exclusive(formId, async () => {
        const user = requireUser();
        const state = load();
        const form = state.forms.find((item) => item.id === formId);
        if (!form) throw new PermissionError('That form is not available.');
        const role = requireProject(state, form.projectId, user.id);
        if (!canPublish(role)) throw new PermissionError();
        const valid = validateForPublish(definition);
        if (!valid.ok) throw new Error(valid.issues.map((issue) => issue.message).join(' '));
        const versionNumber = state.versions.filter((version) => version.formId === formId).reduce((max, version) => Math.max(max, version.versionNumber), 0) + 1;
        const version: FormVersionRecord = {
          id: crypto.randomUUID(),
          formId,
          projectId: form.projectId,
          versionNumber,
          definition: structuredClone(definition),
          publishedAt: new Date().toISOString(),
        };
        state.versions.push(version);
        form.currentVersionId = version.id;
        form.title = definition.title;
        form.draft = structuredClone(definition);
        save(state);
        return version;
      });
    },
    async listVersions(formId) {
      const user = requireUser();
      const state = load();
      const form = state.forms.find((item) => item.id === formId);
      if (!form) throw new PermissionError();
      requireProject(state, form.projectId, user.id);
      return state.versions.filter((version) => version.formId === formId).map((version) => structuredClone(version));
    },
    async listPublishedVersions(projectId) {
      const user = requireUser();
      const state = load();
      requireProject(state, projectId, user.id);
      return state.versions.filter((version) => version.projectId === projectId).map((version) => structuredClone(version));
    },
    async getVersion(versionId) {
      const user = requireUser();
      const state = load();
      const version = state.versions.find((item) => item.id === versionId);
      if (!version) throw new PermissionError();
      requireProject(state, version.projectId, user.id);
      return structuredClone(version);
    },
    transport,
    async listSubmissions(projectId, filter) {
      const user = requireUser();
      const state = load();
      const role = requireProject(state, projectId, user.id);
      const rows = state.submissions.filter((submission) => {
        const version = state.versions.find((item) => item.id === submission.formVersionId);
        return version?.projectId === projectId;
      });
      const visible = rows.filter((submission) => {
        if (submission.ingestionStatus === 'complete') return true;
        if (canReview(role)) return true;
        return submission.collectorId === user.id;
      });
      return applySubmissionFilter(visible, filter ?? { ingestion: 'all' });
    },
    async setReviewStatus(submissionId, status) {
      const user = requireUser();
      const state = load();
      const submission = state.submissions.find((item) => item.id === submissionId);
      if (!submission) throw new PermissionError();
      const version = state.versions.find((item) => item.id === submission.formVersionId);
      if (!version) throw new PermissionError();
      const role = requireProject(state, version.projectId, user.id);
      if (!canReview(role)) throw new PermissionError();
      const answers = structuredClone(submission.answers);
      submission.reviewStatus = status;
      submission.answers = answers;
      save(state);
      return structuredClone(submission);
    },
    async listMapManifests(_projectId: string) {
      requireUser();
      if (!manifestPromise) manifestPromise = loadManifest();
      const manifest = await manifestPromise;
      return [parseManifest(manifest)];
    },
  };
}

function toSummary(state: HarnessState, form: HarnessState['forms'][number]): FormSummary {
  const current = form.currentVersionId ? state.versions.find((version) => version.id === form.currentVersionId) : undefined;
  return {
    id: form.id,
    projectId: form.projectId,
    title: form.title,
    draft: structuredClone(form.draft),
    currentVersionId: form.currentVersionId,
    currentVersionNumber: current?.versionNumber ?? null,
  };
}

export const HARNESS_IDS = {
  orgNorth: ORG_NORTH,
  projectRiparian: PROJECT_RIPARIAN,
};
