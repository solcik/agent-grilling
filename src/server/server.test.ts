import { Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/unstable/http'
import { afterEach, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { answer, richRound } from '../test-fixtures.js'
import { makeApiLayer } from './server.js'

const stateDirectories: Array<string> = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
  await Promise.all(
    stateDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
  )
})

test('handlers persist and retrieve a round, inbox, answer, and health response', async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'grill-server-'))
  stateDirectories.push(stateDirectory)
  const handler = webHandler(stateDirectory)
  const health = await requestJson(handler, '/api/health')
  const posted = await requestJson(handler, '/api/round', {
    method: 'POST',
    body: { sessionId: answer.sessionId, round: richRound },
  })
  const inbox = await requestJson(handler, '/api/sessions')
  const round = await requestJson(
    handler,
    `/api/round?session=${encodeURIComponent(answer.sessionId)}`,
  )
  const submitted = await requestJson(handler, '/api/answer', { method: 'POST', body: answer })
  const received = await requestJson(
    handler,
    `/api/answer?session=${encodeURIComponent(answer.sessionId)}`,
  )

  expect(health).toEqual({ status: 'ok' })
  expect(posted).toEqual(richRound)
  expect((inbox as { sessions: Array<unknown> }).sessions).toEqual([
    expect.objectContaining({ sessionId: answer.sessionId, answered: false }),
  ])
  expect(round).toEqual(richRound)
  expect(submitted).toEqual(answer)
  expect(received).toEqual(answer)
})

test('handlers reject invalid request bodies', async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'grill-server-'))
  stateDirectories.push(stateDirectory)
  const handler = webHandler(stateDirectory)
  const response = await handler(
    new Request('http://grill.local/api/round', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: answer.sessionId, round: { roundId: 1 } }),
    }),
  )

  expect(response.status).toBe(400)
})

const webHandler = (stateDirectory: string) => {
  const application = HttpRouter.toWebHandler(
    makeApiLayer(stateDirectory).pipe(Layer.provide(HttpServer.layerServices)),
  )
  disposers.push(application.dispose)
  return application.handler
}

const requestJson = async (
  handler: (request: Request) => Promise<Response>,
  path: string,
  init?: Readonly<{ method?: string; body?: unknown }>,
) => {
  const response = await handler(
    new Request(`http://grill.local${path}`, {
      method: init?.method,
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  )
  expect(response.status).toBe(200)
  return response.json()
}
