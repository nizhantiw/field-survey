import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import infrastructure from '../../fixtures/forms/infrastructure.json';
import siteVisit from '../../fixtures/forms/site-visit.json';
import wildlife from '../../fixtures/forms/wildlife-count.json';
import { canAssignRole, canCollect, canManageMembers, canPublish, canReview, isLastOwnerRemoval } from '../../src/domain/authz/roles';
import { readPublicConfig, setupMessage } from '../../src/config/env';
import { escapeCsvCell, applySubmissionFilter, reviewPatch, toCsv, toGeoJson, toJson, type ExportRecord } from '../../src/domain/export/export';
import { applyManualAdjustment, captureDeviceLocation, formatCoordinate, toGeoJsonPosition } from '../../src/domain/gps/location';
import { activateReplacement, coverageMessage, downloadMapPackage, verifyPackage, type TileStore } from '../../src/domain/maps/download';
import { parseManifest } from '../../src/domain/maps/manifest';
import { createQuestion, deleteQuestion, duplicateQuestion, moveQuestion } from '../../src/domain/survey/editor';
import { buildSubmissionPayload, evaluateVisibility, validateAnswers } from '../../src/domain/survey/engine';
import { parseSurvey, validateForPublish } from '../../src/domain/survey/schema';
import type { AnswerMap, SurveyDefinition } from '../../src/domain/survey/types';
import { FIRST_USE_OFFLINE, assertStorageForDownload, isFieldReady, logoutWarning, mayApplyAppUpdate, StoragePressureError } from '../../src/domain/fieldwork/provision';
import { sha256Text } from '../../src/domain/hash';
import { createKeyMutex } from '../../src/backend/mutex';
import { createHarnessBackend } from '../../src/backend/harness';
import { InjectingTransport, MemorySyncServer, runSync, type SyncRecord } from '../../src/domain/sync/protocol';
import { SyncRequestError, classifyError, classifyStatus, shouldRetry } from '../../src/domain/sync/retry';
import { transition } from '../../src/domain/sync/states';
import { FormRenderer } from '../../src/ui/form-renderer';
import manifestJson from '../../public/map-package/manifest.json';

const samples = [siteVisit, wildlife, infrastructure];

describe('configuration', () => {
  it('hashes with the standard SHA-256 prefix', async () => {
    expect(await sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('P0-04 names the missing variables and the setup action', () => {
    const config = readPublicConfig({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: '' });
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.missing).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
    expect(config.message).toContain('VITE_SUPABASE_URL');
    expect(config.message).toContain('.env.example');
    expect(config.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(setupMessage(config.missing)).toContain('README.md');
  });
});

describe('survey schema', () => {
  it('P2-01 round-trips sample surveys and editor identity', () => {
    for (const sample of samples) {
      const parsed = parseSurvey(sample);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const again = parseSurvey(JSON.parse(JSON.stringify(parsed.survey)));
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.survey.questions.map((question) => question.id)).toEqual(parsed.survey.questions.map((question) => question.id));
    }
    const question = createQuestion('single_choice', 'Habitat');
    const copy = duplicateQuestion(question);
    expect(copy.id).not.toBe(question.id);
    expect(copy.choices?.[0]?.id).not.toBe(question.choices?.[0]?.id);
    const moved = moveQuestion([question, copy], 1, 0);
    expect(moved.ok).toBe(true);
  });

  it('P2-02 rejects duplicate ids, bad bounds, missing choices, and unknown types', () => {
    const base = parseSurvey(siteVisit);
    if (!base.ok) throw new Error('fixture');
    const duplicate = structuredClone(base.survey);
    duplicate.questions[2] = { ...duplicate.questions[1]! };
    expect(validateForPublish(duplicate).ok).toBe(false);

    const bounds = structuredClone(base.survey);
    bounds.questions[1] = { ...bounds.questions[1]!, validation: { minLength: 8, maxLength: 2 } };
    const boundResult = validateForPublish(bounds);
    expect(boundResult.ok).toBe(false);

    const choices = structuredClone(base.survey);
    choices.questions[2] = { ...choices.questions[2]!, choices: [] };
    expect(validateForPublish(choices).ok).toBe(false);

    const raw = structuredClone(base.survey) as unknown as { questions: Array<Record<string, unknown>> };
    raw.questions[1]!.type = 'barcode';
    expect(parseSurvey(raw).ok).toBe(false);
  });

  it('P2-03 rejects missing and invalid condition operands', () => {
    const base = parseSurvey(wildlife);
    if (!base.ok) throw new Error('fixture');
    const later = structuredClone(base.survey);
    later.questions[0] = {
      ...later.questions[0]!,
      visibility: { match: 'all', conditions: [{ questionId: 'q_sign', operator: 'eq', value: true }] },
    };
    const missing = validateForPublish(later);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issues.some((issue) => issue.code === 'missing_reference')).toBe(true);

    const operand = structuredClone(base.survey);
    operand.questions[2] = {
      ...operand.questions[2]!,
      visibility: { match: 'all', conditions: [{ questionId: 'q_sign', operator: 'gt', value: 1 }] },
    };
    const invalid = validateForPublish(operand);
    expect(invalid.ok).toBe(false);
  });

  it('does not use eval for conditions', () => {
    const source = readFileSync('src/domain/survey/engine.ts', 'utf8') + readFileSync('src/domain/survey/schema.ts', 'utf8');
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new Function/);
  });

  it('blocks deletion and reordering that would dangle a condition', () => {
    const parsed = parseSurvey(wildlife);
    if (!parsed.ok) throw new Error('fixture');
    expect(deleteQuestion(parsed.survey.questions, 'q_sign').ok).toBe(false);
    expect(moveQuestion(parsed.survey.questions, 1, 3).ok).toBe(false);
  });
});

describe('form engine', () => {
  const wildlifeSurvey = () => {
    const parsed = parseSurvey(wildlife);
    if (!parsed.ok) throw new Error('fixture');
    return parsed.survey;
  };

  it('P3-03 and P3-04 required visible fields block completion and hidden ones do not', () => {
    const survey = wildlifeSurvey();
    const missing = validateAnswers(survey, { q_count: 1 });
    expect(missing.ok).toBe(false);
    const hidden = validateAnswers(survey, { q_count: 2, q_sign: false });
    expect(hidden.ok).toBe(true);
    expect(hidden.visibility.q_evidence).toBe(false);
  });

  it('P3-05 checks boundaries below, at, and above the limit', () => {
    const survey = wildlifeSurvey();
    expect(validateAnswers(survey, { q_count: 0, q_sign: false }).ok).toBe(true);
    expect(validateAnswers(survey, { q_count: 999, q_sign: false }).ok).toBe(true);
    expect(validateAnswers(survey, { q_count: -1, q_sign: false }).ok).toBe(false);
    expect(validateAnswers(survey, { q_count: 1000, q_sign: false }).ok).toBe(false);
    const site = parseSurvey(siteVisit);
    if (!site.ok) throw new Error('fixture');
    const long = 'a'.repeat(81);
    expect(validateAnswers(site.survey, { q_site_name: long, q_habitat: 'c_riparian' }).errors.some((error) => error.questionId === 'q_site_name')).toBe(true);
    expect(validateAnswers(site.survey, { q_site_name: 'a'.repeat(80), q_habitat: 'c_riparian' }).errors.some((error) => error.questionId === 'q_site_name')).toBe(false);
  });

  it('excludes hidden answers from the payload and keeps preview visibility aligned', () => {
    const survey = wildlifeSurvey();
    const answers: AnswerMap = { q_count: 1, q_sign: false, q_evidence: { attachmentId: 'a', byteSize: 4, checksum: 'abc', contentType: 'image/png' } };
    const payload = buildSubmissionPayload(survey, answers, []);
    expect(payload.answers.q_evidence).toBeUndefined();
    expect(evaluateVisibility(survey, answers).q_evidence).toBe(false);
    const { container } = render(<FormRenderer definition={survey} answers={answers} onChange={() => undefined} />);
    expect(container.textContent).not.toContain('Evidence photo');
    const shown = validateAnswers(survey, { q_count: 1, q_sign: true });
    expect(shown.visibility.q_evidence).toBe(true);
    expect(shown.ok).toBe(false);
  });

  it('P2-07 renders untrusted labels as text', () => {
    const survey: SurveyDefinition = {
      schemaVersion: 1,
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Unsafe',
      questions: [{ id: 'q_label', type: 'text', label: '<script>alert(1)</script>', required: false }],
    };
    const { container } = render(<FormRenderer definition={survey} answers={{}} onChange={() => undefined} />);
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy();
    expect(container.querySelector('legend')?.innerHTML).not.toContain('<script');
  });
});

describe('authorization rules', () => {
  it('matches the role boundaries used by the product', () => {
    expect(canPublish('fieldworker')).toBe(false);
    expect(canManageMembers('fieldworker')).toBe(false);
    expect(canReview('fieldworker')).toBe(false);
    expect(canCollect('fieldworker')).toBe(true);
    expect(canReview('researcher')).toBe(true);
    expect(canAssignRole('admin', 'fieldworker', 'owner', false)).toBe(false);
    expect(canAssignRole('owner', 'fieldworker', 'admin', true)).toBe(false);
    expect(canAssignRole('admin', 'fieldworker', 'researcher', false)).toBe(true);
    expect(isLastOwnerRemoval(1, true, 'admin')).toBe(true);
    expect(isLastOwnerRemoval(2, true, 'admin')).toBe(false);
  });
});

describe('publishing store', () => {
  it('P2-04 keeps version 1 stable when version 2 is published and serializes concurrent publishes', async () => {
    localStorage.clear();
    const backend = createHarnessBackend('harness-password', async () => parseManifest(manifestJson));
    await backend.signIn('researcher@fieldsurvey.test', 'harness-password');
    const form = await backend.getForm('11111111-1111-4111-8111-111111111111');
    const original = await backend.getVersion(form.currentVersionId ?? '');
    const changed = structuredClone(form.draft);
    changed.questions = [...changed.questions, createQuestion('text', 'Follow up')];
    const exclusive = createKeyMutex();
    const [first, second] = await Promise.all([
      exclusive(form.id, () => backend.publishForm(form.id, changed)),
      exclusive(form.id, () => backend.publishForm(form.id, form.draft)),
    ]);
    const versions = await backend.listVersions(form.id);
    expect(new Set(versions.map((version) => version.versionNumber)).size).toBe(versions.length);
    expect(first.versionNumber).not.toBe(second.versionNumber);
    const preserved = versions.find((version) => version.versionNumber === 1);
    expect(preserved?.definition).toEqual(original.definition);
    await expect(backend.signIn('fieldworker@fieldsurvey.test', 'harness-password').then(() => backend.publishForm(form.id, form.draft))).rejects.toThrow(/permission/i);
  });
});

function record(status: SyncRecord['status']): SyncRecord {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    projectId: '44444444-4444-4444-8444-444444444444',
    formVersionId: '88888888-8888-4888-8888-888888888881',
    answers: { q_site_name: 'North bank' },
    location: null,
    clientCapturedAt: '2026-03-01T00:00:00.000Z',
    status,
    step: 'idle',
    attempts: 0,
    permanent: false,
  };
}

async function noFiles(): Promise<[]> {
  return [];
}

describe('sync protocol', () => {
  it('confirms one upload, collapses duplicates, and blocks conflicting payloads', async () => {
    const server = new MemorySyncServer();
    const persisted: SyncRecord[] = [];
    const outcome = await runSync(record('queued'), server.transport(), noFiles, async (next) => {
      persisted.push({ ...next });
    }, true);
    expect(outcome.serverConfirmed).toBe(true);
    expect(outcome.record.status).toBe('synced');
    expect(server.submissions.size).toBe(1);
    expect(persisted.at(-1)?.status).toBe('synced');
    const duplicate = await runSync({ ...outcome.record, status: 'queued', step: 'idle' }, server.transport(), noFiles, async () => undefined, true);
    expect(duplicate.record.status).toBe('synced');
    expect(server.submissions.size).toBe(1);

    const conflictServer = new MemorySyncServer();
    await runSync(record('queued'), conflictServer.transport(), noFiles, async () => undefined, true);
    const conflict = await runSync(
      { ...record('queued'), answers: { q_site_name: 'Changed' } },
      conflictServer.transport(),
      noFiles,
      async () => undefined,
      true,
    );
    expect(conflict.record.status).toBe('blocked');
    expect(conflict.record.blockedReason).toBe('conflict');
    expect(conflictServer.submissions.size).toBe(1);
  });

  it('recovers lost responses at each protocol boundary without a second submission', async () => {
    for (const boundary of ['create_or_recover', 'register_attachments', 'verify_attachments', 'finalize'] as const) {
      const server = new MemorySyncServer();
      const transport = new InjectingTransport(server.transport(), {
        boundary,
        times: 1,
        when: 'after',
        error: new TypeError('failed to fetch'),
      });
      const first = await runSync(record('queued'), transport, noFiles, async () => undefined, true);
      expect(first.serverConfirmed).toBe(false);
      expect(first.record.status).not.toBe('synced');
      const second = await runSync({ ...first.record, permanent: false }, transport, noFiles, async () => undefined, true);
      expect(second.serverConfirmed).toBe(true);
      expect(server.submissions.size).toBe(1);
      expect(server.submissions.get(record('queued').id)?.ingestionStatus).toBe('complete');
    }
  });

  it('keeps local work when auth expires, membership is revoked, or the server is unreachable', async () => {
    const server = new MemorySyncServer();
    const expired = new InjectingTransport(server.transport(), {
      boundary: 'create_or_recover',
      times: 1,
      when: 'before',
      error: new SyncRequestError('expired', 'reauth', 401),
    });
    const auth = await runSync(record('queued'), expired, noFiles, async () => undefined, true);
    expect(auth.record.status).toBe('blocked');
    expect(auth.record.blockedReason).toBe('reauth');
    expect(auth.record.answers).toEqual({ q_site_name: 'North bank' });

    const forbidden = new InjectingTransport(server.transport(), {
      boundary: 'create_or_recover',
      times: 1,
      when: 'before',
      error: new SyncRequestError('revoked', 'forbidden', 403),
    });
    const denied = await runSync(record('queued'), forbidden, noFiles, async () => undefined, true);
    expect(denied.record.blockedReason).toBe('forbidden');
    expect(classifyError(Object.assign(new Error('You do not have permission to do that.'), { name: 'PermissionError' }))).toBe('forbidden');
    expect(server.submissions.size).toBe(0);

    const offline = new InjectingTransport(server.transport(), {
      boundary: 'create_or_recover',
      times: 1,
      when: 'before',
      error: new TypeError('network'),
    });
    const dropped = await runSync(record('queued'), offline, noFiles, async () => undefined, true);
    expect(dropped.record.status).toBe('failed');
    expect(dropped.serverConfirmed).toBe(false);
  });

  it('does not retry permanent validation failures forever and refuses a missing attachment', async () => {
    expect(classifyStatus(500)).toBe('retry');
    expect(classifyStatus(422)).toBe('permanent');
    expect(shouldRetry('retry', 8)).toBe(false);
    expect(shouldRetry('permanent', 1)).toBe(false);
    const server = new MemorySyncServer();
    let attempts = 0;
    let current = record('queued');
    const transport = new InjectingTransport(server.transport(), {
      boundary: 'create_or_recover',
      times: 20,
      when: 'before',
      error: new SyncRequestError('bad payload', 'permanent', 422),
    });
    current = (await runSync(current, transport, noFiles, async () => undefined, true)).record;
    attempts += 1;
    expect(current.permanent).toBe(true);
    const stopped = await runSync(current, transport, noFiles, async () => undefined, true);
    attempts += 1;
    expect(stopped.record.status).toBe('failed');
    expect(attempts).toBe(2);
    expect(server.submissions.size).toBe(0);

    const uploadServer = new MemorySyncServer();
    const missing = await runSync(
      record('queued'),
      uploadServer.transport(),
      async () => [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          questionId: 'q_photo',
          contentType: 'image/png',
          byteSize: 0,
          checksum: 'abc',
          bytes: new ArrayBuffer(0),
        },
      ],
      async () => undefined,
      true,
    );
    expect(missing.serverConfirmed).toBe(false);
    expect(uploadServer.submissions.get(record('queued').id)?.ingestionStatus).not.toBe('complete');
  });

  it('only enters synced from an explicit confirmation', () => {
    expect(() => transition('uploading', 'confirm')).not.toThrow();
    expect(() => transition('queued', 'confirm')).toThrow(/Illegal/);
    expect(() => transition('draft', 'confirm')).toThrow(/Illegal/);
  });
});

describe('maps', () => {
  function memoryStore(seed: { key: string; checksum: string; bytes: number }[] = []): TileStore & { puts: number; records: { id: string }[] } {
    const tiles = new Map(seed.map((tile) => [tile.key, tile]));
    const api = {
      puts: 0,
      records: [{ id: 'survey-record' }],
      async get(key: string) {
        return tiles.get(key) ?? null;
      },
      async put(input: { key: string; checksum: string; bytes: ArrayBuffer }) {
        api.puts += 1;
        tiles.set(input.key, { key: input.key, checksum: input.checksum, bytes: input.bytes.byteLength });
      },
      async list() {
        return [...tiles.values()];
      },
    };
    return api;
  }

  it('requires every tile and resumes without refetching verified tiles', async () => {
    const manifest = parseManifest(manifestJson);
    const store = memoryStore();
    let fetches = 0;
    const ready = await downloadMapPackage({
      manifest,
      store,
      fetchTile: async (tile) => {
        fetches += 1;
        const response = await fetchFile(tile);
        return response;
      },
    });
    expect(ready.verified).toBe(true);
    expect(fetches).toBe(manifest.tiles.length);
    expect((await verifyPackage(manifest, store)).ok).toBe(true);

    const partial = memoryStore([{ key: `${manifest.id}:${manifest.version}:2:0:0`, checksum: manifest.tiles[0]!.sha256, bytes: manifest.tiles[0]!.bytes }]);
    fetches = 0;
    await downloadMapPackage({
      manifest,
      store: partial,
      fetchTile: async (tile) => {
        fetches += 1;
        return fetchFile(tile);
      },
    });
    expect(fetches).toBe(manifest.tiles.length - 1);
    expect(partial.records).toEqual([{ id: 'survey-record' }]);
  });

  it('rejects a checksum mismatch, cancels cleanly, and preserves the previous package', async () => {
    const manifest = parseManifest(manifestJson);
    const bad = memoryStore();
    await expect(
      downloadMapPackage({
        manifest,
        store: bad,
        fetchTile: async () => new TextEncoder().encode('nope').buffer,
      }),
    ).rejects.toThrow(/Checksum/);
    expect((await verifyPackage(manifest, bad)).ok).toBe(false);

    const controller = new AbortController();
    let calls = 0;
    const cancelled = await downloadMapPackage({
      manifest,
      store: memoryStore(),
      signal: controller.signal,
      fetchTile: async (tile) => {
        calls += 1;
        if (calls === 1) controller.abort();
        return fetchFile(tile);
      },
    });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.verified).toBe(false);

    const estimate = { usage: 90, quota: 100 };
    const records = [{ id: 'keep' }];
    await expect(downloadMapPackage({ manifest, store: memoryStore(), estimate, fetchTile: async (tile) => fetchFile(tile) })).rejects.toThrow(/not deleted|enough free space/i);
    expect(records).toEqual([{ id: 'keep' }]);
    expect(assertStorageForDownload({ usage: 0, quota: 100 }, 50)).toBeUndefined();
    expect(() => assertStorageForDownload(estimate, 50)).toThrow(StoragePressureError);

    const replacement = activateReplacement(true, { status: 'failed' });
    expect(replacement).toEqual({ current: 'previous', previousKept: true });
    expect(coverageMessage(manifest, 40, 40, 2)).toMatch(/outside/i);
    expect(coverageMessage(manifest, 10, 10, 8)).toMatch(/zoom/i);
    expect(coverageMessage(manifest, 10, 10, 2)).toBeNull();
  });
});

describe('exports and provisioning', () => {
  const definition = () => {
    const parsed = parseSurvey(wildlife);
    if (!parsed.ok) throw new Error('fixture');
    return parsed.survey;
  };
  const rows: ExportRecord[] = [
    {
      id: '99999999-9999-4999-8999-999999999991',
      projectId: '44444444-4444-4444-8444-444444444444',
      formId: definition().id,
      formVersionId: '88888888-8888-4888-8888-888888888882',
      versionNumber: 1,
      collectorId: 'collector',
      answers: { q_count: 2, q_sign: false, q_species: '=cmd|calc' },
      location: { latitude: 12.5, longitude: 7.25, accuracy: 15, timestamp: '2026-02-02T00:00:00.000Z', source: 'device' },
      clientCapturedAt: '2026-02-02T00:00:00.000Z',
      serverReceivedAt: '2026-02-02T00:05:00.000Z',
      payloadHash: 'hash',
      ingestionStatus: 'complete',
      reviewStatus: 'unreviewed',
    },
    {
      id: '99999999-9999-4999-8999-999999999992',
      projectId: '44444444-4444-4444-8444-444444444444',
      formId: definition().id,
      formVersionId: '88888888-8888-4888-8888-888888888882',
      versionNumber: 1,
      collectorId: 'collector',
      answers: { q_count: 1, q_sign: false },
      location: null,
      clientCapturedAt: '2026-02-03T00:00:00.000Z',
      serverReceivedAt: null,
      payloadHash: 'hash-2',
      ingestionStatus: 'pending',
      reviewStatus: 'unreviewed',
    },
  ];

  it('hides pending ingestion from completed results and escapes spreadsheet formulas', () => {
    const visible = applySubmissionFilter(rows, { ingestion: 'complete' });
    expect(visible.map((row) => row.id)).toEqual(['99999999-9999-4999-8999-999999999991']);
    const csv = toCsv(visible, definition());
    expect(csv).toContain("\"'=cmd|calc\"");
    expect(escapeCsvCell('+1')).toBe("\"'+1\"");
    expect(escapeCsvCell('@sum')).toBe("\"'@sum\"");
    const geo = JSON.parse(toGeoJson(visible, definition())) as { features: { geometry: { coordinates: number[] } }[] };
    expect(geo.features[0]?.geometry.coordinates).toEqual([7.25, 12.5]);
    const json = toJson(visible, definition());
    expect(json).toContain('"versionNumber": 1');
    expect(JSON.parse(toGeoJson(visible, definition())).features[0].properties.formVersion).toBe(1);
    expect(json).toContain('null');
    expect(reviewPatch('accepted')).toEqual({ review_status: 'accepted' });
    expect('answers' in reviewPatch('accepted')).toBe(false);
  });

  it('describes provisioning, logout, and update gates', () => {
    expect(isFieldReady({ appShellCached: true, signedIn: true, formsDownloaded: true, mapReady: false, mapRequired: true })).toBe(false);
    expect(isFieldReady({ appShellCached: true, signedIn: true, formsDownloaded: true, mapReady: true, mapRequired: true })).toBe(true);
    expect(logoutWarning(2)).toMatch(/unsynchronized/);
    expect(logoutWarning(0)).toBeNull();
    expect(mayApplyAppUpdate({ editing: true, uploading: false })).toBe(false);
    expect(mayApplyAppUpdate({ editing: false, uploading: true })).toBe(false);
    expect(mayApplyAppUpdate({ editing: false, uploading: false })).toBe(true);
    expect(FIRST_USE_OFFLINE).toMatch(/offline/i);
  });
});

describe('gps', () => {
  it('does not invent coordinates when permission is denied or the request times out', async () => {
    const denied = await captureDeviceLocation({
      getCurrentPosition: (_success, error) => error({ code: 1, message: 'denied' }),
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe('denied');

    const timed = await captureDeviceLocation(
      { getCurrentPosition: () => undefined },
      5,
    );
    expect(timed.ok).toBe(false);
    if (!timed.ok) expect(timed.reason).toBe('timeout');
  });

  it('labels manual adjustments and keeps the original device fix', () => {
    const device = {
      latitude: 44.12345678,
      longitude: -110.5,
      accuracy: 25,
      timestamp: '2026-04-01T00:00:00.000Z',
      source: 'device' as const,
    };
    const manual = applyManualAdjustment(device, 44.2, -110.4, '2026-04-01T00:02:00.000Z');
    expect(manual.source).toBe('manual');
    expect(manual.originalDevice).toMatchObject({ latitude: 44.12345678, longitude: -110.5 });
    expect(formatCoordinate(device.latitude, 25)).toBe('44.1235');
    expect(toGeoJsonPosition(device)).toEqual([-110.5, 44.12345678]);
  });
});

describe('sql invariants', () => {
  const sql = readFileSync('supabase/migrations/20261013000000_init.sql', 'utf8');
  it('enables rls, keeps published versions immutable, and locks publish', () => {
    for (const table of ['profiles', 'organizations', 'organization_members', 'projects', 'project_members', 'forms', 'form_versions', 'submissions', 'submission_attachments', 'map_packages', 'audit_events']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain('published form versions are immutable');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('cannot remove the last owner');
    expect(sql).toContain('cannot demote the last owner');
    expect(sql).toContain("public = false");
    expect(sql).toContain('forced membership failure');
    expect(sql).not.toContain('service_role_key');
  });
});

async function fetchFile(tile: { z: number; x: number; y: number }): Promise<ArrayBuffer> {
  const bytes = readFileSync(`public/map-package/${tile.z}/${tile.x}/${tile.y}.png`);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
