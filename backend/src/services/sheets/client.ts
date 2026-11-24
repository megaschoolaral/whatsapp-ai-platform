import { google, type sheets_v4 } from 'googleapis';
import { env } from '../../env.js';
import { logger } from '../../logger.js';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

let cached: { sheets: sheets_v4.Sheets; email: string } | null | undefined;

function load(): { sheets: sheets_v4.Sheets; email: string } | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return cached;
  try {
    const key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccountKey;
    const auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    cached = { sheets: google.sheets({ version: 'v4', auth }), email: key.client_email };
  } catch {
    // Never log the JSON itself: it holds a private key.
    logger.error('GOOGLE_SERVICE_ACCOUNT_JSON is set but is not a valid service account key');
  }
  return cached;
}

export function getSheetsClient(): sheets_v4.Sheets | null {
  return load()?.sheets ?? null;
}

export function getServiceAccountEmail(): string | null {
  return load()?.email ?? null;
}
