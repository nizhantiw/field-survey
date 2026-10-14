import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { canReview } from '../domain/authz/roles';
import type { Role } from '../domain/authz/roles';
import { applySubmissionFilter, reviewPatch, toCsv, toGeoJson, toJson, type ExportRecord, type SubmissionFilter } from '../domain/export/export';
import type { ReviewStatus } from '../domain/sync/states';
import { useApp } from './provider';
import { toneFor } from './tone';
import wildlife from '../../fixtures/forms/wildlife-count.json';
import { parseSurvey } from '../domain/survey/schema';

export function ReviewScreens(props: { mode: 'list' | 'detail' }) {
  return props.mode === 'list' ? <ReviewList /> : <ReviewDetail />;
}

function ReviewList() {
  const { projectId = '' } = useParams();
  const app = useApp();
  const [role, setRole] = useState<Role>('viewer');
  const [rows, setRows] = useState<ExportRecord[]>([]);
  const [showPending, setShowPending] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');

  const filter: SubmissionFilter = { ingestion: showPending ? 'all' : 'complete' };

  const load = async () => {
    const records = await app.backend.listSubmissions(projectId, { ingestion: 'all' });
    setRows(applySubmissionFilter(records, filter));
  };

  useEffect(() => {
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load submissions'));
    void (async () => {
      const orgs = await app.backend.listOrganizations();
      for (const org of orgs) {
        const projects = await app.backend.listProjects(org.id);
        const match = projects.find((project) => project.id === projectId);
        if (match) setRole(match.role);
      }
    })();
    // filter is derived from showPending
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.backend, projectId, showPending]);

  const definition = parseSurvey(wildlife);
  return (
    <section className="stack">
      <h1>Submissions</h1>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {canReview(role) ? (
        <label className="row">
          <input type="checkbox" checked={showPending} onChange={(event) => setShowPending(event.target.checked)} />
          Show pending ingestion
        </label>
      ) : null}
      <p>{rows.length} records in this view. The map uses the same completed set.</p>
      <ul className="stack">
        {rows.map((row) => (
          <li key={row.id} className="card">
            <Link to={`/projects/${projectId}/submissions/${row.id}`}>{row.id}</Link>
            <span className="status-pill" data-tone={toneFor(row.ingestionStatus === 'complete' ? 'Complete ingestion' : 'Pending — not a completed result')}>{row.ingestionStatus === 'complete' ? 'Complete ingestion' : 'Pending — not a completed result'}</span>
            <span className="status-pill" data-tone={toneFor(row.reviewStatus)}>{row.reviewStatus}</span>
          </li>
        ))}
      </ul>
      <div className="row">
        <button type="button" onClick={() => definition.ok && setPreview(toCsv(applySubmissionFilter(rows, { ingestion: 'complete' }), definition.survey))}>
          Preview CSV
        </button>
        <button type="button" onClick={() => definition.ok && setPreview(toJson(applySubmissionFilter(rows, { ingestion: 'complete' }), definition.survey))}>
          Preview JSON
        </button>
        <button type="button" onClick={() => definition.ok && setPreview(toGeoJson(applySubmissionFilter(rows, { ingestion: 'complete' }), definition.survey))}>
          Preview GeoJSON
        </button>
      </div>
      {preview ? (
        <pre data-testid="export-preview" tabIndex={0}>
          {preview}
        </pre>
      ) : null}
    </section>
  );
}

function ReviewDetail() {
  const { projectId = '', submissionId = '' } = useParams();
  const app = useApp();
  const [row, setRow] = useState<ExportRecord | null>(null);
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState('');
  useEffect(() => {
    void app.backend.listSubmissions(projectId, { ingestion: 'all' }).then((rows) => {
      setRow(rows.find((item) => item.id === submissionId) ?? null);
    });
    void (async () => {
      const orgs = await app.backend.listOrganizations();
      for (const org of orgs) {
        const projects = await app.backend.listProjects(org.id);
        const match = projects.find((project) => project.id === projectId);
        if (match) setRole(match.role);
      }
    })();
  }, [app.backend, projectId, submissionId]);
  if (!row) return <p>Record not available.</p>;
  const before = JSON.stringify(row.answers);
  return (
    <section className="stack">
      <h1>Submission</h1>
      <p>Form version {row.versionNumber}</p>
      <p>
        Ingestion:{' '}
        <span className="status-pill" data-tone={toneFor(row.ingestionStatus === 'complete' ? 'Complete ingestion' : 'Pending — not a completed result')}>
          {row.ingestionStatus === 'complete' ? 'Complete ingestion' : 'Pending — not a completed result'}
        </span>
      </p>
      <p>
        Review: <span className="status-pill" data-tone={toneFor(row.reviewStatus)}>{row.reviewStatus}</span>
      </p>
      <pre>{JSON.stringify(row.answers, null, 2)}</pre>
      {canReview(role) ? (
        <label>
          Review status
          <select
            aria-label="Review status"
            value={row.reviewStatus}
            onChange={(event) => {
              const status = event.target.value as ReviewStatus;
              const patch = reviewPatch(status);
              if ('answers' in patch) return;
              void app.backend.setReviewStatus(row.id, status).then((updated) => {
                if (JSON.stringify(updated.answers) !== before) {
                  setError('Review tried to change answers');
                  return;
                }
                setRow(updated);
              }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not update review status'));
            }}
          >
            {['unreviewed', 'accepted', 'rejected', 'needs_followup'].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
      ) : (
        <p>Review changes are unavailable for this role.</p>
      )}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <Link to={`/projects/${projectId}/submissions`}>Back to submissions</Link>
    </section>
  );
}
