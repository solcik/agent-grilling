import { it } from '@effect/vitest'
import { Effect, FileSystem, Layer } from 'effect'
import { expect } from 'vitest'

import {
  StaticFilesGateway,
  UnsafeStaticPathError,
  makeStaticFilesGatewayLayer,
} from './staticFiles.js'

const gatewayLayer = makeStaticFilesGatewayLayer(new URL('file:///static/')).pipe(
  Layer.provide(
    FileSystem.layerNoop({
      readFileString: path =>
        Effect.succeed(path === '/static/index.html' ? '<html>grill</html>' : 'asset'),
    }),
  ),
)

it.effect('reads static files with their response content type', () =>
  Effect.gen(function* () {
    const gateway = yield* StaticFilesGateway

    expect(yield* gateway.read('/')).toEqual({
      contents: '<html>grill</html>',
      contentType: 'text/html',
    })
    expect((yield* gateway.read('/entry.js')).contentType).toBe('text/javascript')
  }).pipe(Effect.provide(gatewayLayer)),
)

it.effect('rejects literal, encoded, and URL-shaped paths that escape the static root', () =>
  Effect.gen(function* () {
    const gateway = yield* StaticFilesGateway

    for (const path of [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '//etc/passwd',
      '/file:///etc/passwd',
      '/%invalid-escape',
    ]) {
      const error = yield* Effect.flip(gateway.read(path))
      expect(error).toBeInstanceOf(UnsafeStaticPathError)
    }
  }).pipe(Effect.provide(gatewayLayer)),
)
