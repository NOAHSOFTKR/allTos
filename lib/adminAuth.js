const crypto = require('crypto');

const COOKIE_NAME = 'alltos_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12시간
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

let generatedPassword = null;

// ADMIN_PASSWORD 미설정 시 매 프로세스 시작마다 임시 비밀번호를 생성해 콘솔에 1회 출력
function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!generatedPassword) {
    generatedPassword = crypto.randomBytes(9).toString('base64url');
    console.log('\n========================================================');
    console.log(' ADMIN_PASSWORD 환경변수가 설정되지 않아 임시 비밀번호를 생성했습니다.');
    console.log(` 임시 관리자 비밀번호: ${generatedPassword}`);
    console.log(' 서버 재시작 시 값이 바뀝니다. 고정하려면 .env에 ADMIN_PASSWORD를 설정하세요.');
    console.log('========================================================\n');
  }
  return generatedPassword;
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyPassword(input) {
  return timingSafeStringEqual(input, getAdminPassword());
}

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(payload)).digest('hex');
}

function createSessionToken() {
  const expiry = Date.now() + SESSION_TTL_MS;
  return `${expiry}.${sign(expiry)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [expiryStr, sig] = token.split('.');
  if (!expiryStr || !sig) return false;
  if (Date.now() > Number(expiryStr)) return false;
  return timingSafeStringEqual(sig, sign(expiryStr));
}

// 매우 단순한 인메모리 로그인 시도 제한 (IP당 15분에 5회)
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const entry = attempts.get(ip) || { count: 0, resetAt: Date.now() + WINDOW_MS };
  entry.count += 1;
  attempts.set(ip, entry);
}

function clearAttempts(ip) {
  attempts.delete(ip);
}

module.exports = {
  COOKIE_NAME,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  isRateLimited,
  recordFailedAttempt,
  clearAttempts,
};
