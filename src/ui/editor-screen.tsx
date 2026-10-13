import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { FormVersionRecord } from '../backend/types';
import { canPublish } from '../domain/authz/roles';
import { addChoice, createQuestion, deleteQuestion, duplicateQuestion, moveQuestion } from '../domain/survey/editor';
import { validateForPublish } from '../domain/survey/schema';
import type { Question, QuestionType, SurveyDefinition } from '../domain/survey/types';
import { QUESTION_TYPES } from '../domain/survey/types';
import { FormRenderer } from './form-renderer';
import { useApp } from './provider';

export function EditorScreen() {
  const { formId = '' } = useParams();
  const app = useApp();
  const [survey, setSurvey] = useState<SurveyDefinition | null>(null);
  const [projectId, setProjectId] = useState('');
  const [versions, setVersions] = useState<FormVersionRecord[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<FormVersionRecord | null>(null);
  const [preview, setPreview] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [roleCanPublish, setRoleCanPublish] = useState(false);

  useEffect(() => {
    void (async () => {
      const form = await app.backend.getForm(formId);
      setSurvey(form.draft);
      setProjectId(form.projectId);
      setVersions(await app.backend.listVersions(formId));
      const orgs = await app.backend.listOrganizations();
      for (const org of orgs) {
        const projects = await app.backend.listProjects(org.id);
        const match = projects.find((project) => project.id === form.projectId);
        if (match) setRoleCanPublish(canPublish(match.role));
      }
    })().catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Could not open the form'));
  }, [app.backend, formId]);

  if (!survey) return <p>{message || 'Loading form…'}</p>;
  return (
    <section className="stack">
      <h1>Form editor</h1>
      <label>
        Title
        <input value={survey.title} onChange={(event) => setSurvey({ ...survey, title: event.target.value })} />
      </label>
      <div className="row">
        <button type="button" className="secondary" onClick={() => void save()}>
          Save draft
        </button>
        {roleCanPublish ? (
          <button type="button" onClick={() => void publish()}>
            Publish
          </button>
        ) : (
          <p>Publishing is unavailable for this role.</p>
        )}
        <label className="row">
          <input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} />
          Mobile preview
        </label>
      </div>
      {message ? <p role="status">{message}</p> : null}
      {issues.length > 0 ? (
        <ul>
          {issues.map((issue) => (
            <li key={issue} className="error">
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
      {preview ? <FormRenderer definition={survey} answers={{}} onChange={() => undefined} /> : null}
      <ol className="stack">
        {survey.questions.map((question, index) => (
          <li key={question.id} className="card stack">
            <label>
              Label
              <input
                aria-label={`Label for question ${index + 1}`}
                value={question.label}
                onChange={(event) => updateQuestion(question.id, { label: event.target.value })}
              />
            </label>
            <p className="muted">ID {question.id}</p>
            <label className="row">
              <input type="checkbox" checked={question.required} disabled={question.type === 'section'} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} />
              Required
            </label>
            {question.choices ? (
              <div className="stack">
                {question.choices.map((choice) => (
                  <label key={choice.id}>
                    Choice
                    <input
                      aria-label={`Choice ${choice.id}`}
                      value={choice.label}
                      onChange={(event) =>
                        updateQuestion(question.id, {
                          choices: question.choices?.map((item) => (item.id === choice.id ? { ...item, label: event.target.value } : item)),
                        })
                      }
                    />
                  </label>
                ))}
                <button type="button" className="secondary" onClick={() => updateQuestion(question.id, { choices: addChoice(question.choices ?? []) })}>
                  Add choice
                </button>
              </div>
            ) : null}
            <div className="row">
              <button type="button" className="secondary" onClick={() => move(index, index - 1)}>
                Move up
              </button>
              <button type="button" className="secondary" onClick={() => move(index, index + 1)}>
                Move down
              </button>
              <button type="button" className="secondary" onClick={() => duplicate(question)}>
                Duplicate
              </button>
              <button type="button" className="danger" onClick={() => remove(question.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="row">
        <label>
          Add question
          <select id="new-question-type" defaultValue="text">
            {QUESTION_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            const select = document.getElementById('new-question-type') as HTMLSelectElement | null;
            const type = (select?.value ?? 'text') as QuestionType;
            setSurvey({ ...survey, questions: [...survey.questions, createQuestion(type)] });
          }}
        >
          Add question
        </button>
      </div>
      <h2>Published versions</h2>
      <ul>
        {versions.map((version) => (
          <li key={version.id}>
            <button type="button" className="secondary" onClick={() => setSelectedVersion(version)}>
              Version {version.versionNumber}
            </button>
          </li>
        ))}
      </ul>
      {selectedVersion ? (
        <div className="card">
          <h3>Version {selectedVersion.versionNumber} snapshot</h3>
          <ul>
            {selectedVersion.definition.questions.map((question) => (
              <li key={question.id}>
                {question.label} ({question.id})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );

  function updateQuestion(id: string, patch: Partial<Question>) {
    setSurvey((current) =>
      current
        ? { ...current, questions: current.questions.map((question) => (question.id === id ? { ...question, ...patch } : question)) }
        : current,
    );
  }

  function move(from: number, to: number) {
    if (!survey) return;
    const result = moveQuestion(survey.questions, from, to);
    if (!result.ok) setMessage(result.message);
    else setSurvey({ ...survey, questions: result.questions });
  }

  function duplicate(question: Question) {
    if (!survey) return;
    const index = survey.questions.findIndex((item) => item.id === question.id);
    const copy = duplicateQuestion(question);
    const questions = survey.questions.slice();
    questions.splice(index + 1, 0, copy);
    setSurvey({ ...survey, questions });
  }

  function remove(id: string) {
    if (!survey) return;
    const result = deleteQuestion(survey.questions, id);
    if (!result.ok) setMessage(result.message);
    else setSurvey({ ...survey, questions: result.questions });
  }

  async function save() {
    if (!survey) return;
    await app.backend.saveFormDraft({ id: formId, projectId, title: survey.title, draft: survey });
    setMessage('Draft saved');
  }

  async function publish() {
    if (!survey) return;
    const valid = validateForPublish(survey);
    if (!valid.ok) {
      setIssues(valid.issues.map((issue) => issue.message));
      setMessage('This form cannot be published');
      return;
    }
    setIssues([]);
    const version = await app.backend.publishForm(formId, survey);
    setVersions(await app.backend.listVersions(formId));
    setSelectedVersion(version);
    setMessage(`Published version ${version.versionNumber}`);
  }
}
