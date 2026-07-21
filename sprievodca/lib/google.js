// Ručný Google OAuth2 "authorization code" flow (bez passport závislosti) — rovnaký štýl
// ako ostatné integrácie v projekte (claude.js, voyage.js): priamy fetch na cudzie API.
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForProfile(code) {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });

  if (!tokenRes.ok) {
    throw new Error(`Google token exchange zlyhal (${tokenRes.status}): ${await tokenRes.text()}`);
  }
  const { access_token: accessToken } = await tokenRes.json();

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!profileRes.ok) {
    throw new Error(`Google userinfo zlyhal (${profileRes.status}): ${await profileRes.text()}`);
  }

  const profile = await profileRes.json();
  // profile: { sub, email, email_verified, name, picture, ... }
  return profile;
}

module.exports = { getAuthUrl, exchangeCodeForProfile };
