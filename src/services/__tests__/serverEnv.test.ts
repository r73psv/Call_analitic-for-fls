import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import {
  loadServerEnvironment,
  persistServerEnvVars,
  hydrateStoreFromServerEnv,
  mergeEnvFileContent,
  formatEnvValue,
  resetServerEnvStateForTests,
} from '../serverEnv.js';

function withTempEnvDir(fn: (dir: string) => void | Promise<void>) {
  return async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'callqa-env-test-'));
    const savedEnv: Record<string, string | undefined> = {};
    const touchedKeys = [
      'GIGACHAT_AUTH_KEY',
      'GIGACHAT_CREDENTIALS',
      'YC_API_KEY',
      'YC_FOLDER_ID',
      'YC_SERVICE_ACCOUNT_KEY_JSON',
      'TBANK_VOICEKIT_API_KEY',
      'TBANK_VOICEKIT_SECRET_KEY',
      'GIGAAM_API_KEY',
      'MEGAFON_TOKEN',
      'VK_TOKEN',
      'YCLIENTS_USER_TOKEN',
      'S3_ACCESS_KEY',
      'SALON_NAME',
      'NODE_OPTIONS',
      'PATH',
    ];
    for (const k of touchedKeys) {
      savedEnv[k] = process.env[k];
    }
    try {
      resetServerEnvStateForTests();
      await fn(tmpDir);
    } finally {
      for (const k of touchedKeys) {
        if (savedEnv[k] === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = savedEnv[k];
        }
      }
      resetServerEnvStateForTests();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}

test(
  'loadServerEnvironment pulls deployment env vars, fills empty Dockerfile stubs from .env, and restores runtime overrides',
  withTempEnvDir((tmpDir) => {
    const rootEnv = path.join(tmpDir, 'root.env');
    const runtimeEnv = path.join(tmpDir, 'data.env');

    // Simulate Docker container: deployment server set GIGACHAT_AUTH_KEY, while YC_API_KEY is empty stub ""
    process.env.GIGACHAT_AUTH_KEY = 'deploy-giga-key';
    delete process.env.GIGACHAT_CREDENTIALS;
    process.env.YC_API_KEY = '';
    process.env.TBANK_VOICEKIT_API_KEY = '';

    fs.writeFileSync(rootEnv, 'YC_API_KEY=root-yc-key\nGIGACHAT_AUTH_KEY=root-should-not-override\n', 'utf-8');
    fs.writeFileSync(runtimeEnv, 'TBANK_VOICEKIT_API_KEY=runtime-tbank-key\n', 'utf-8');

    const loaded = loadServerEnvironment({
      primaryEnvPath: runtimeEnv,
      workspaceEnvPath: rootEnv,
      forceReload: true,
      silent: true,
    });

    assert.equal(process.env.GIGACHAT_AUTH_KEY, 'deploy-giga-key');
    assert.equal(process.env.GIGACHAT_CREDENTIALS, 'deploy-giga-key');
    assert.equal(process.env.YC_API_KEY, 'root-yc-key');
    assert.equal(process.env.TBANK_VOICEKIT_API_KEY, 'runtime-tbank-key');
    assert.ok(loaded.loadedFromDeployEnv.includes('GIGACHAT_AUTH_KEY'));
    assert.ok(loaded.loadedFromRootFile.includes('YC_API_KEY'));
    assert.ok(loaded.loadedFromRuntimeFile.includes('TBANK_VOICEKIT_API_KEY'));
  })
);

test(
  'persistServerEnvVars updates process.env, persists safely to server .env, blocks unmanaged vars, and survives restart',
  withTempEnvDir((tmpDir) => {
    const runtimeEnv = path.join(tmpDir, 'server-runtime.env');
    const workspaceEnv = path.join(tmpDir, 'workspace.env');

    fs.writeFileSync(
      runtimeEnv,
      '# Custom deployment comment\nUNRELATED_DEPLOY_VAR=keep_me\nYC_API_KEY=old_key\n',
      'utf-8'
    );

    const multilineJsonKey = JSON.stringify({
      id: 'key-1',
      service_account_id: 'sa-1',
      private_key: '-----BEGIN PRIVATE KEY-----\nLINE1\nLINE2\n-----END PRIVATE KEY-----',
    });

    const originalPath = process.env.PATH;
    const res = persistServerEnvVars(
      {
        YC_API_KEY: 'AQVN-new-secret-key',
        GIGACHAT_AUTH_KEY: 'new-giga-secret',
        YC_SERVICE_ACCOUNT_KEY_JSON: multilineJsonKey,
        // Attempted injection of non-managed system var must be ignored
        NODE_OPTIONS: '--require=/tmp/evil.js',
        PATH: '/tmp/evil',
      },
      {
        primaryEnvPath: runtimeEnv,
        workspaceEnvPath: workspaceEnv,
        mirrorToWorkspace: false,
        silent: true,
      }
    );

    assert.ok(res.savedKeys.includes('YC_API_KEY'));
    assert.ok(res.savedKeys.includes('GIGACHAT_AUTH_KEY'));
    assert.ok(res.savedKeys.includes('GIGACHAT_CREDENTIALS'));
    assert.ok(res.savedKeys.includes('YC_SERVICE_ACCOUNT_KEY_JSON'));
    assert.equal(res.savedKeys.includes('NODE_OPTIONS'), false);
    assert.equal(res.savedKeys.includes('PATH'), false);
    assert.equal(process.env.PATH, originalPath);
    assert.equal(process.env.YC_API_KEY, 'AQVN-new-secret-key');
    assert.equal(process.env.GIGACHAT_CREDENTIALS, 'new-giga-secret');

    // Verify file preserves unrelated vars/comments and parses back cleanly via dotenv
    const fileRaw = fs.readFileSync(runtimeEnv, 'utf-8');
    assert.match(fileRaw, /# Custom deployment comment/);
    assert.match(fileRaw, /UNRELATED_DEPLOY_VAR=keep_me/);
    const parsed = dotenv.parse(fileRaw);
    assert.equal(parsed.YC_API_KEY, 'AQVN-new-secret-key');
    assert.equal(parsed.GIGACHAT_AUTH_KEY, 'new-giga-secret');
    assert.equal(parsed.YC_SERVICE_ACCOUNT_KEY_JSON, multilineJsonKey);

    // Simulate process restart with empty Dockerfile stubs
    process.env.YC_API_KEY = '';
    process.env.GIGACHAT_AUTH_KEY = '';
    process.env.YC_SERVICE_ACCOUNT_KEY_JSON = '';
    loadServerEnvironment({
      primaryEnvPath: runtimeEnv,
      workspaceEnvPath: workspaceEnv,
      forceReload: true,
      silent: true,
    });

    assert.equal(process.env.YC_API_KEY, 'AQVN-new-secret-key');
    assert.equal(process.env.GIGACHAT_AUTH_KEY, 'new-giga-secret');
    assert.equal(process.env.YC_SERVICE_ACCOUNT_KEY_JSON, multilineJsonKey);
  })
);

test(
  'hydrateStoreFromServerEnv pulls server env secrets over stale/placeholder store config',
  withTempEnvDir(() => {
    process.env.GIGACHAT_AUTH_KEY = 'env-giga-key';
    process.env.MEGAFON_TOKEN = 'env-megafon-token';
    process.env.VK_TOKEN = 'env-vk-token';
    process.env.YCLIENTS_USER_TOKEN = 'env-yclients-token';
    process.env.TBANK_VOICEKIT_API_KEY = 'env-tbank-key';
    process.env.GIGAAM_API_KEY = 'env-gigaam-key';

    const db: any = {
      calls: [],
      logs: [],
      config: {
        activeModel: 'GigaChat:Lite',
        default_gigachat_model: 'GigaChat:Lite',
        megafon: {
          token: 'megafon_ats_auth_token_example_123',
          webhookUrl: '/api/calls/webhook',
          autoImport: false,
          active: false,
          pollingEnabled: false,
          pollingIntervalMinutes: 5,
        },
        vk: {
          token: 'vk_group_api_token_example_xyz',
          chatId: '',
          enabled: false,
          template: '',
        },
        yclients: {
          userToken: 'yclients_user_token_example_777',
          partnerToken: 'yclients_partner_token_example_888',
          salonId: '',
          enabled: false,
        },
        credentials: {
          gigachatAuthKey: '<ключ-авторизации-GigaChat>',
        },
      },
    };

    const res = hydrateStoreFromServerEnv(db, { persistLegacyMigration: false, silent: true });

    assert.equal(db.config.credentials.gigachatAuthKey, 'env-giga-key');
    assert.equal(db.config.megafon.token, 'env-megafon-token');
    assert.equal(db.config.vk.token, 'env-vk-token');
    assert.equal(db.config.yclients.userToken, 'env-yclients-token');
    assert.equal(db.config.yclients.partnerToken, ''); // placeholder scrubbed
    assert.equal(db.config.credentials.tbankApiKey, 'env-tbank-key');
    assert.equal(db.config.credentials.gigaamApiKey, 'env-gigaam-key');
    assert.ok(res.hydratedFromEnv.includes('GIGACHAT_AUTH_KEY'));
    assert.ok(res.hydratedFromEnv.includes('MEGAFON_TOKEN'));
  })
);

test('formatEnvValue & mergeEnvFileContent prevent newline injection', () => {
  const malicious = 'abc\nNODE_OPTIONS=--eval=evil';
  const encoded = formatEnvValue(malicious);
  assert.equal(encoded.includes('\n'), false);

  const merged = mergeEnvFileContent('', { YC_API_KEY: malicious });
  const parsed = dotenv.parse(merged);
  assert.equal(parsed.YC_API_KEY, malicious);
  assert.equal(parsed.NODE_OPTIONS, undefined);
});
