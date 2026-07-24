import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiError, HttpApiScalar } from 'effect/unstable/httpapi'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, relative } from 'node:path'

import { GrillApi } from './api.js'
import { MissingRoundError, StateRepository } from './repository.js'

export const makeApiLayer = (stateDirectory: string) => {
  const repository = new StateRepository(stateDirectory)
  const handlers = HttpApiBuilder.group(GrillApi, 'grill', builder =>
    builder
      .handle('health', () => Effect.succeed({ status: 'ok' as const }))
      .handle('sessions', () => Effect.tryPromise(() => repository.getInbox()).pipe(Effect.orDie))
      .handle('round', ({ query }) =>
        Effect.tryPromise(() => repository.getRound(query.session)).pipe(
          Effect.orDie,
          Effect.flatMap(round =>
            round === undefined
              ? Effect.fail(new HttpApiError.NotFound({}))
              : Effect.succeed(round),
          ),
        ),
      )
      .handle('postRound', ({ payload }) =>
        Effect.tryPromise(() => repository.postRound(payload.sessionId, payload.round)).pipe(
          Effect.mapError(() => new HttpApiError.BadRequest({})),
        ),
      )
      .handle('answer', ({ query }) =>
        Effect.tryPromise(() => repository.getAnswer(query.session)).pipe(
          Effect.orDie,
          Effect.flatMap(answer =>
            answer === undefined
              ? Effect.fail(new HttpApiError.NotFound({}))
              : Effect.succeed(answer),
          ),
        ),
      )
      .handle('postAnswer', ({ payload }) =>
        Effect.tryPromise(() => repository.postAnswer(payload)).pipe(
          Effect.mapError(error =>
            error instanceof MissingRoundError
              ? new HttpApiError.NotFound({})
              : new HttpApiError.BadRequest({}),
          ),
        ),
      )
      .handle('reset', ({ payload }) =>
        Effect.tryPromise(() => repository.reset(payload.sessionId)).pipe(
          Effect.as({ reset: true }),
          Effect.mapError(() => new HttpApiError.BadRequest({})),
        ),
      ),
  )

  return HttpApiBuilder.layer(GrillApi, { openapiPath: '/openapi.json' }).pipe(
    Layer.provide(handlers),
  )
}

export const makeApplicationLayer = (stateDirectory: string) =>
  Layer.mergeAll(
    makeApiLayer(stateDirectory),
    HttpApiScalar.layer(GrillApi, { path: '/docs' }),
    staticRoutes,
  )

const staticRoot = new URL('../ui/', import.meta.url)

const staticRoutes = HttpRouter.use(router =>
  router.add('GET', '/*', request => {
    const pathname = request.url.split('?')[0] ?? '/'
    const readResponse = (url: string) =>
      Effect.tryPromise({
        try: () => readStaticFile(url),
        catch: error => error,
      }).pipe(
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
  }),
)

class UnsafeStaticPathError extends Error {
  constructor() {
    super('Unsafe static path.')
  }
}

const readStaticFile = async (
  url: string,
): Promise<{ readonly contents: string; readonly contentType: string }> => {
  const pathname = url.split('?')[0] ?? '/'
  const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
  const safePath = normalize(requestedPath)
  if (
    safePath.startsWith('..') ||
    relative(staticRoot.pathname, join(staticRoot.pathname, safePath)).startsWith('..')
  ) {
    throw new UnsafeStaticPathError()
  }
  const filePath = new URL(safePath, staticRoot).pathname
  return {
    contents: await readFile(filePath, 'utf8'),
    contentType: contentTypeFor(extname(safePath)),
  }
}

const contentTypeFor = (extension: string): string => {
  if (extension === '.js') return 'text/javascript'
  if (extension === '.css') return 'text/css'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.json') return 'application/json'
  return 'text/html'
}

const fallbackHtml =
  '<!doctype html><html><body><p>grill UI has not been built yet. Run <code>npm run build</code>.</p></body></html>'
