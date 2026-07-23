#!/usr/bin/env node
// grilling-panel — a tiny, zero-dependency local server that turns batches of questions
// into a browser panel and collects the answers. Supports MULTIPLE grillings in parallel:
// each is a named "session" with its own state, shown together in one inbox UI.
//
// Design (Gateway pattern): the FILESYSTEM is the message bus. An agent writes a round to
// `<state>/sessions/<id>/round.json`; this server is a thin adapter that serves the SPA
// and shuttles bytes between the browser and per-session state files. It holds NO state of
// its own, so it survives restarts and an agent never has to speak HTTP.
//
//   agent A --writes--> sessions/t269/round.json   --\
//   agent B --writes--> sessions/t270/round.json   ---> browser inbox (one pane, N sessions)
//   server  <--writes-- sessions/<id>/answer.json  <--- on POST /api/answer
//
// The per-session id is the isolation key (the same shape as the mock's x-mock-world), so
// concurrent grillings never collide. One human, one panel, many parallel questions.
//
// Endpoints:
//   GET  /                       the SPA (index.html, colocated with this file)
//   GET  /api/sessions           inbox: one row per session with a round (pending first)
//   GET  /api/round?session=<id> that session's round.json (404 if none)
//   POST /api/answer             { sessionId, roundId, answers } -> sessions/<id>/answer.json
//   GET  /api/answer?session=<id> last answer for a session (debug)
//   GET  /api/health             readiness probe
//
// Env: GRILL_PORT (default 4100), GRILL_HOST (default 127.0.0.1),
//      GRILL_STATE (default <thisDir>/.state) — point at a per-session scratchpad dir.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.GRILL_PORT ?? 4100);
const HOST = process.env.GRILL_HOST ?? '127.0.0.1';
const STATE = process.env.GRILL_STATE ?? join(HERE, '.state');
const SESSIONS = join(STATE, 'sessions');
const INDEX = join(HERE, 'index.html');

// Session ids become directory names, so keep them filesystem-safe and traversal-proof.
const SESSION_RE = /^[A-Za-z0-9._-]{1,64}$/;

await mkdir(SESSIONS, { recursive: true });

const sessionDir = (id) => join(SESSIONS, id);
const roundPath = (id) => join(sessionDir(id), 'round.json');
const answerPath = (id) => join(sessionDir(id), 'answer.json');

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj));

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

// The inbox: every session dir that holds a round.json, tagged pending/answered.
async function listSessions() {
  let entries = [];
  try {
    entries = await readdir(SESSIONS, { withFileTypes: true });
  } catch {
    /* no sessions dir yet */
  }
  const rows = [];
  for (const e of entries) {
    if (!e.isDirectory() || !SESSION_RE.test(e.name)) continue;
    const round = await readJson(roundPath(e.name), null);
    if (!round || !round.roundId) continue;
    const answer = await readJson(answerPath(e.name), null);
    const answered = !!answer && answer.roundId === round.roundId;
    rows.push({
      sessionId: e.name,
      roundId: round.roundId,
      title: round.title ?? e.name,
      count: (round.questions || []).length,
      answered,
      answeredAt: answered ? (answer.submittedAt ?? null) : null,
    });
  }
  // Pending first, then alphabetical by title — a stable inbox order.
  rows.sort(
    (a, b) => a.answered - b.answered || String(a.title).localeCompare(String(b.title))
  );
  return rows;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;
    const session = url.searchParams.get('session');

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return send(res, 200, await readFile(INDEX), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/sessions') {
      return sendJson(res, 200, { sessions: await listSessions() });
    }
    if (req.method === 'GET' && pathname === '/api/round') {
      if (!session || !SESSION_RE.test(session)) return sendJson(res, 400, { error: 'bad session' });
      const round = await readJson(roundPath(session), null);
      return round ? sendJson(res, 200, round) : sendJson(res, 404, { error: 'no round' });
    }
    if (req.method === 'GET' && pathname === '/api/answer') {
      if (!session || !SESSION_RE.test(session)) return sendJson(res, 400, { error: 'bad session' });
      return sendJson(res, 200, await readJson(answerPath(session), {}));
    }
    if (req.method === 'POST' && pathname === '/api/answer') {
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return sendJson(res, 400, { error: 'invalid JSON' });
      }
      const id = payload.sessionId;
      if (!id || !SESSION_RE.test(id)) return sendJson(res, 400, { error: 'bad sessionId' });
      payload.submittedAt = new Date().toISOString();
      await mkdir(sessionDir(id), { recursive: true });
      await writeFile(answerPath(id), JSON.stringify(payload, null, 2));
      process.stdout.write(`[grill] answer for ${id} round "${payload.roundId ?? '?'}" received\n`);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    return sendJson(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`[grill] listening on http://${HOST}:${PORT}  (state: ${STATE})\n`);
});
