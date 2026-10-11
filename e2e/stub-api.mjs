/**
 * Stub upstream API for end-to-end tests.
 *
 * The frontend reaches the API through the real `/api/v1` proxy, so without
 * something at the other end `/auth/me` fails and the staff gate — correctly —
 * renders its signed-out page. That would leave the signed-in staff shell with no
 * automated accessibility coverage at all, which is a worse state than having no
 * gate, so the tests stand up this stub instead of weakening the gate.
 *
 * It is a real HTTP server, not a `fetch` stub, so the proxy, cookie handling and
 * error envelope are all genuinely exercised.
 *
 * It answers only the paths the app actually uses, modelled on the exported
 * `openapi/careos.openapi.json` (not the retired partial document). Every other
 * path 404s, so a test that accidentally starts depending on more of the API
 * fails loudly rather than quietly passing against invented data.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_API_PORT ?? 3199);

/**
 * The signed-in persona. Everything here is fabricated on a real envelope.
 *
 * `/auth/me` returns `data` in the live shape (`user` + `roles`/`roleDetails`,
 * `organization`, `security`, `session`, …) so the frontend's `normaliseSessionUser`
 * has a real body to read. Login returns the token pair *in the response body* —
 * this stub sits *upstream* of the proxy, and the proxy is what lifts the pair
 * into HttpOnly cookies and strips it from what the browser sees. The header then
 * reads `EXAMPLE Dr N. Wanjiru` (firstName + otherNames + lastName).
 */
const USER = {
  user: {
    id: 'usr-example-1',
    email: 'registrar@example.org',
    firstName: 'EXAMPLE Dr',
    otherNames: 'N.',
    lastName: 'Wanjiru',
    status: 'ACTIVE',
  },
  roles: [{ id: 'role-example-1', key: 'REGISTRAR', name: 'Registrar' }],
  roleDetails: [{ id: 'role-example-1', key: 'REGISTRAR', name: 'Registrar' }],
  organization: {
    id: 'org-example-1',
    name: 'EXAMPLE Teaching Hospital',
    status: 'ACTIVE',
    featureFlags: {},
  },
  security: { passwordChangeRequired: false, mfaEnrolmentRequired: false, staging: [] },
  session: { id: 'ses-example-1', familyId: 'fam-example-1' },
  branch: { current: null, allowed: [] },
  branches: [],
  patient: null,
  preferences: null,
};

const SESSION = {
  id: 'ses-example-1',
  familyId: 'fam-example-1',
  createdAt: '2026-09-27T09:00:00.000Z',
  expiresAt: '2026-09-28T09:00:00.000Z',
};

/** The only token pair the stub accepts. The proxy mirrors it into cookies. */
const TOKENS = {
  accessToken: 'careos-e2e-access-token',
  refreshToken: 'careos-e2e-refresh-token',
  expiresIn: 900,
  refreshTokenExpiresAt: '2026-12-31T00:00:00.000Z',
};

/**
 * The MFA-secured persona. Login for this account answers with a single-use
 * challenge and no tokens; `POST /auth/mfa/verify` completes it (code 123456 or
 * the recovery code `RECOVERY-RSTV-4AK3-9M`) and returns the same session
 * envelope a non-MFA login would, so the proxy lifts the pair exactly as it
 * does for `/auth/login`.
 */
const MFA_EMAIL = 'mfa@example.org';
const MFA_CHALLENGE_TOKEN = 'careos-e2e-mfa-challenge';
const MFA_CODE = '123456';
const MFA_RECOVERY_CODE = 'RECOVERY-RSTV-4AK3-9M';

const PATIENT_REGISTRY = {
  'pat_example_1001': {
    id: 'pat_example_1001',
    patientNumber: 'PAT-2026-000001',
    firstName: 'EXAMPLE',
    otherNames: 'Amina',
    lastName: 'Yusuf',
    dateOfBirth: '1992-05-14',
    sex: 'FEMALE',
    phone: '0700000001',
    county: 'Mombasa',
    town: 'Old Town',
    status: 'ACTIVE',
    version: 1,
  },
  'pat_example_1002': {
    id: 'pat_example_1002',
    patientNumber: 'PAT-2026-000002',
    firstName: 'EXAMPLE',
    otherNames: null,
    lastName: 'Mwangi',
    dateOfBirth: '1987-03-20',
    sex: 'MALE',
    phone: '0700000002',
    county: 'Nairobi',
    town: 'Kilimani',
    status: 'ACTIVE',
    version: 1,
  },
  'pat_example_1003': {
    id: 'pat_example_1003',
    patientNumber: 'PAT-2026-000003',
    firstName: 'EXAMPLE',
    otherNames: 'Muthoni',
    lastName: 'Wambui',
    dateOfBirth: '1975-11-09',
    sex: 'FEMALE',
    phone: '0700000003',
    county: 'Kiambu',
    town: 'Thika',
    status: 'ACTIVE',
    version: 1,
  },
  'pat_example_1004': {
    id: 'pat_example_1004',
    patientNumber: 'PAT-2026-000004',
    firstName: 'EXAMPLE',
    otherNames: null,
    lastName: 'Njoroge',
    dateOfBirth: '1995-02-18',
    sex: 'MALE',
    phone: '0700000004',
    county: 'Nairobi',
    town: 'Riverside',
    status: 'ACTIVE',
    version: 1,
  },
};
let createdSeq = 5;

const SECTIONS = {
  pat_example_1001: {
    guardians: [
      { id: 'g-1001-1', firstName: 'EXAMPLE', lastName: 'Hasan', relationship: 'Guardian', phone: '0700000002', isEmergencyContact: true },
    ],
    consents: [{ type: 'TREATMENT', status: 'GRANTED' }],
    allergies: [{ id: 'a-1001-1', substance: 'Penicillin', severity: 'SEVERE' }],
    medicalHistory: [{ category: 'DIABETES', description: 'Type 2', onsetDate: '2018-06-01' }],
  },
};
const TIMELINE = {
  pat_example_1001: [
    { id: 't-1001-1', occurredAt: '2026-10-05T09:00:00Z', title: 'Registered', type: 'PATIENT_CREATED' },
  ],
};
const ACCESS_LOG = {
  pat_example_1001: [
    {
      id: 'al-1001-1',
      patientId: 'pat_example_1001',
      userId: 'usr-example-1',
      action: 'VIEW',
      section: 'MASTER',
      reason: 'INCLINIC_VIEW',
      ip: '127.0.0.1',
      userAgent: 'stub',
      requestId: 'r-1',
      createdAt: '2026-10-05T09:05:00Z',
    },
  ],
};

/** F3 queue fixtures. Offsets are stamped against the clock at call time. */
const QUEUE_BRANCH_ID = 'br_example_0001';
const DEPARTMENTS = [
  { id: 'dep_example_outpatient', name: 'EXAMPLE Outpatient', code: 'OPD', kind: 'STANDARD', active: true, createdAt: '2026-01-04T06:00:00.000Z' },
  { id: 'dep_example_emergency', name: 'EXAMPLE Emergency', code: 'EMG', kind: 'STANDARD', active: true, createdAt: '2026-01-04T06:00:00.000Z' },
  { id: 'dep_example_paediatrics', name: 'EXAMPLE Paediatrics', code: 'PED', kind: 'STANDARD', active: true, createdAt: '2026-01-04T06:00:00.000Z' },
  { id: 'dep_example_maternity', name: 'EXAMPLE Maternity', code: 'MAT', kind: 'STANDARD', active: true, createdAt: '2026-01-04T06:00:00.000Z' },
];
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const QUEUE = [
  { id: 'qe_example_2001', ticketNumber: 'Q-001', patientId: 'pat_example_1003', patient: 'EXAMPLE Muthoni Wambui', visitId: 'vis_example_3001', departmentId: 'dep_example_emergency', branchId: QUEUE_BRANCH_ID, status: 'WAITING', operationalPriority: 'URGENT', enteredAt: minutesAgo(24), calledAt: null, serviceStartedAt: null, completedAt: null, note: 'Chest pain, triaged by nurse.' },
  { id: 'qe_example_2002', ticketNumber: 'Q-002', patientId: 'pat_example_1002', patient: 'EXAMPLE Mwangi', visitId: 'vis_example_3002', departmentId: 'dep_example_outpatient', branchId: QUEUE_BRANCH_ID, status: 'CALLED', operationalPriority: 'HIGH', enteredAt: minutesAgo(41), calledAt: minutesAgo(3), serviceStartedAt: null, completedAt: null, note: null },
  { id: 'qe_example_2003', ticketNumber: 'Q-003', patientId: 'pat_example_1001', patient: 'EXAMPLE Amina Yusuf', visitId: 'vis_example_3003', departmentId: 'dep_example_outpatient', branchId: QUEUE_BRANCH_ID, status: 'WAITING', operationalPriority: 'NORMAL', enteredAt: minutesAgo(12), calledAt: null, serviceStartedAt: null, completedAt: null, note: null },
  { id: 'qe_example_2004', ticketNumber: 'Q-004', patientId: 'pat_example_1002', patient: 'EXAMPLE Mwangi', visitId: 'vis_example_3004', departmentId: 'dep_example_paediatrics', branchId: QUEUE_BRANCH_ID, status: 'IN_SERVICE', operationalPriority: 'NORMAL', enteredAt: minutesAgo(63), calledAt: minutesAgo(52), serviceStartedAt: minutesAgo(49), completedAt: null, note: null },
  { id: 'qe_example_2005', ticketNumber: 'Q-005', patientId: 'pat_example_1003', patient: 'EXAMPLE Muthoni Wambui', visitId: 'vis_example_3005', departmentId: 'dep_example_outpatient', branchId: QUEUE_BRANCH_ID, status: 'COMPLETED', operationalPriority: 'NORMAL', enteredAt: minutesAgo(120), calledAt: minutesAgo(95), serviceStartedAt: minutesAgo(92), completedAt: minutesAgo(70), note: null },
  { id: 'qe_example_2006', ticketNumber: 'Q-006', patientId: 'pat_example_1002', patient: 'EXAMPLE Mwangi', visitId: 'vis_example_3006', departmentId: 'dep_example_maternity', branchId: QUEUE_BRANCH_ID, status: 'NO_SHOW', operationalPriority: 'LOW', enteredAt: minutesAgo(88), calledAt: minutesAgo(60), serviceStartedAt: null, completedAt: null, note: 'Did not answer the call.' },
];
const QUEUE_TRANSITIONS = {
  WAITING: ['CALLED', 'NO_SHOW', 'ABANDONED', 'CANCELLED', 'TRANSFERRED'],
  CALLED: ['IN_SERVICE', 'WAITING', 'NO_SHOW', 'CANCELLED', 'TRANSFERRED'],
  IN_SERVICE: ['COMPLETED', 'CANCELLED', 'TRANSFERRED'],
  COMPLETED: [], NO_SHOW: [], ABANDONED: [], CANCELLED: [], TRANSFERRED: [],
};
const QUEUE_ACTIVE = new Set(['WAITING', 'CALLED', 'IN_SERVICE']);
let ticketSeq = 7;

function queueStats() {
  const callWaits = QUEUE.filter((e) => e.calledAt).map((e) => (Date.parse(e.calledAt) - Date.parse(e.enteredAt)) / 60000);
  const services = QUEUE.filter((e) => e.serviceStartedAt && e.completedAt).map((e) => (Date.parse(e.completedAt) - Date.parse(e.serviceStartedAt)) / 60000);
  const left = QUEUE.filter((e) => e.status === 'ABANDONED' || e.status === 'NO_SHOW').length;
  const avg = (values) => (values.length === 0 ? null : Math.round(values.reduce((s, v) => s + v, 0) / values.length));
  return { avgCallWaitMinutes: avg(callWaits), avgServiceMinutes: avg(services), abandonmentRate: QUEUE.length === 0 ? 0 : Math.round(left / QUEUE.length * 100) / 100, currentlyWaiting: QUEUE.filter((e) => e.status === 'WAITING').length };
}


function send(response, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => resolve(body));
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }

  // Published facilities, per the live contract: `GET /public/facilities/search`
  // returns a flat `{ success, data: […] }` array (there is no `{ items, total }`
  // envelope and no `/public/facilities` path upstream). The `q` query is the
  // API's real free-text search, exercised here over name/address/town. Facets
  // (`open24h`, `emergency24h`, `ambulanceAvailable`) are the live fields; the
  // partial document's `type`/`status` enums do not exist upstream, so no stub
  // data fabricates them. All records are fabricated.
  const FACILITIES = [
    {
      id: 'fac-example-1',
      slug: 'example-general-hospital',
      name: 'EXAMPLE General Hospital',
      summary: 'EXAMPLE 24-hour casualty with online emergency intake.',
      town: 'Mombasa',
      county: 'Mombasa County',
      address: '1 Independence Avenue, Mombasa',
      phone: '+254 700 000 111',
      open24h: true,
      emergency24h: true,
      ambulanceAvailable: true,
      emergencyIntakeEnabled: true,
    },
    {
      id: 'fac-example-2',
      slug: 'example-referral-centre',
      name: 'EXAMPLE Referral Centre',
      summary: 'EXAMPLE regional referral centre.',
      town: 'Nairobi',
      county: 'Nairobi County',
      address: '22 Hospital Road, Nairobi',
      phone: '+254 700 000 222',
      open24h: true,
      emergency24h: false,
      ambulanceAvailable: true,
      emergencyIntakeEnabled: false,
    },
    {
      id: 'fac-example-3',
      slug: 'example-community-clinic',
      name: 'EXAMPLE Community Clinic',
      summary: 'EXAMPLE daytime community clinic.',
      town: 'Kisumu',
      county: 'Kisumu County',
      address: '3 Market Street, Kisumu',
      open24h: false,
      emergency24h: false,
      ambulanceAvailable: false,
      emergencyIntakeEnabled: false,
    },
  ];
  if (url.pathname === '/public/facilities/search' && request.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    let items = FACILITIES;
    if (q) {
      items = items.filter((facility) =>
        `${facility.name} ${facility.address ?? ''} ${facility.town ?? ''}`
          .toLowerCase()
          .includes(q),
      );
    }
    send(response, 200, { success: true, data: items });
    return;
  }

  if (url.pathname === '/public/emergency-requests' && request.method === 'POST') {
    const cookies = request.headers.cookie ?? '';

    // Rate limited, for the error-path test.
    if (cookies.includes('careos-e2e=rate-limited')) {
      send(response, 429, { success: false, error: { code: 'RATE_LIMITED', message: 'stub' } });
      return;
    }

    // Deliberately validates: the form's own client validation is not the only
    // line of defence, and a stub that accepted anything would hide a form that
    // posts an invalid body. The live body is slug-keyed (`SubmitEmergencyRequestDto`).
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'bad json' },
        });
        return;
      }

      if (typeof parsed.slug !== 'string' || parsed.slug.length === 0) {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'invalid', details: ['slug'] },
        });
        return;
      }

      send(response, 201, {
        success: true,
        data: {
          request: {
            id: 'er-example-1',
            referenceNumber: 'EX-EM-00001',
            trackingToken: 'ex-tok-00001',
          },
          contact: '+254 700 000 111',
          consentVersion: '2026-10-01',
        },
      });
    });
    return;
  }

  if (url.pathname === '/public/emergency-requests/track' && request.method === 'POST') {
    // Tracking is keyed solely by the token the intake receipt issued. The stub
    // answers the live `trackPublic` shape (caller-safe status/copy, facility,
    // national numbers) so the tracker renders the API's words, not ours.
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'bad json' },
        });
        return;
      }

      if (typeof parsed.token !== 'string' || parsed.token.length === 0) {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'invalid', details: ['token'] },
        });
        return;
      }

      if (parsed.token !== 'ex-tok-00001') {
        send(response, 404, {
          success: false,
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'No request found for that tracking token',
          },
        });
        return;
      }

      send(response, 200, {
        success: true,
        data: {
          referenceNumber: 'EX-EM-00001',
          receivedAt: '2026-09-27T10:00:00.000Z',
          status: 'RECEIVED',
          statusLabel: 'Received',
          action: 'WAIT',
          message:
            'We have notified the facility. Keep this token to check again as your request advances.',
          level: 0,
          facility: {
            name: 'EXAMPLE General Hospital',
            slug: 'example-general-hospital',
            phone: '+254 700 000 111',
          },
          serviceArea: 'EXAMPLE metro',
          guidance: null,
          numbers: [
            { purpose: 'emergency', label: 'National emergency', phone: '+254 999', hours: '24/7' },
          ],
          numbersSource: 'seed',
          disclaimer: 'careOS does not dispatch emergency services or guarantee a response time.',
          consentVersion: '2026-10-01',
        },
      });
    });
    return;
  }

  if (url.pathname === '/auth/login' && request.method === 'POST') {
    // The live contract posts `LoginDto` (organizationId, email, password). The
    // stub validates as strictly as the API so a test that posts a malformed
    // body fails loudly instead of silently getting a session.
    let parsed;
    try {
      parsed = JSON.parse((await readBody(request)) || '{}');
    } catch {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad json' },
      });
      return;
    }
    if (
      typeof parsed.organizationId !== 'string' ||
      parsed.organizationId.length === 0 ||
      typeof parsed.email !== 'string' ||
      parsed.email.length === 0 ||
      typeof parsed.password !== 'string' ||
      parsed.password.length === 0
    ) {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'invalid' },
      });
      return;
    }

    if (parsed.email === MFA_EMAIL) {
      send(response, 200, {
        success: true,
        data: {
          mfaRequired: true,
          challengeToken: MFA_CHALLENGE_TOKEN,
          challengeExpiresIn: 300,
        },
      });
      return;
    }

    send(response, 200, {
      success: true,
      data: {
        mfaRequired: false,
        user: USER.user,
        session: SESSION,
        tokens: TOKENS,
      },
    });
    return;
  }

  if (url.pathname === '/auth/mfa/verify' && request.method === 'POST') {
    // Mirrors the live DTO: a challenge token plus one of { TOTP code, recovery
    // code }. A wrong challenge or wrong code is a 401, exactly as the API
    // answers, so the test proves the form shows the refusal without admitting
    // the session.
    let parsed;
    try {
      parsed = JSON.parse((await readBody(request)) || '{}');
    } catch {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad json' },
      });
      return;
    }
    const code = typeof parsed.code === 'string' ? parsed.code : '';
    const recovery =
      typeof parsed.recoveryCode === 'string'
        ? parsed.recoveryCode.trim().toUpperCase().replace(/\s+/g, '')
        : '';
    if (
      parsed.challengeToken !== MFA_CHALLENGE_TOKEN ||
      (code !== MFA_CODE && recovery !== MFA_RECOVERY_CODE)
    ) {
      send(response, 401, { success: false, error: { code: 'UNAUTHORIZED' } });
      return;
    }

    send(response, 200, {
      success: true,
      data: {
        user: USER.user,
        session: SESSION,
        tokens: TOKENS,
      },
    });
    return;
  }

  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    // The proxy fills in the refresh token from the cookie; the browser can never
    // know it. The stub holds the proxy to account: the injected secret must be
    // the one we issued.
    let parsed;
    try {
      parsed = JSON.parse((await readBody(request)) || '{}');
    } catch {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad json' },
      });
      return;
    }
    if (parsed.refreshToken !== TOKENS.refreshToken) {
      send(response, 401, { success: false, error: { code: 'UNAUTHORIZED' } });
      return;
    }
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname === '/auth/me' && request.method === 'GET') {
    // A cookie the stub reads, not a header the app trusts: the application has no
    // idea this switch exists, and the 503 state is reached the way a real visitor
    // reaches it — the proxy forwards the session cookie as `Authorization: Bearer`,
    // and the stub answers by whether it recognises the token.
    const cookies = request.headers.cookie ?? '';

    // Reachable but broken. Distinct from signed-out so the gate can prove it tells
    // the two apart — telling someone to sign in when the API is down wastes a
    // support call and teaches people to ignore the message.
    if (cookies.includes('careos-e2e=unavailable')) {
      send(response, 503, { success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
      return;
    }

    // Signed out means what it always did here: no usable session. The proxy turns
    // the `careos_session` cookie into this header, so its absence is the absence
    // of a session.
    if (request.headers.authorization !== `Bearer ${TOKENS.accessToken}`) {
      send(response, 401, { success: false, error: { code: 'UNAUTHORIZED' } });
      return;
    }

    send(response, 200, { success: true, data: USER });
    return;
  }


  if (url.pathname === '/patients' && request.method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    let items = Object.values(PATIENT_REGISTRY);
    if (q) {
      items = items.filter(p => [p.patientNumber, `${p.firstName} ${p.otherNames||''} ${p.lastName}`, p.phone||''].join(' ').toLowerCase().includes(q));
    }
    send(response, 200, { success: true, data: { items, meta: { page:1, limit:25, total: items.length, totalPages: Math.ceil(items.length/25) } } });
    return;
  }

  if (url.pathname === '/patients' && request.method === 'POST') {
    let parsed;
    try { parsed = JSON.parse((await readBody(request))||'{}'); } catch { send(response,400,{success:false,error:{code:'VALIDATION_ERROR',message:'bad json'}}); return; }
    const body = parsed;
    if (!body.firstName || !body.lastName) {
      send(response,400,{success:false,error:{code:'VALIDATION_ERROR',message:'invalid'}}); return;
    }
    // trigger duplicate for the scripted walk-in: EXAMPLE, lastName Yusuf, DOB 1992-05-14
    if (body.firstName === 'EXAMPLE' && body.lastName === 'Yusuf' && body.dateOfBirth === '1992-05-14') {
      send(response,409,{success:false,error:{code:'POSSIBLE_DUPLICATE',details:{candidates:[{
        patientId:'pat_example_1002', patientNumber:'PAT-2026-000002', firstName:'EXAMPLE', lastName:'Yusuf', dateOfBirth:'1992-05-14', score:0.92, reasons:['name-match','dob-match']
      }]}}});
      return;
    }
    createdSeq++;
    const id = `pat_example_${1000+createdSeq}`;
    const num = `PAT-2026-${String(createdSeq).padStart(6,'0')}`;
    const created = { id, patientNumber:num, firstName:body.firstName, otherNames:body.otherNames||null, lastName:body.lastName, dateOfBirth:body.dateOfBirth||null, sex:body.sex||null, phone:body.phone||null, county:body.county||null, town:body.town||null, status:'ACTIVE', version:1 };
    PATIENT_REGISTRY[id] = created;
    send(response,201,{success:true,data:created});
    return;
  }

  if (url.pathname.startsWith('/patients/') && url.pathname.endsWith('/confirm-not-duplicate') && request.method === 'POST') {
    // id not needed for stub
    send(response,200,{success:true});
    return;
  }

  if (url.pathname.match(/^\/patients\/[^/]+\/master$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const p = PATIENT_REGISTRY[id];
    if (!p) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    const sections = SECTIONS[id] || { guardians: [], consents: [], allergies: [], medicalHistory: [] };
    send(response, 200, { success: true, data: { patient: p, sections } });
    return;
  }

  if (url.pathname.match(/^\/patients\/[^/]+$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-1)[0];
    const p = PATIENT_REGISTRY[id];
    if (!p) { send(response,404,{success:false,error:{code:'RESOURCE_NOT_FOUND'}}); return; }
    const sections = SECTIONS[id] || { guardians:[], consents:[], allergies:[], medicalHistory:[] };
    send(response,200,{success:true,data:{ patient: p, sections }});
    return;
  }

  if (url.pathname.match(/^\/patients\/[^/]+\/timeline$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-2,-1)[0];
    const items = TIMELINE[id] || [];
    send(response,200,{success:true,data:{ items, meta:{ page:1, limit:25, total:items.length, totalPages:1 } }});
    return;
  }

  if (url.pathname.match(/^\/patients\/[^/]+\/access-log$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-2,-1)[0];
    const items = ACCESS_LOG[id] || [];
    send(response,200,{success:true,data:{ items, meta:{ page:1, limit:25, total:items.length, totalPages:1 } }});
    return;
  }

  // F3 queue. Same contract and records as the MSW handlers.
  if (url.pathname === '/queue/metrics' && request.method === 'GET') {
    send(response, 200, { success: true, data: { stats: queueStats() } });
    return;
  }

  if (url.pathname === '/queue/status' && request.method === 'GET') {
    const mine = QUEUE.find((e) => e.status === 'WAITING' || e.status === 'CALLED');
    if (!mine) { send(response, 200, { success: true, data: { queued: false, ticketNumber: null, position: null, estimate: null } }); return; }
    const ahead = QUEUE.filter((e) => e.status === 'WAITING' && e.id !== mine.id).length;
    send(response, 200, { success: true, data: { queued: true, ticketNumber: mine.ticketNumber, position: ahead + 1, estimate: (ahead + 1) * 10 } });
    return;
  }

  if (url.pathname === '/queue' && request.method === 'GET') {
    const departmentId = url.searchParams.get('departmentId');
    const status = url.searchParams.get('status');
    let items = [...QUEUE];
    if (departmentId) items = items.filter((e) => e.departmentId === departmentId);
    if (status) items = items.filter((e) => e.status === status);
    items.sort((a, b) => Date.parse(b.enteredAt) - Date.parse(a.enteredAt));
    send(response, 200, { success: true, data: { items, meta: { page:1, limit:25, total: items.length, totalPages: Math.max(1, Math.ceil(items.length/25)) } } });
    return;
  }

  if (url.pathname === '/departments' && request.method === 'GET') {
    const items = DEPARTMENTS.map((d) => ({ ...d, branchId: QUEUE_BRANCH_ID }));
    send(response, 200, { success: true, data: { departments: items, meta: { page:1, limit:100, total: items.length, totalPages:1 } } });
    return;
  }

  if (url.pathname === '/queue/walk-ins/register' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request))||'{}'); } catch { send(response,400,{success:false,error:{code:'VALIDATION_ERROR'}}); return; }
    if (typeof body.patientId !== 'string' || typeof body.departmentId !== 'string') {
      send(response,400,{success:false,error:{code:'VALIDATION_ERROR'}}); return;
    }
    if (QUEUE.some((e) => e.patientId === body.patientId && QUEUE_ACTIVE.has(e.status))) {
      send(response,409,{success:false,error:{code:'VISIT_ALREADY_ACTIVE'}}); return;
    }
    const seq = ticketSeq++;
    const ticketNumber = `Q-${String(seq).padStart(3,'0')}`;
    const patient = PATIENT_REGISTRY[body.patientId];
    const entry = { id: `qe_example_${2000+seq}`, ticketNumber, patientId: body.patientId, patient: patient ? `${patient.firstName} ${patient.lastName}` : 'EXAMPLE Patient', visitId: `vis_example_${3000+seq}`, departmentId: body.departmentId, branchId: body.branchId || QUEUE_BRANCH_ID, status: 'WAITING', operationalPriority: body.priority || 'NORMAL', enteredAt: new Date().toISOString(), calledAt: null, serviceStartedAt: null, completedAt: null, note: body.note || null };
    QUEUE.push(entry);
    send(response, 201, { success: true, data: { id: entry.id, ticketNumber, visitId: entry.visitId, status: entry.status, position: QUEUE.filter((e) => e.status === 'WAITING').length } });
    return;
  }

  if (url.pathname.match(/^\/queue\/entries\/[^/]+\/status$/) && request.method === 'PATCH') {
    const id = url.pathname.split('/').slice(-2,-1)[0];
    const entry = QUEUE.find((e) => e.id === id);
    if (!entry) { send(response,404,{success:false,error:{code:'RESOURCE_NOT_FOUND'}}); return; }
    let body;
    try { body = JSON.parse((await readBody(request))||'{}'); } catch { send(response,400,{success:false,error:{code:'VALIDATION_ERROR'}}); return; }
    if (!(QUEUE_TRANSITIONS[entry.status] || []).includes(body.status)) {
      send(response,409,{success:false,error:{code:'INVALID_WORKFLOW_TRANSITION'}}); return;
    }
    const now = new Date().toISOString();
    entry.status = body.status;
    if (body.status === 'CALLED') entry.calledAt = now;
    if (body.status === 'IN_SERVICE') entry.serviceStartedAt = now;
    if (body.status === 'COMPLETED') entry.completedAt = now;
    if (body.status === 'WAITING') entry.calledAt = null;
    send(response, 200, { success: true, data: { ...entry } });
    return;
  }

  if (url.pathname.match(/^\/queue\/entries\/[^/]+\/priority$/) && request.method === 'PATCH') {
    const id = url.pathname.split('/').slice(-2,-1)[0];
    const entry = QUEUE.find((e) => e.id === id);
    if (!entry) { send(response,404,{success:false,error:{code:'RESOURCE_NOT_FOUND'}}); return; }
    let body;
    try { body = JSON.parse((await readBody(request))||'{}'); } catch { send(response,400,{success:false,error:{code:'VALIDATION_ERROR'}}); return; }
    if (typeof body.operationalPriority !== 'string') { send(response,400,{success:false,error:{code:'VALIDATION_ERROR'}}); return; }
    if (!QUEUE_ACTIVE.has(entry.status)) { send(response,409,{success:false,error:{code:'INVALID_WORKFLOW_TRANSITION'}}); return; }
    entry.operationalPriority = body.operationalPriority;
    send(response, 200, { success: true, data: { ...entry } });
    return;
  }

  send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`stub-api listening on http://127.0.0.1:${PORT}\n`);
});
