// Thin client for the company's empeo HR API. Two-step OAuth: token endpoint
// gives a short-lived access_token, then we paginate /employees/lists.
//
// `HR_API_FIXTURE=true` short-circuits the entire HTTP layer and reads
// `backend/scripts/response.json` instead, so local dev / tests don't need
// real credentials. That fixture file (a real HR export) was removed from
// this portfolio copy — supply your own to use fixture mode.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env } from '@/config.js';

const TOKEN_URL = 'https://your-tenant.example.com/authorization/connect/token'; // redacted for portfolio copy
const EMPLOYEES_URL = 'https://your-tenant.example.com/empeo/api/v2/employees/lists'; // redacted for portfolio copy
// pageSize=2000 covers the whole roster in a single call, so we don't
// paginate. If the company ever exceeds 2000 employees, bump this or
// reintroduce the pageIndex loop.
const PAGE_SIZE = 2000;
// Required by empeo to scope the request to the tenant. Without this, the
// API returns 400. Sent as a URL query parameter on every list call.
const COMPANY_NAME = 'REDACTED'; // real tenant company name, redacted for portfolio copy
// `fields=WorkInfo` expands `workingInformation` (position, status, organization
// levels, imagePath, etc.) on each row. Without it the API returns only the
// top-level fields, and the mapper has no dept / photoUrl / statusId to read.
const FIELDS = 'WorkInfo';
const TOKEN_REFRESH_LEAD_MS = 30_000;

export class EmpeoAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmpeoAuthError';
  }
}

export class EmpeoServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmpeoServerError';
  }
}

export class EmpeoNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmpeoNetworkError';
  }
}

export interface EmpeoOrganization {
  level1?: string | null;
  level2?: string | null;
  level3?: string | null;
  level4?: string | null;
  level5?: string | null;
  level6?: string | null;
}

export interface EmpeoWorkingInformation {
  position?: string | null;
  statusId?: number | null;
  status?: string | null;
  typeId?: number | null;
  type?: string | null;
  managerRefId?: string | null;
  emailAddress?: string | null;
  imagePath?: string | null;
  workingLocation?: string | null;
  rank?: string | null;
  dateTermination?: string | null;
  organization?: EmpeoOrganization | null;
}

export interface EmpeoEmployee {
  employeeRefId: string;
  firstName?: string | null;
  lastName?: string | null;
  firstNameEN?: string | null;
  lastNameEN?: string | null;
  nickName?: string | null;
  nickNameEN?: string | null;
  titleName?: string | null;
  titleNameEN?: string | null;
  dateHired?: string | null;
  workingInformation?: EmpeoWorkingInformation | null;
  customFields?: Array<{ fieldName?: string | null; value?: string | null }> | null;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function fetchToken(): Promise<string> {
  if (!env.EMPEO_CLIENT_ID || !env.EMPEO_CLIENT_SECRET || !env.EMPEO_SUBSCRIPTION_KEY) {
    throw new EmpeoAuthError('empeo_credentials_missing');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.EMPEO_CLIENT_ID,
    client_secret: env.EMPEO_CLIENT_SECRET,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Ocp-Apim-Subscription-Key': env.EMPEO_SUBSCRIPTION_KEY,
      },
      body,
    });
  } catch (err) {
    throw new EmpeoNetworkError(`token fetch failed: ${String(err)}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new EmpeoAuthError(`token endpoint ${res.status}`);
  }
  if (!res.ok) {
    throw new EmpeoServerError(`token endpoint ${res.status}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new EmpeoAuthError('token response missing access_token');

  const expiresInMs = (json.expires_in ?? 3600) * 1000;
  tokenCache = {
    accessToken: json.access_token,
    expiresAt: Date.now() + expiresInMs,
  };
  return json.access_token;
}

async function getToken(forceRefresh = false): Promise<string> {
  if (
    !forceRefresh &&
    tokenCache &&
    tokenCache.expiresAt - TOKEN_REFRESH_LEAD_MS > Date.now()
  ) {
    return tokenCache.accessToken;
  }
  return fetchToken();
}

async function fetchPage(pageIndex: number, token: string): Promise<EmpeoEmployee[]> {
  const qs = new URLSearchParams({
    pageSize: String(PAGE_SIZE),
    pageIndex: String(pageIndex),
    fields: FIELDS,
    companyName: COMPANY_NAME,
  });
  const url = `${EMPLOYEES_URL}?${qs.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': env.EMPEO_SUBSCRIPTION_KEY ?? '',
      },
    });
  } catch (err) {
    throw new EmpeoNetworkError(`employees fetch failed: ${String(err)}`);
  }

  if (res.status === 401) {
    throw new EmpeoAuthError('employees endpoint 401');
  }
  if (res.status >= 500) {
    throw new EmpeoServerError(`employees endpoint ${res.status}`);
  }
  if (!res.ok) {
    throw new EmpeoServerError(`employees endpoint ${res.status}`);
  }

  const json = (await res.json()) as { data?: EmpeoEmployee[] };
  return json.data ?? [];
}

async function fetchAllEmployees(): Promise<EmpeoEmployee[]> {
  let token = await getToken();
  try {
    return await fetchPage(0, token);
  } catch (err) {
    // Token may have expired between our last refresh and the call. Force a
    // refresh and retry once.
    if (err instanceof EmpeoAuthError) {
      token = await getToken(true);
      return fetchPage(0, token);
    }
    throw err;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
// scripts/response.json lives at backend/scripts/response.json — two
// directories up from this file (src/lib/empeoClient.ts).
const FIXTURE_PATH = path.resolve(here, '..', '..', 'scripts', 'response.json');

async function fetchFromFixture(): Promise<EmpeoEmployee[]> {
  const raw = await readFile(FIXTURE_PATH, 'utf-8');
  const json = JSON.parse(raw) as { data?: EmpeoEmployee[] };
  return json.data ?? [];
}

export async function fetchEmpeoEmployees(): Promise<EmpeoEmployee[]> {
  if (env.HR_API_FIXTURE) {
    return fetchFromFixture();
  }
  return fetchAllEmployees();
}

export function isHrConfigured(): boolean {
  if (env.HR_API_FIXTURE) return true;
  return (
    !!env.EMPEO_CLIENT_ID && !!env.EMPEO_CLIENT_SECRET && !!env.EMPEO_SUBSCRIPTION_KEY
  );
}
