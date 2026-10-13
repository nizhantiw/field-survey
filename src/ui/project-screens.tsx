import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { canCollect, canManageMembers, canPublish, type Role } from '../domain/authz/roles';
import { createEmptySurvey } from '../domain/survey/editor';
import { cacheForm, createDraft } from '../db/records';
import { tabId, useApp } from './provider';
import { useNavigate } from 'react-router';

export function ProjectScreens(props: { mode: 'org' | 'project' }) {
  return props.mode === 'org' ? <OrgScreen /> : <ProjectScreen />;
}

function OrgScreen() {
  const { orgId = '' } = useParams();
  const app = useApp();
  const [name, setName] = useState('');
  const [projects, setProjects] = useState<{ id: string; name: string; role: Role }[]>([]);
  const [members, setMembers] = useState<{ userId: string; displayName: string; role: Role }[]>([]);
  const [error, setError] = useState('');
  const load = () => {
    void app.backend.listProjects(orgId).then(setProjects).catch((reason: unknown) => setError(message(reason)));
    void app.backend.listOrgMembers(orgId).then(setMembers).catch((reason: unknown) => setError(message(reason)));
  };
  useEffect(load, [app.backend, orgId]);
  const actor = members.find((member) => member.userId === app.user?.id);
  return (
    <section className="stack">
      <h1>Organization</h1>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <ul className="stack">
        {projects.map((project) => (
          <li key={project.id} className="card">
            <Link to={`/projects/${project.id}`}>{project.name}</Link> <span className="status-pill">{project.role}</span>
          </li>
        ))}
      </ul>
      {actor && canPublish(actor.role) ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void app.backend.createProject(orgId, name, '').then(() => {
              setName('');
              load();
            }).catch((reason: unknown) => setError(message(reason)));
          }}
        >
          <label>
            New project
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="submit">Create project</button>
        </form>
      ) : null}
      <h2>Members</h2>
      <ul className="stack">
        {members.map((member) => (
          <li key={member.userId} className="card row">
            <span>{member.displayName}</span>
            <span className="status-pill">{member.role}</span>
            {actor && canManageMembers(actor.role) ? (
              <label>
                Role
                <select
                  aria-label={`Role for ${member.displayName}`}
                  value={member.role}
                  onChange={(event) => {
                    void app.backend.setOrgMemberRole(orgId, member.userId, event.target.value as Role).then(load).catch((reason: unknown) => setError(message(reason)));
                  }}
                >
                  {['owner', 'admin', 'researcher', 'fieldworker', 'viewer'].map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectScreen() {
  const { projectId = '' } = useParams();
  const app = useApp();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [forms, setForms] = useState<{ id: string; title: string; currentVersionId: string | null; currentVersionNumber: number | null }[]>([]);
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState('');
  useEffect(() => {
    void app.backend.listForms(projectId).then(setForms).catch((reason: unknown) => setError(message(reason)));
  }, [app.backend, projectId]);
  useEffect(() => {
    void (async () => {
      const orgs = await app.backend.listOrganizations();
      for (const org of orgs) {
        const projects = await app.backend.listProjects(org.id);
        const match = projects.find((project) => project.id === projectId);
        if (match) setRole(match.role);
      }
    })().catch((reason: unknown) => setError(message(reason)));
  }, [app.backend, projectId]);
  return (
    <section className="stack">
      <h1>Project</h1>
      <p>
        Your role: <span className="status-pill">{role}</span>
      </p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <ul className="stack">
        {forms.map((form) => (
          <li key={form.id} className="card stack">
            <strong>{form.title}</strong>
            <span className="muted">{form.currentVersionNumber ? `Published version ${form.currentVersionNumber}` : 'Not published'}</span>
            <div className="row">
              {canPublish(role) ? <Link to={`/projects/${projectId}/forms/${form.id}`}>Edit</Link> : null}
              {canCollect(role) && form.currentVersionId ? (
                <button type="button" onClick={() => void startCollect(form.currentVersionId as string, form.id)}>
                  Collect
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <Link to={`/projects/${projectId}/submissions`}>Review submissions</Link>
      {canPublish(role) ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const draft = createEmptySurvey(title || 'Untitled survey');
            void app.backend.saveFormDraft({ projectId, title: draft.title, draft }).then((form) => navigate(`/projects/${projectId}/forms/${form.id}`));
          }}
        >
          <label>
            New form title
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button type="submit">Create form</button>
        </form>
      ) : null}
    </section>
  );

  async function startCollect(versionId: string, formId: string) {
    if (!app.user) return;
    const version = await app.backend.getVersion(versionId);
    await cacheForm(app.db, {
      key: `${app.user.id}:${version.id}`,
      userId: app.user.id,
      formId,
      projectId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      title: version.definition.title,
      definition: version.definition,
      downloadedAt: new Date().toISOString(),
    });
    const record = await createDraft(app.db, {
      id: crypto.randomUUID(),
      userId: app.user.id,
      projectId,
      formId,
      formVersionId: version.id,
      versionNumber: version.versionNumber,
      definitionSnapshot: version.definition,
      tabId: tabId(),
    });
    navigate(`/drafts/${record.id}`);
  }
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong';
}
