import { useEffect, useRef, useState } from 'react';
import { SurveyCreator, SurveyCreatorComponent } from 'survey-creator-react';
import 'survey-core/survey-core.min.css';
import 'survey-creator-core/survey-creator-core.min.css';
import type { SurveyDefinition } from '../domain/survey/types';
import { fromSurveyJson, registerFieldSurveyProperties, toSurveyJson } from '../surveyjs/engine';

export function SurveyJsDesigner(props: { survey: SurveyDefinition; onChange: (survey: SurveyDefinition) => void; onIssues: (issues: string[]) => void }) {
  const onChange = useRef(props.onChange);
  const onIssues = useRef(props.onIssues);
  const survey = useRef(props.survey);
  onChange.current = props.onChange;
  onIssues.current = props.onIssues;
  survey.current = props.survey;
  const [creator, setCreator] = useState<SurveyCreator | null>(null);

  useEffect(() => {
    registerFieldSurveyProperties();
    const next = new SurveyCreator({ showLogicTab: true, showTranslationTab: false, showThemeTab: false });
    next.JSON = toSurveyJson(survey.current);
    next.onModified.add(() => {
      const result = fromSurveyJson(next.JSON, { id: survey.current.id, title: survey.current.title });
      if (!result.ok) {
        onIssues.current(result.issues);
        return;
      }
      onIssues.current([]);
      onChange.current(result.survey);
    });
    setCreator(next);
    return () => {
      next.dispose();
    };
  }, []);

  if (!creator) return <p>Loading SurveyJS…</p>;
  return (
    <div className="survey-designer">
      <SurveyCreatorComponent creator={creator} />
    </div>
  );
}
