import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YCLIENTS_READ_ONLY,
  authenticateYclients,
  fetchYclientsMasters,
  testYclientsReadOnlyConnection,
  clearYclientsCache,
  isValidYclientsSalonId,
  normalizeYclientsStaffList,
} from '../yclients.js';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function makeJsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('YCLIENTS_READ_ONLY is enforced and authenticateYclients uses login/password + YCLIENTS_PARTNER_TOKEN', async () => {
  assert.equal(YCLIENTS_READ_ONLY, true);
  clearYclientsCache();

  const calls: RecordedRequest[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, headers, body });

    if (url === 'https://api.yclients.com/api/v1/auth' && method === 'POST') {
      return makeJsonResponse({
        success: true,
        data: { id: 101, user_token: 'utok_fresh_123' },
      });
    }
    if (url === 'https://api.yclients.com/api/v1/staff/987654' && method === 'GET') {
      return makeJsonResponse({
        success: true,
        data: [
          { id: 1, name: '  Кристина  ', specialization: 'Мастер маникюра', fired: 0, hidden: 0, bookable: true },
          { id: 2, name: 'Анна', specialization: 'Стилист', fired: 0, hidden: 0 },
          { id: 3, name: 'Уволенный Мастер', fired: 1, hidden: 0 },
          { id: 4, name: 'Скрытый Мастер', fired: 0, hidden: 1 },
          { id: 5, name: 'кристина', fired: 0, hidden: 0 }, // duplicate case-insensitive
        ],
      });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const masters = await fetchYclientsMasters({
    overrides: {
      login: '79001112233',
      password: 'secret-password',
      partnerToken: 'partner_tok_abc',
      salonId: '987654',
      enabled: true,
    },
    fetchFn: mockFetch,
  });

  assert.equal(calls.length, 2);
  // 1) Auth request: POST /api/v1/auth with login/password and Bearer partnerToken
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://api.yclients.com/api/v1/auth');
  assert.equal(calls[0].headers['authorization'], 'Bearer partner_tok_abc');
  assert.equal(calls[0].headers['accept'], 'application/vnd.yclients.v2+json');
  assert.deepEqual(JSON.parse(calls[0].body || '{}'), {
    login: '79001112233',
    password: 'secret-password',
  });

  // 2) Staff read request: GET /api/v1/staff/{salonId} with Bearer partnerToken, User userToken
  assert.equal(calls[1].method, 'GET');
  assert.equal(calls[1].url, 'https://api.yclients.com/api/v1/staff/987654');
  assert.equal(calls[1].headers['authorization'], 'Bearer partner_tok_abc, User utok_fresh_123');
  assert.equal(calls[1].headers['accept'], 'application/vnd.yclients.v2+json');

  // Verify only active, non-hidden, deduplicated masters are returned
  assert.deepEqual(
    masters.map((m) => m.name),
    ['Кристина', 'Анна']
  );
  assert.equal(masters[0].specialization, 'Мастер маникюра');

  // Second call should hit cache without any extra network calls
  const mastersCached = await fetchYclientsMasters({
    overrides: {
      login: '79001112233',
      password: 'secret-password',
      partnerToken: 'partner_tok_abc',
      salonId: '987654',
      enabled: true,
    },
    fetchFn: mockFetch,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(mastersCached, masters);
});

test('fetchYclientsMasters automatically re-authenticates once on HTTP 401 and retries read-only GET', async () => {
  clearYclientsCache();

  let authCalls = 0;
  let staffCalls = 0;
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());

    if (url.endsWith('/auth') && method === 'POST') {
      authCalls++;
      return makeJsonResponse({
        success: true,
        data: { user_token: authCalls === 1 ? 'expired_token' : 'renewed_token' },
      });
    }

    if (url.endsWith('/staff/555111') && method === 'GET') {
      staffCalls++;
      if (headers['authorization'] === 'Bearer p_tok, User expired_token') {
        return makeJsonResponse({ success: false, meta: { message: 'Token expired' } }, 401);
      }
      if (headers['authorization'] === 'Bearer p_tok, User renewed_token') {
        return makeJsonResponse({
          success: true,
          data: [{ id: 10, name: 'Мария', fired: 0, hidden: 0 }],
        });
      }
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const masters = await fetchYclientsMasters({
    overrides: {
      login: 'manager@salon.ru',
      password: 'pw',
      partnerToken: 'p_tok',
      salonId: '555111',
      enabled: true,
    },
    fetchFn: mockFetch,
  });

  assert.equal(authCalls, 2);
  assert.equal(staffCalls, 2);
  assert.deepEqual(
    masters.map((m) => m.name),
    ['Мария']
  );
});

test('validation rejects missing login/password, missing YCLIENTS_PARTNER_TOKEN, and non-numeric salonId', async () => {
  clearYclientsCache();

  assert.equal(isValidYclientsSalonId('987654'), true);
  assert.equal(isValidYclientsSalonId('987654/../comments'), false);
  assert.equal(isValidYclientsSalonId('abc'), false);

  await assert.rejects(
    () => authenticateYclients({ login: '', password: 'pw', partnerToken: 'ptok' }),
    /логин и пароль/i
  );

  await assert.rejects(
    () => authenticateYclients({ login: 'user', password: 'pw', partnerToken: '' }),
    /YCLIENTS_PARTNER_TOKEN/
  );

  const badSalonRes = await testYclientsReadOnlyConnection({
    login: 'user',
    password: 'pw',
    partnerToken: 'ptok',
    salonId: '123/../../comments',
  });
  assert.equal(badSalonRes.success, false);
  assert.equal(badSalonRes.readOnly, true);
  assert.match(badSalonRes.error || '', /только цифры/i);

  const missingPartnerRes = await testYclientsReadOnlyConnection({
    login: 'user',
    password: 'pw',
    partnerToken: '',
    salonId: '123456',
  });
  assert.equal(missingPartnerRes.success, false);
  assert.equal(missingPartnerRes.readOnly, true);
  assert.match(missingPartnerRes.error || '', /YCLIENTS_PARTNER_TOKEN/);
});

test('normalizeYclientsStaffList filters invalid, fired, hidden, and duplicate entries', () => {
  const result = normalizeYclientsStaffList([
    null,
    { id: 1, name: 'А', fired: 0, hidden: 0 },
    { id: 2, name: 'Елена Иванова', position: { title: 'Топ-мастер' }, fired: 0, hidden: 0 },
    { id: 3, name: 'Ольга', fired: true, hidden: false },
    { id: 4, name: 'Светлана', fired: false, hidden: true },
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    id: 2,
    name: 'Елена Иванова',
    position: 'Топ-мастер',
  });
});
