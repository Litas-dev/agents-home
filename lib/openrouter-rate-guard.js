const RATE_WINDOW_MS =
  (parseInt(process.env.TEAM_HEALTH_RATE_LIMIT_WINDOW_SEC, 10) || 300) * 1000;

const rateLimitEvents = [];

function record429() {
  const now = Date.now();
  rateLimitEvents.push(now);
  // prune old events
  while (
    rateLimitEvents.length &&
    rateLimitEvents[0] < now - RATE_WINDOW_MS
  ) {
    rateLimitEvents.shift();
  }
}

function isRateLimited() {
  return rateLimitEvents.length > 0;
}

function getRecent429Count() {
  return rateLimitEvents.length;
}

module.exports = { record429, isRateLimited, getRecent429Count };
