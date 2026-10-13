import { useState } from 'react';
import { applyManualAdjustment, formatAccuracy, formatCoordinate } from '../domain/gps/location';
import { choiceLabel, evaluateVisibility, isLocation, isPhotoAnswer } from '../domain/survey/engine';
import type { AnswerMap, AnswerValue, LocationReading, Question, SurveyDefinition } from '../domain/survey/types';

export function FormRenderer(props: {
  definition: SurveyDefinition;
  answers: AnswerMap;
  errors?: Record<string, string>;
  disabled?: boolean;
  photoNotes?: Record<string, string>;
  previews?: Record<string, string>;
  onChange: (questionId: string, value: AnswerValue) => void;
  onCaptureLocation?: (questionId: string) => void;
  locationMessage?: string;
  onPhoto?: (questionId: string, file: File) => void;
}) {
  const visibility = evaluateVisibility(props.definition, props.answers);
  return (
    <div className="stack">
      {props.definition.questions.map((question, index) => {
        if (!visibility[question.id]) return null;
        if (question.type === 'section') {
          return (
            <h2 key={question.id} id={question.id}>
              {question.label}
            </h2>
          );
        }
        return (
          <fieldset key={question.id} className="card question" aria-describedby={props.errors?.[question.id] ? `${question.id}-error` : undefined}>
            <legend>
              {index + 1}. {question.label}
              {question.required ? ' (required)' : ''}
            </legend>
            {question.description ? <p className="muted">{question.description}</p> : null}
            <QuestionControl
              question={question}
              value={props.answers[question.id]}
              disabled={props.disabled}
              photoNote={props.photoNotes?.[question.id]}
              preview={props.previews?.[question.id]}
              onChange={(value) => props.onChange(question.id, value)}
              onCaptureLocation={props.onCaptureLocation ? () => props.onCaptureLocation?.(question.id) : undefined}
              onPhoto={props.onPhoto ? (file) => props.onPhoto?.(question.id, file) : undefined}
            />
            {props.locationMessage && question.type === 'gps' ? <p role="status">{props.locationMessage}</p> : null}
            {props.errors?.[question.id] ? (
              <p id={`${question.id}-error`} className="error" role="alert">
                {props.errors[question.id]}
              </p>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}

function QuestionControl(props: {
  question: Question;
  value: AnswerValue | undefined;
  disabled?: boolean;
  photoNote?: string;
  preview?: string;
  onChange: (value: AnswerValue) => void;
  onCaptureLocation?: () => void;
  onPhoto?: (file: File) => void;
}) {
  const { question, value, disabled } = props;
  if (question.type === 'text') {
    const long = (question.validation?.maxLength ?? 0) > 120;
    return long ? (
      <textarea disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(event) => props.onChange(event.target.value)} aria-label={question.label} />
    ) : (
      <input disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(event) => props.onChange(event.target.value)} aria-label={question.label} />
    );
  }
  if (question.type === 'number') {
    return (
      <input
        type="number"
        disabled={disabled}
        aria-label={question.label}
        value={typeof value === 'number' ? String(value) : ''}
        min={question.validation?.min}
        max={question.validation?.max}
        step={question.validation?.integer ? 1 : 'any'}
        onChange={(event) => props.onChange(event.target.value === '' ? null : Number(event.target.value))}
      />
    );
  }
  if (question.type === 'date') {
    return (
      <input type="date" disabled={disabled} aria-label={question.label} value={typeof value === 'string' ? value : ''} onChange={(event) => props.onChange(event.target.value)} />
    );
  }
  if (question.type === 'boolean') {
    return (
      <div className="row" role="radiogroup" aria-label={question.label}>
        {[
          ['Yes', true],
          ['No', false],
        ].map(([label, next]) => (
          <label key={label as string} className="row">
            <input
              type="radio"
              name={question.id}
              disabled={disabled}
              checked={value === next}
              onChange={() => props.onChange(next as boolean)}
            />
            {label as string}
          </label>
        ))}
      </div>
    );
  }
  if (question.type === 'single_choice') {
    return (
      <div className="stack" role="radiogroup" aria-label={question.label}>
        {question.choices?.map((choice) => (
          <label key={choice.id} className="row">
            <input type="radio" name={question.id} disabled={disabled} checked={value === choice.id} onChange={() => props.onChange(choice.id)} />
            {choice.label}
          </label>
        ))}
      </div>
    );
  }
  if (question.type === 'multi_choice') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="stack">
        {question.choices?.map((choice) => (
          <label key={choice.id} className="row">
            <input
              type="checkbox"
              disabled={disabled}
              checked={selected.includes(choice.id)}
              onChange={(event) => {
                const next = event.target.checked ? [...selected, choice.id] : selected.filter((id) => id !== choice.id);
                props.onChange(next);
              }}
            />
            {choice.label}
          </label>
        ))}
      </div>
    );
  }
  if (question.type === 'gps') {
    return <GpsControl question={question} value={isLocation(value) ? value : null} disabled={disabled} onChange={props.onChange} onCapture={props.onCaptureLocation} />;
  }
  if (question.type === 'photo') {
    return (
      <div className="stack">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled}
          aria-label={question.label}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && props.onPhoto) props.onPhoto(file);
          }}
        />
        {isPhotoAnswer(value) ? (
          <p>
            Stored photo: {value.byteSize} bytes. The preview is temporary and is not the saved file.
          </p>
        ) : (
          <p className="muted">No photo stored yet.</p>
        )}
        {props.preview ? <img src={props.preview} alt="Stored photo preview" /> : null}
      </div>
    );
  }
  return null;
}

function GpsControl(props: {
  question: Question;
  value: LocationReading | null;
  disabled?: boolean;
  onChange: (value: AnswerValue) => void;
  onCapture?: () => void;
}) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const reading = props.value;
  return (
    <div className="stack">
      <button type="button" className="secondary" disabled={props.disabled} onClick={props.onCapture}>
        Capture location
      </button>
      {reading ? (
        <div>
          <p>
            <span className="status-pill">{reading.source === 'manual' ? 'Manual' : 'Device'}</span>{' '}
            {formatCoordinate(reading.latitude, reading.accuracy)}, {formatCoordinate(reading.longitude, reading.accuracy)} {formatAccuracy(reading.accuracy)}
          </p>
          {reading.originalDevice ? (
            <p className="muted">
              Original device reading: {reading.originalDevice.latitude}, {reading.originalDevice.longitude}{' '}
              {formatAccuracy(reading.originalDevice.accuracy)}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="muted">No coordinates recorded.</p>
      )}
      {props.question.allowManualLocation ? (
        <div className="stack">
          <label>
            Manual latitude
            <input inputMode="decimal" disabled={props.disabled} value={lat} onChange={(event) => setLat(event.target.value)} />
          </label>
          <label>
            Manual longitude
            <input inputMode="decimal" disabled={props.disabled} value={lng} onChange={(event) => setLng(event.target.value)} />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={props.disabled}
            onClick={() => {
              const latitude = Number(lat);
              const longitude = Number(lng);
              if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
              props.onChange(applyManualAdjustment(reading, latitude, longitude));
            }}
          >
            Save manual location
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function answerSummary(question: Question, value: AnswerValue | undefined): string {
  if (question.type === 'single_choice' && typeof value === 'string') return choiceLabel(question, value);
  if (value === undefined || value === null) return '';
  return String(value);
}
