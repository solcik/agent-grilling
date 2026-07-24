import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Schema } from 'effect'

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

export const readRoundFile = async (path: string) => {
  const absolute = resolve(path)
  const input =
    extname(absolute) === '.ts'
      ? await importDefaultExport(absolute)
      : JSON.parse(await readFile(absolute, 'utf8'))
  return Schema.decodeUnknownPromise(Round)(input)
}

// A `.ts` round is loaded as a real ES module — Node 26 strips the types natively, so the
// file can use `export default { ... }` (and even imports) rather than being string-eval'd.
const importDefaultExport = async (absolute: string): Promise<unknown> => {
  const module = (await import(pathToFileURL(absolute).href)) as { readonly default?: unknown }
  if (module.default === undefined) {
    throw new Error(`${absolute} must use an export default object.`)
  }
  return module.default
}

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
