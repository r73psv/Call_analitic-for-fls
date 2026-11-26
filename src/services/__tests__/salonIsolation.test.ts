import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import {
  validateWcgpWebhookOrigin,
  validateCallBelongsToSalon,
  validateS3SnapshotForSalon,
  resolveSalonS3KeyPrefix,
  isSafeWcgpHost,
  normalizeSalonScope,
  normalizeSalonId,
  resolveEffectiveSalonId,
  resolveAuthorizedSalonId,
} from '../salonIsolation.js';
import {
  loadServerEnvironment,
  resetServerEnvStateForTests,
} from '../serverEnv.js';

test('validateWcgpWebhookOrigin blocks missing/invalid crm_token and unconfigured WCGP (no empty-token bypass)', () => {
  // Missing crm_token MUST be rejected when crm_token is configured
  const missingToken = validateWcgpWebhookOrigin({
    cmd: 'history',
    incomingCrmToken: '',
    incomingRecordUrl: 'https://vats111111.megapbx.ru/rec/1.mp3',
    expectedCrmToken: 'secret-salon-token',
    expectedRestDomain: 'vats111111.megapbx.ru',
  });
  assert.equal(missingToken.allowed, false);
  assert.equal(missingToken.httpStatus, 401);
  assert.equal(missingToken.reason, 'missing_crm_token');

  // Wrong crm_token rejected
  const wrongToken = validateWcgpWebhookOrigin({
    cmd: 'history',
    incomingCrmToken: 'wrong-token',
    incomingRecordUrl: 'https://vats111111.megapbx.ru/rec/1.mp3',
    expectedCrmToken: 'secret-salon-token',
    expectedRestDomain: 'vats111111.megapbx.ru',
  });
  assert.equal(wrongToken.allowed, false);
  assert.equal(wrongToken.httpStatus, 401);
  assert.equal(wrongToken.reason, 'invalid_crm_token');

  // Unconfigured WCGP (neither crm_token nor restDomain) MUST reject incoming WCGP webhooks
  const unconfigured = validateWcgpWebhookOrigin({
    cmd: 'history',
    incomingCrmToken: '',
    incomingRecordUrl: 'https://vats222222.megapbx.ru/rec/2.mp3',
    expectedCrmToken: '',
    expectedRestDomain: '',
  });
  assert.equal(unconfigured.allowed, false);
  assert.equal(unconfigured.httpStatus, 401);
  assert.equal(unconfigured.reason, 'wcgp_not_configured');
});

test('validateWcgpWebhookOrigin rejects foreign salon VATS host even with valid crm_token and accepts matching salon', () => {
  // Foreign VATS recording link rejected with 403
  const foreign = validateWcgpWebhookOrigin({
    cmd: 'history',
    incomingCrmToken: 'secret-salon-token',
    incomingRecordUrl: 'https://vats222222.megapbx.ru/records/call-foreign.mp3',
    expectedCrmToken: 'secret-salon-token',
    expectedRestDomain: 'https://vats111111.megapbx.ru/crmapi/v1',
  });
  assert.equal(foreign.allowed, false);
  assert.equal(foreign.httpStatus, 403);
  assert.equal(foreign.reason, 'vats_domain_mismatch');
  assert.equal(foreign.detectedVatsHost, 'vats222222.megapbx.ru');

  // Matching VATS domain and crm_token allowed
  const matching = validateWcgpWebhookOrigin({
    cmd: 'history',
    incomingCrmToken: 'secret-salon-token',
    incomingRecordUrl: 'https://vats111111.megapbx.ru/records/call-own.mp3',
    expectedCrmToken: 'secret-salon-token',
    expectedRestDomain: 'https://vats111111.megapbx.ru/crmapi/v1',
  });
  assert.equal(matching.allowed, true);
  assert.equal(matching.reason, 'ok');
  assert.equal(matching.detectedVatsHost, 'vats111111.megapbx.ru');
});

test('validateCallBelongsToSalon filters out foreign salon calls by VATS host, numeric VATS ID, or salon scope', () => {
  const liq28Ctx = {
    salonName: 'Лик 28',
    apiVersion: 'rest_wcgp',
    restDomain: 'vats111111.megapbx.ru',
    vatsId: '111111',
  };

  // Foreign megapbx audio_url rejected
  const foreignByUrl = validateCallBelongsToSalon(
    {
      audio_url: 'https://vats222222.megapbx.ru/sys/record/abc.mp3',
    },
    liq28Ctx
  );
  assert.equal(foreignByUrl.belongs, false);
  assert.equal(foreignByUrl.reason, 'foreign_record_host');

  // Foreign vats_domain rejected
  const foreignByDomain = validateCallBelongsToSalon(
    {
      vats_domain: 'vats222222.megapbx.ru',
    },
    liq28Ctx
  );
  assert.equal(foreignByDomain.belongs, false);
  assert.equal(foreignByDomain.reason, 'foreign_vats_domain');

  // Foreign salon_scope rejected
  const foreignByScope = validateCallBelongsToSalon(
    {
      salon_scope: 'fashion-look-studio',
    },
    liq28Ctx
  );
  assert.equal(foreignByScope.belongs, false);
  assert.equal(foreignByScope.reason, 'foreign_salon_scope');

  // Same salon (LIQ28 == Лик 28) & matching VATS allowed
  assert.equal(normalizeSalonScope('LIQ28'), 'liq28');
  assert.equal(normalizeSalonScope('Лик 28'), 'liq28');
  const ownCall = validateCallBelongsToSalon(
    {
      vats_domain: 'vats111111.megapbx.ru',
      audio_url: 'https://vats111111.megapbx.ru/sys/record/own.mp3',
      salon_scope: 'LIQ28',
    },
    liq28Ctx
  );
  assert.equal(ownCall.belongs, true);
});

test('validateS3SnapshotForSalon and resolveSalonS3KeyPrefix prevent cross-salon S3 backup contamination', () => {
  const crossVats = validateS3SnapshotForSalon(
    {
      config: {
        salonName: 'Fashion Look Studio',
        megafon: { restDomain: 'https://vats222222.megapbx.ru/crmapi/v1' },
      },
    },
    {
      envSalonName: 'LIQ28',
      envRestDomain: 'https://vats111111.megapbx.ru/crmapi/v1',
    }
  );
  assert.equal(crossVats.allowed, false);
  assert.equal(crossVats.reason, 's3_snapshot_foreign_vats');

  const crossSalon = validateS3SnapshotForSalon(
    {
      config: {
        salonName: 'Fashion Look Studio',
      },
    },
    {
      envSalonName: 'LIQ28',
    }
  );
  assert.equal(crossSalon.allowed, false);
  assert.equal(crossSalon.reason, 's3_snapshot_foreign_salon');

  const sameSalon = validateS3SnapshotForSalon(
    {
      config: {
        salonName: 'Лик 28',
        megafon: { restDomain: 'vats111111.megapbx.ru' },
      },
    },
    {
      envSalonName: 'LIQ28',
      envRestDomain: 'https://vats111111.megapbx.ru/crmapi/v1',
    }
  );
  assert.equal(sameSalon.allowed, true);

  // Per-salon derived prefixes never collide when S3_KEY_PREFIX is omitted
  const prefixA = resolveSalonS3KeyPrefix({ salonName: 'LIQ28', restDomain: 'vats111111.megapbx.ru' });
  const prefixB = resolveSalonS3KeyPrefix({ salonName: 'Fashion Look Studio', restDomain: 'vats222222.megapbx.ru' });
  assert.notEqual(prefixA, prefixB);
  assert.equal(prefixA, 'salons/liq28-vats111111/data/');
  assert.equal(prefixB, 'salons/fashion-look-studio-vats222222/data/');
});

test('isSafeWcgpHost rejects loopback/IP/internal targets and accepts valid megapbx hostnames', () => {
  assert.equal(isSafeWcgpHost('https://vats111111.megapbx.ru/crmapi/v1'), true);
  assert.equal(isSafeWcgpHost('localhost'), false);
  assert.equal(isSafeWcgpHost('http://127.0.0.1:8080/sys/crm_api.wcgp'), false);
  assert.equal(isSafeWcgpHost('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isSafeWcgpHost('internal.local'), false);
});

test('loadServerEnvironment protects explicit deploy_env salon/ATS isolation keys from stale runtime .env', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'callqa-isolation-env-'));
  const saved: Record<string, string | undefined> = {
    SALON_NAME: process.env.SALON_NAME,
    MEGAFON_REST_DOMAIN: process.env.MEGAFON_REST_DOMAIN,
    MEGAFON_REST_TOKEN: process.env.MEGAFON_REST_TOKEN,
    MEGAFON_CRM_TOKEN: process.env.MEGAFON_CRM_TOKEN,
    S3_KEY_PREFIX: process.env.S3_KEY_PREFIX,
  };

  try {
    resetServerEnvStateForTests();
    const rootEnv = path.join(tmpDir, 'root.env');
    const runtimeEnv = path.join(tmpDir, 'data.env');

    process.env.SALON_NAME = 'LIQ28';
    process.env.MEGAFON_REST_DOMAIN = 'https://vats111111.megapbx.ru/crmapi/v1';
    process.env.MEGAFON_REST_TOKEN = 'liq28-rest-token';
    process.env.MEGAFON_CRM_TOKEN = 'liq28-crm-token';
    process.env.S3_KEY_PREFIX = 'liq28/data/';

    fs.writeFileSync(rootEnv, '', 'utf-8');
    fs.writeFileSync(
      runtimeEnv,
      [
        'SALON_NAME=OtherSalon',
        'MEGAFON_REST_DOMAIN=https://vats222222.megapbx.ru/crmapi/v1',
        'MEGAFON_REST_TOKEN=other-salon-token',
        'MEGAFON_CRM_TOKEN=other-salon-crm-token',
        'S3_KEY_PREFIX=other-salon/data/',
      ].join('\n') + '\n',
      'utf-8'
    );

    loadServerEnvironment({
      primaryEnvPath: runtimeEnv,
      workspaceEnvPath: rootEnv,
      forceReload: true,
      silent: true,
    });

    assert.equal(process.env.SALON_NAME, 'LIQ28');
    assert.equal(process.env.MEGAFON_REST_DOMAIN, 'https://vats111111.megapbx.ru/crmapi/v1');
    assert.equal(process.env.MEGAFON_REST_TOKEN, 'liq28-rest-token');
    assert.equal(process.env.MEGAFON_CRM_TOKEN, 'liq28-crm-token');
    assert.equal(process.env.S3_KEY_PREFIX, 'liq28/data/');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetServerEnvStateForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveEffectiveSalonId, validateCallBelongsToSalon(salon_id), and resolveAuthorizedSalonId enforce strict tenant isolation', () => {
  assert.equal(normalizeSalonId('LIQ28'), 'liq28');
  assert.equal(normalizeSalonId('Лик 28'), 'liq28');

  assert.equal(
    resolveEffectiveSalonId({ envSalonId: 'LIQ-28', salonName: 'Other Name' }),
    'liq28'
  );
  assert.equal(
    resolveEffectiveSalonId({ salonName: 'Лик 28', restDomain: 'vats111111.megapbx.ru' }),
    'liq28'
  );
  assert.equal(
    resolveEffectiveSalonId({ salonName: 'Салон красоты', restDomain: 'vats936154.megapbx.ru' }),
    'vats936154'
  );
  assert.equal(
    resolveEffectiveSalonId({ salonName: '', yclientsSalonId: '543210' }),
    'yclients-543210'
  );

  // Foreign CallRecord.salon_id must be rejected even if audio_url is absent
  const foreignCall = validateCallBelongsToSalon(
    { salon_id: 'fashion-look-studio' },
    { salonId: 'liq28', salonName: 'Лик 28' }
  );
  assert.equal(foreignCall.belongs, false);
  assert.equal(foreignCall.reason, 'foreign_salon_id');

  // Matching CallRecord.salon_id passes
  const ownCall = validateCallBelongsToSalon(
    { salon_id: 'LIQ28' },
    { salonId: 'liq28', salonName: 'Лик 28' }
  );
  assert.equal(ownCall.belongs, true);

  // Server-side /api/calls salon_id authorization check
  const allowedMatching = resolveAuthorizedSalonId({
    userSalonId: 'liq28',
    requestedSalonId: 'LIQ28',
    instanceSalonId: 'liq28',
  });
  assert.equal(allowedMatching.allowed, true);
  assert.equal(allowedMatching.effectiveSalonId, 'liq28');

  // Omitted ?salon_id still enforces authenticated user's salon_id
  const allowedImplicit = resolveAuthorizedSalonId({
    userSalonId: 'liq28',
    requestedSalonId: '',
    instanceSalonId: 'liq28',
  });
  assert.equal(allowedImplicit.allowed, true);
  assert.equal(allowedImplicit.effectiveSalonId, 'liq28');

  // Spoofing another salon's salon_id in query/header MUST be rejected with 403
  const blockedCrossSalon = resolveAuthorizedSalonId({
    userSalonId: 'liq28',
    requestedSalonId: 'fashion-look-studio',
    instanceSalonId: 'liq28',
  });
  assert.equal(blockedCrossSalon.allowed, false);
  assert.equal(blockedCrossSalon.httpStatus, 403);
  assert.equal(blockedCrossSalon.effectiveSalonId, 'liq28');
});

