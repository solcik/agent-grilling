import { NodeHttpServer, NodeRuntime, NodeServices } from '@effect/platform-node'
import { Console, Effect, Layer, Option, Schema } from 'effect'
import { Argument, Command, Flag } from 'effect/unstable/cli'
import { HttpRouter } from 'effect/unstable/http'
import type { HttpApiClient } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { Answer, Round } from '../domain/contract.js'
import { makeApplicationLayer } from '../server/server.js'
import { GrillApi } from '../server/api.js'
import { makeClient } from './client.js'
import { deriveProjectId, parseDurationMilliseconds, readRoundFile } from './input.js'

const serverUrl = Flag.string('url').pipe(
  Flag.withDescription('Server base URL.'),
  Flag.withDefault(process.env.GRILL_URL ?? 'http://127.0.0.1:4100'),
)

const sessionTask = Flag.string('session').pipe(
  Flag.withDescription('Task name; the project prefix is derived from git.'),
  Flag.withDefault('default'),
)

const timeoutFlag = Flag.string('timeout').pipe(
  Flag.withDescription('How long to wait, for example 30m or 15s.'),
  Flag.withDefault('30m'),
)

const serve = Command.make(
  'serve',
  {
    port: Flag.integer('port').pipe(
      Flag.withDescription('Port to listen on.'),
      Flag.withDefault(Number(process.env.GRILL_PORT ?? '4100')),
    ),
    host: Flag.string('host').pipe(
      Flag.withDescription('Local address to bind.'),
      Flag.withDefault(process.env.GRILL_HOST ?? '127.0.0.1'),
    ),
    state: Flag.string('state').pipe(
      Flag.withDescription('Directory that persists sessions.'),
      Flag.withDefault(process.env.GRILL_STATE ?? resolve('.grill')),
    ),
  },
  ({ port, host, state }) =>
    Layer.launch(
      HttpRouter.serve(makeApplicationLayer(state)).pipe(
        Layer.provide(NodeHttpServer.layer(createServer, { port, host })),
      ),
    ),
).pipe(
  Command.withDescription('Start the local grill server and browser panel.'),
  Command.withExamples([
    { command: 'grill serve', description: 'Run the panel on http://127.0.0.1:4100.' },
    { command: 'GRILL_PORT=4110 grill serve', description: 'Run on a different local port.' },
  ]),
)

const ask = Command.make(
  'ask',
  {
    round: Flag.string('round').pipe(
      Flag.withDescription('JSON or TypeScript file with an export default Round.'),
      Flag.optional,
    ),
    session: sessionTask,
    title: Flag.string('title').pipe(
      Flag.withDescription('Title for a simple one-question round.'),
      Flag.optional,
    ),
    question: Flag.string('question').pipe(
      Flag.withDescription('Question for a simple round.'),
      Flag.optional,
    ),
    option: Flag.between(Flag.string('option'), 0, 100).pipe(
      Flag.withDescription('Option for a simple round. Repeat the flag for each option.'),
    ),
    timeout: timeoutFlag,
    url: serverUrl,
  },
  Effect.fn(function* ({ round: roundPath, session, title, question, option, timeout, url }) {
    const round = yield* Effect.promise(() =>
      Option.match(roundPath, {
        onNone: () => Promise.resolve(makeSimpleRound(title, question, option)),
        onSome: readRoundFile,
      }),
    )
    const sessionId = `${yield* Effect.promise(() => deriveProjectId(process.cwd()))}/${session}`
    const client = yield* makeClient(url)
    yield* client.grill.postRound({ payload: { sessionId, round } })
    const answer = yield* waitForAnswer(
      client,
      sessionId,
      round.roundId,
      parseDurationMilliseconds(timeout),
    )
    if (answer === undefined) {
      yield* Console.error(`Timed out. Resume with: grill await ${sessionId} ${round.roundId}`)
      yield* Effect.sync(() => {
        process.exitCode = 1
      })
      return
    }
    const encoded = yield* Schema.encodeUnknownEffect(Answer)(answer)
    yield* Console.log(JSON.stringify(encoded, null, 2))
  }),
).pipe(
  Command.withDescription('Post a round, then block until a human submits its answer.'),
  Command.withExamples([
    {
      command: 'grill ask --round ./round.json --session design',
      description: 'Post a complete round file.',
    },
    {
      command: 'grill ask --session api --question "Which API?" --option REST --option GraphQL',
      description: 'Ask one quick question.',
    },
  ]),
)

const awaitAnswer = Command.make(
  'await',
  {
    session: Argument.string('session').pipe(
      Argument.withDescription('Full project/task session id from a timeout ticket.'),
    ),
    roundId: Argument.string('roundId').pipe(Argument.optional),
    timeout: timeoutFlag,
    url: serverUrl,
  },
  Effect.fn(function* ({ session, roundId, timeout, url }) {
    const client = yield* makeClient(url)
    const resolvedRoundId = yield* Option.match(roundId, {
      onNone: () =>
        client.grill.round({ query: { session } }).pipe(Effect.map(round => round.roundId)),
      onSome: Effect.succeed,
    })
    const answer = yield* waitForAnswer(
      client,
      session,
      resolvedRoundId,
      parseDurationMilliseconds(timeout),
    )
    if (answer === undefined) {
      yield* Console.error(`Timed out. Resume with: grill await ${session} ${resolvedRoundId}`)
      yield* Effect.sync(() => {
        process.exitCode = 1
      })
      return
    }
    const encoded = yield* Schema.encodeUnknownEffect(Answer)(answer)
    yield* Console.log(JSON.stringify(encoded, null, 2))
  }),
).pipe(
  Command.withDescription('Resume waiting for an answer that was posted earlier.'),
  Command.withExamples([
    {
      command: 'grill await acme/question-box/design round-123',
      description: 'Resume a timeout ticket.',
    },
  ]),
)

const sessions = Command.make(
  'sessions',
  { url: serverUrl },
  Effect.fn(function* ({ url }) {
    const client = yield* makeClient(url)
    const inbox = yield* client.grill.sessions()
    yield* Console.log(JSON.stringify(inbox, null, 2))
  }),
).pipe(
  Command.withDescription('Print the current inbox as JSON.'),
  Command.withExamples([
    { command: 'grill sessions', description: 'Inspect pending and answered sessions.' },
  ]),
)

const reset = Command.make(
  'reset',
  {
    session: Argument.string('session').pipe(
      Argument.withDescription('Full project/task session id to clear.'),
    ),
    url: serverUrl,
  },
  Effect.fn(function* ({ session, url }) {
    const client = yield* makeClient(url)
    yield* client.grill.reset({ payload: { sessionId: session } })
    yield* Console.log(`Reset ${session}.`)
  }),
).pipe(
  Command.withDescription('Clear one persisted session through the server.'),
  Command.withExamples([
    { command: 'grill reset acme/question-box/design', description: 'Clear one session.' },
  ]),
)

const grill = Command.make('grill').pipe(
  Command.withDescription('A local inbox for agent questions.'),
  Command.withSubcommands([serve, ask, awaitAnswer, sessions, reset]),
)

const makeSimpleRound = (
  maybeTitle: Option.Option<string>,
  maybeQuestion: Option.Option<string>,
  options: ReadonlyArray<string>,
) =>
  Schema.decodeUnknownSync(Round)({
    roundId: randomUUID(),
    title: Option.getOrElse(maybeTitle, () => 'Agent question'),
    questions: [
      {
        id: 'answer',
        question: Option.getOrElse(maybeQuestion, () => 'Which option should we use?'),
        options: (options.length === 0 ? ['Yes', 'No'] : options).map((label, index) => ({
          label,
          recommended: index === 0,
        })),
      },
    ],
  })

const waitForAnswer = (
  client: HttpApiClient.ForApi<typeof GrillApi>,
  sessionId: string,
  roundId: string,
  timeoutMilliseconds: number,
): Effect.Effect<Answer | undefined, unknown> => {
  const deadline = Date.now() + timeoutMilliseconds
  const poll = (): Effect.Effect<Answer | undefined, unknown> =>
    client.grill.answer({ query: { session: sessionId } }).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.flatMap(answer => {
        if (answer !== undefined && answer.roundId === roundId) {
          return Effect.succeed(answer)
        }
        if (Date.now() >= deadline) {
          return Effect.succeed(undefined)
        }
        return Effect.sleep('1 second').pipe(Effect.andThen(poll()))
      }),
    )
  return poll()
}

export const run = Command.run(grill, { version: '0.1.0' }).pipe(Effect.provide(NodeServices.layer))

NodeRuntime.runMain(run)
