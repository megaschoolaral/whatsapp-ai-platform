import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { env } from '../../env.js';

// `calendar.events` alone is NOT enough for freebusy.query — Google requires the
// broader `calendar` scope for that endpoint. It's a superset, so it also covers
// event creation.
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

const STATE_PURPOSE = 'google_calendar_oauth';

// Derived from googleapis' own bundled google-auth-library rather than imported
// from the standalone `google-auth-library` package — those are two separate
// (incompatible) copies of the same class when both are installed.
export type CalendarOAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export function buildOAuth2Client(): CalendarOAuth2Client {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function signCalendarState(tenantId: string): string {
  return jwt.sign({ tenantId, purpose: STATE_PURPOSE }, env.JWT_SECRET, { expiresIn: '10m' });
}

export function verifyCalendarState(state: string): string {
  const payload = jwt.verify(state, env.JWT_SECRET) as { tenantId: string; purpose: string };
  if (payload.purpose !== STATE_PURPOSE) {
    throw new Error('Invalid state purpose');
  }
  return payload.tenantId;
}

export function buildConsentUrl(tenantId: string): string {
  const client = buildOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: CALENDAR_SCOPES,
    state: signCalendarState(tenantId),
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{ refreshToken: string; googleEmail: string }> {
  const client = buildOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token — consent screen may not have used prompt=consent');
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) {
    throw new Error('Google did not return an account email');
  }
  return { refreshToken: tokens.refresh_token, googleEmail: data.email };
}
