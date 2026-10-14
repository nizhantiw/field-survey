import { Model } from 'survey-core';
import { describe, expect, it } from 'vitest';
import siteVisit from '../../fixtures/forms/site-visit.json';
import wildlife from '../../fixtures/forms/wildlife-count.json';
import { fromSurveyJson, toSurveyJson } from '../../src/surveyjs/engine';
import type { SurveyDefinition } from '../../src/domain/survey/types';

describe('SurveyJS engine', () => {
  it('round-trips a site visit without changing stored questions', () => {
    const survey = siteVisit as SurveyDefinition;
    const converted = fromSurveyJson(toSurveyJson(survey), { id: survey.id, title: survey.title });
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.survey).toEqual(survey);
  });

  it('round-trips visibility, GPS, and number bounds', () => {
    const survey = wildlife as SurveyDefinition;
    const converted = fromSurveyJson(toSurveyJson(survey), { id: survey.id, title: survey.title });
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.survey.questions.find((question) => question.id === 'q_evidence')?.visibility).toEqual({
      match: 'all',
      conditions: [{ questionId: 'q_sign', operator: 'eq', value: true }],
    });
    expect(converted.survey.questions.find((question) => question.id === 'q_count')?.validation).toEqual({ min: 0, max: 999, integer: true });
  });

  it('keeps questions after SurveyJS serializes the designer JSON', () => {
    for (const survey of [siteVisit, wildlife] as SurveyDefinition[]) {
      const model = new Model(toSurveyJson(survey));
      const converted = fromSurveyJson(model.toJSON(), { id: survey.id, title: survey.title });
      expect(converted.ok).toBe(true);
      if (!converted.ok) return;
      expect(converted.survey).toEqual(survey);
    }
  });

  it('refuses repeating tables instead of dropping them', () => {
    const result = fromSurveyJson(
      {
        title: 'Species',
        pages: [{ name: 'page1', elements: [{ type: 'paneldynamic', name: 'trees', title: 'Trees', templateElements: [] }] }],
      },
      { id: '11111111-1111-4111-8111-111111111111', title: 'Species' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatch(/Repeating tables/i);
  });
});
