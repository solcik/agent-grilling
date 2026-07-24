import { NodeFileSystem } from '@effect/platform-node'
import { Effect, FileSystem, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/unstable/http'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { Inbox } from '../domain/contract.js'
import { answer, richRound } from '../test-fixtures.js'
import { makeApiLayer, makeApplicationLayer } from './server.js'
import { parseSessionId, sessionDirectoryKey } from './session.js'

const stateDirectories: Array<string> = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
  await Promise.all(
    stateDirectories.splice(0).map(directory =>
      Effect.runPromise(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          yield* fileSystem.remove(directory, { recursive: true, force: true })
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      ),
    ),
  )
})

test('handlers persist and retrieve a round, inbox, answer, and health response', async () => {
  const stateDirectory = await makeStateDirectory()
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
  expect(Schema.decodeUnknownSync(Inbox)(inbox).sessions).toEqual([
    expect.objectContaining({ sessionId: answer.sessionId, answered: false }),
  ])
  expect(round).toEqual(richRound)
  expect(submitted).toEqual(answer)
  expect(received).toEqual(answer)
})

test('handlers reject invalid request bodies', async () => {
  const stateDirectory = await makeStateDirectory()
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

test('handlers preserve not-found and bad-request outcomes', async () => {
  const stateDirectory = await makeStateDirectory()
  const handler = webHandler(stateDirectory)
  const missingRound = await handler(
    new Request(`http://grill.local/api/round?session=${encodeURIComponent(answer.sessionId)}`),
  )
  const missingAnswer = await handler(
    new Request(`http://grill.local/api/answer?session=${encodeURIComponent(answer.sessionId)}`),
  )
  const answerWithoutRound = await handler(
    new Request('http://grill.local/api/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(answer),
    }),
  )
  const blankSession = await handler(
    new Request('http://grill.local/api/round', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: '   ', round: richRound }),
    }),
  )

  expect(missingRound.status).toBe(404)
  expect(missingAnswer.status).toBe(404)
  expect(answerWithoutRound.status).toBe(404)
  expect(blankSession.status).toBe(400)
})

test('handlers reject invalid answers and reset a session', async () => {
  const stateDirectory = await makeStateDirectory()
  const handler = webHandler(stateDirectory)
  await requestJson(handler, '/api/round', {
    method: 'POST',
    body: { sessionId: answer.sessionId, round: richRound },
  })
  const invalidAnswer = await handler(
    new Request('http://grill.local/api/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...answer, roundId: 'another-round' }),
    }),
  )
  const reset = await requestJson(handler, '/api/reset', {
    method: 'POST',
    body: { sessionId: answer.sessionId },
  })
  const roundAfterReset = await handler(
    new Request(`http://grill.local/api/round?session=${encodeURIComponent(answer.sessionId)}`),
  )

  expect(invalidAnswer.status).toBe(400)
  expect(reset).toEqual({ reset: true })
  expect(roundAfterReset.status).toBe(404)
})

test('handlers map malformed persisted data to a bad request', async () => {
  const stateDirectory = await makeStateDirectory()
  const sessionId = await Effect.runPromise(parseSessionId(answer.sessionId))
  await Effect.runPromise(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = join(stateDirectory, 'sessions', sessionDirectoryKey(sessionId))
      yield* fileSystem.makeDirectory(directory, { recursive: true })
      yield* fileSystem.writeFileString(join(directory, 'round.json'), 'not json')
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )
  const handler = webHandler(stateDirectory)
  const response = await handler(
    new Request(`http://grill.local/api/round?session=${encodeURIComponent(answer.sessionId)}`),
  )

  expect(response.status).toBe(400)
})

test('static routes distinguish missing assets from extensionless SPA routes', async () => {
  const stateDirectory = await makeStateDirectory()
  const handler = webHandler(stateDirectory, true)
  const missingAsset = await handler(new Request('http://grill.local/missing.js'))
  const spaRoute = await handler(new Request('http://grill.local/sessions/example'))

  expect(missingAsset.status).toBe(404)
  expect(await missingAsset.text()).toBe('Not found')
  expect(spaRoute.status).toBe(200)
  expect(await spaRoute.text()).toContain('grill UI has not been built yet')
})

const makeStateDirectory = async () => {
  const directory = await Effect.runPromise(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      return yield* fileSystem.makeTempDirectory({ prefix: 'grill-server-' })
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )
  stateDirectories.push(directory)
  return directory
}

const webHandler = (stateDirectory: string, withStaticRoutes = false) => {
  const application = HttpRouter.toWebHandler(
    (withStaticRoutes ? makeApplicationLayer(stateDirectory) : makeApiLayer(stateDirectory)).pipe(
      Layer.provide(Layer.mergeAll(HttpServer.layerServices, NodeFileSystem.layer)),
    ),
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
