import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, expect, test } from 'vitest'
import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'

import { richRoundInput } from '../test-fixtures.js'
import { deriveProjectId, readRoundFile } from './input.js'

const execFileAsync = promisify(execFile)
const directories: Array<string> = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
  )
})

test('derives a project id from an SSH git remote', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'grill-cli-'))
  directories.push(directory)
  await execFileAsync('git', ['init', '--quiet'], { cwd: directory })
  await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:acme/question-box.git'], {
    cwd: directory,
  })

  await expect(deriveProjectId(directory)).resolves.toBe('acme/question-box')
})

test('decodes a JSON round file through the shared contract', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'grill-cli-'))
  directories.push(directory)
  const roundPath = join(directory, 'round.json')
  await writeFile(roundPath, JSON.stringify(richRoundInput))

  const round = await Effect.runPromise(
    readRoundFile(roundPath).pipe(Effect.provide(NodeServices.layer)),
  )
  expect(round).toEqual(expect.objectContaining({ roundId: 'round-rich' }))
})
