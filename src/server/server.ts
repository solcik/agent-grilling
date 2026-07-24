import { extname } from 'node:path'
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiError, HttpApiScalar } from 'effect/unstable/httpapi'

import { GrillApi } from './api.js'
import { StateRepository, makeStateRepositoryLayer } from './repository.js'
import { parseSessionId } from './session.js'
import {
  StaticFilesGateway,
  UnsafeStaticPathError,
  makeStaticFilesGatewayLayer,
} from './staticFiles.js'

const badRequest = () => new HttpApiError.BadRequest({})
const notFound = () => new HttpApiError.NotFound({})

const handlers = HttpApiBuilder.group(GrillApi, 'grill', builder =>
  Effect.gen(function* () {
    const repository = yield* StateRepository

    return builder
      .handle('health', () => Effect.succeed({ status: 'ok' as const }))
      .handle('sessions', () =>
        repository.getInbox.pipe(
          Effect.catchTags({
            PlatformError: error => Effect.die(error),
            SchemaError: () => Effect.fail(badRequest()),
          }),
        ),
      )
      .handle('round', ({ query }) =>
        Effect.gen(function* () {
          const sessionId = yield* parseSessionId(query.session)
          const round = yield* repository.getRound(sessionId)
          return yield* Effect.fromOption(round, notFound)
        }).pipe(
          Effect.catchTags({
            PlatformError: error => Effect.die(error),
            SchemaError: () => Effect.fail(badRequest()),
          }),
        ),
      )
      .handle('postRound', ({ payload }) =>
        Effect.gen(function* () {
          const sessionId = yield* parseSessionId(payload.sessionId)
          return yield* repository.postRound(sessionId, payload.round)
        }).pipe(Effect.mapError(() => badRequest())),
      )
      .handle('answer', ({ query }) =>
        Effect.gen(function* () {
          const sessionId = yield* parseSessionId(query.session)
          const answer = yield* repository.getAnswer(sessionId)
          return yield* Effect.fromOption(answer, notFound)
        }).pipe(
          Effect.catchTags({
            PlatformError: error => Effect.die(error),
            SchemaError: () => Effect.fail(badRequest()),
          }),
        ),
      )
      .handle('postAnswer', ({ payload }) =>
        Effect.gen(function* () {
          const sessionId = yield* parseSessionId(payload.sessionId)
          return yield* repository.postAnswer({ ...payload, sessionId })
        }).pipe(
          Effect.catchTags({
            InvalidAnswerError: () => Effect.fail(badRequest()),
            MissingRoundError: () => Effect.fail(notFound()),
            PlatformError: () => Effect.fail(badRequest()),
            SchemaError: () => Effect.fail(badRequest()),
          }),
        ),
      )
      .handle('reset', ({ payload }) =>
        Effect.gen(function* () {
          const sessionId = yield* parseSessionId(payload.sessionId)
          yield* repository.reset(sessionId)
          return { reset: true }
        }).pipe(Effect.mapError(() => badRequest())),
      )
  }),
)

export const makeApiLayer = (stateDirectory: string) =>
  HttpApiBuilder.layer(GrillApi, { openapiPath: '/openapi.json' }).pipe(
    Layer.provide(handlers.pipe(Layer.provide(makeStateRepositoryLayer(stateDirectory)))),
  )

export const makeApplicationLayer = (stateDirectory: string) =>
  Layer.mergeAll(
    makeApiLayer(stateDirectory),
    HttpApiScalar.layer(GrillApi, { path: '/docs' }),
    staticRoutes.pipe(Layer.provide(makeStaticFilesGatewayLayer(staticRoot))),
  )

const staticRoot = new URL('../ui/', import.meta.url)

const staticRoutes = HttpRouter.use(router =>
  Effect.gen(function* () {
    const staticFiles = yield* StaticFilesGateway
    yield* router.add('GET', '/*', request => {
      const pathname = request.url.split('?')[0] ?? '/'
      const readResponse = (url: string) =>
        staticFiles
          .read(url)
          .pipe(
            Effect.map(({ contents, contentType }) =>
              HttpServerResponse.text(contents, { contentType }),
            ),
          )

      return readResponse(request.url).pipe(
        Effect.catchIf(
          (error): error is UnsafeStaticPathError => error instanceof UnsafeStaticPathError,
          error => Effect.fail(error),
          () =>
            extname(pathname) !== ''
              ? Effect.succeed(HttpServerResponse.text('Not found', { status: 404 }))
              : readResponse('/').pipe(
                  Effect.orElseSucceed(() => HttpServerResponse.html(fallbackHtml)),
                ),
        ),
      )
    })
  }),
)

const fallbackHtml =
  '<!doctype html><html><body><p>grill UI has not been built yet. Run <code>npm run build</code>.</p></body></html>'
