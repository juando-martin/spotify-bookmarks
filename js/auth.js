// Spotify OAuth (Authorization Code + PKCE) — login, token exchange,
// refresh, and storage. The app never sees the user's Spotify password.

import { SPOTIFY_CONFIG } from "./config.js";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "./pkce.js";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

const STORAGE_KEYS = {
  verifier: "sb_code_verifier",
  state: "sb_auth_state",
  accessToken: "sb_access_token",
  refreshToken: "sb_refresh_token",
  expiresAt: "sb_expires_at",
};

export function isLoggedIn() {
  return Boolean(localStorage.getItem(STORAGE_KEYS.refreshToken));
}

export function logout() {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
}

/** Kicks off the Spotify login redirect. Call this from a button click. */
export async function loginWithSpotify() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();

  sessionStorage.setItem(STORAGE_KEYS.verifier, verifier);
  sessionStorage.setItem(STORAGE_KEYS.state, state);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    response_type: "code",
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SPOTIFY_CONFIG.scopes,
    state,
  });

  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

/**
 * Call once on page load. If the URL has an OAuth ?code=...&state=...,
 * completes the token exchange and cleans the URL. Returns true if a login
 * was just completed.
 */
export async function handleRedirectIfPresent() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    history.replaceState({}, "", SPOTIFY_CONFIG.redirectUri);
    throw new Error(`Spotify authorization failed: ${error}`);
  }

  if (!code) return false;

  const expectedState = sessionStorage.getItem(STORAGE_KEYS.state);
  const verifier = sessionStorage.getItem(STORAGE_KEYS.verifier);

  // Clean the code/state out of the URL immediately so a page refresh
  // doesn't try to reuse a spent authorization code.
  history.replaceState({}, "", SPOTIFY_CONFIG.redirectUri);

  if (!verifier || !returnedState || returnedState !== expectedState) {
    throw new Error("Spotify login state mismatch — please try logging in again.");
  }

  const body = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  storeTokens(data);
  sessionStorage.removeItem(STORAGE_KEYS.verifier);
  sessionStorage.removeItem(STORAGE_KEYS.state);
  return true;
}

function storeTokens({ access_token, refresh_token, expires_in }) {
  localStorage.setItem(STORAGE_KEYS.accessToken, access_token);
  if (refresh_token) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, refresh_token);
  }
  const expiresAt = Date.now() + expires_in * 1000 - 30_000; // 30s safety margin
  localStorage.setItem(STORAGE_KEYS.expiresAt, String(expiresAt));
}

// If several requests notice the token has expired at the same time, they'd
// each fire a refresh. Share one in-flight refresh between all of them.
let refreshInFlight = null;

function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function performRefresh() {
  const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
  if (!refreshToken) throw new Error("Not logged in.");

  const body = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    // Refresh token is likely invalid/expired — force a fresh login.
    logout();
    throw new Error("Session expired — please log in again.");
  }

  const data = await res.json();
  storeTokens(data);
  return localStorage.getItem(STORAGE_KEYS.accessToken);
}

/** Returns a valid access token, refreshing it first if it's expired/near-expiry. */
export async function getAccessToken() {
  const expiresAt = Number(localStorage.getItem(STORAGE_KEYS.expiresAt) || 0);
  if (Date.now() < expiresAt) {
    return localStorage.getItem(STORAGE_KEYS.accessToken);
  }
  return refreshAccessToken();
}
