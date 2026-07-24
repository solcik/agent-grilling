import { execFile } from 'node:child_process'
import { basename, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Effect, FileSystem, Schema } from 'effect'

import { Round } from '../domain/contract.js'

const execFileAsync = promisify(execFile)

export const deriveProjectId = async (cwd: string): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd })
    return projectIdFromRemote(stdout.trim())
  } catch {
    return basename(resolve(cwd))
  }
}

export const projectIdFromRemote = (remote: string): string => {
  const withoutProtocol = remote.replace(/^[a-z]+:\/\//i, '').replace(/^.+@/, '')
  const withoutHost = withoutProtocol.includes(':')
    ? withoutProtocol.slice(withoutProtocol.indexOf(':') + 1)
    : withoutProtocol.replace(/^[^/]+\//, '')
  return withoutHost.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '')
}

export const readRoundFile = Effect.fn('grill.readRoundFile')(function* (path: string) {
  const absolute = resolve(path)
  const input =
    extname(absolute) === '.ts'
      ? yield* importDefaultExport(absolute)
      : yield* readJsonFile(absolute)
  return yield* Schema.decodeUnknownEffect(Round)(input)
})

const readJsonFile = Effect.fn('grill.readJsonFile')(function* (absolute: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const content = yield* fileSystem.readFileString(absolute)
  return yield* Effect.try(() => JSON.parse(content))
})

// A `.ts` round is loaded as a real ES module — Node 26 strips the types natively, so the
// file can use `export default { ... }` (and even imports) rather than being string-eval'd.
const importDefaultExport = Effect.fn('grill.importDefaultExport')(function* (absolute: string) {
  const module: unknown = yield* Effect.tryPromise(() => import(pathToFileURL(absolute).href))
  if (
    typeof module !== 'object' ||
    module === null ||
    !('default' in module) ||
    module.default === undefined
  ) {
    return yield* Effect.fail(new Error(`${absolute} must use an export default object.`))
  }
  return module.default
})

export const parseDurationMilliseconds = (input: string): number => {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(input.trim())
  if (match === null) {
    throw new Error(`Invalid duration: ${input}. Use a value such as 30m or 15s.`)
  }
  const amount = Number(match[1])
  const unit = match[2]
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'm' ? 60_000 : 3_600_000
  return amount * multiplier
}
