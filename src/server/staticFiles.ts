import { extname, isAbsolute, normalize, relative, resolve } from 'node:path'
import { Context, Effect, FileSystem, Layer, PlatformError, Schema } from 'effect'

export interface StaticFile {
  readonly contents: string
  readonly contentType: string
}

export interface StaticFilesGatewayService {
  readonly read: (
    url: string,
  ) => Effect.Effect<StaticFile, PlatformError.PlatformError | UnsafeStaticPathError>
}

export class StaticFilesGateway extends Context.Service<
  StaticFilesGateway,
  StaticFilesGatewayService
>()('@grill/StaticFilesGateway') {}

export const makeStaticFilesGatewayLayer = (staticRoot: URL) =>
  Layer.effect(
    StaticFilesGateway,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const staticRootPath = decodeURIComponent(staticRoot.pathname)

      const read = Effect.fn('StaticFilesGateway.read')(function* (url: string) {
        const pathname = url.split('?')[0] ?? '/'
        const decodedPathname = yield* Effect.try({
          try: () => decodeURIComponent(pathname),
          catch: () => new UnsafeStaticPathError(),
        })
        const requestedPath =
          decodedPathname === '/' ? 'index.html' : decodedPathname.replace(/^\//, '')
        const safePath = normalize(requestedPath)
        const filePath = resolve(staticRootPath, safePath)
        const pathFromRoot = relative(staticRootPath, filePath)
        if (
          safePath.startsWith('..') ||
          isAbsolute(safePath) ||
          /^[a-z][a-z\d+.-]*:/i.test(safePath) ||
          pathFromRoot.startsWith('..') ||
          isAbsolute(pathFromRoot)
        ) {
          return yield* new UnsafeStaticPathError()
        }
        const contents = yield* fileSystem.readFileString(filePath)
        return { contents, contentType: contentTypeFor(extname(safePath)) }
      })

      return StaticFilesGateway.of({ read })
    }),
  )

export class UnsafeStaticPathError extends Schema.TaggedErrorClass<UnsafeStaticPathError>()(
  'UnsafeStaticPathError',
  {},
) {
  override get message(): string {
    return 'Unsafe static path.'
  }
}

const contentTypeFor = (extension: string): string => {
  if (extension === '.js') return 'text/javascript'
  if (extension === '.css') return 'text/css'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.json') return 'application/json'
  return 'text/html'
}
