import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import {
  Array as Arr,
  Context,
  Effect,
  FileSystem,
  Layer,
  Match,
  Option,
  PlatformError,
  Schema,
} from 'effect'

import { Answer, Inbox, Round, SessionRow } from '../domain/contract.js'
import type {
  Answer as AnswerType,
  Inbox as InboxType,
  Round as RoundType,
} from '../domain/contract.js'
import type { SessionId } from './session.js'
import { sessionDirectoryKey } from './session.js'

const StoredSession = Schema.Struct({ sessionId: Schema.String })

type RepositoryReadError = PlatformError.PlatformError | Schema.SchemaError
type SessionAnswer = Omit<AnswerType, 'sessionId'> & { readonly sessionId: SessionId }

const isMissingFileError = (error: PlatformError.PlatformError): boolean =>
  Match.value(error.reason).pipe(
    Match.when({ _tag: 'NotFound' }, () => true),
    Match.orElse(() => false),
  )

export class InvalidAnswerError extends Schema.TaggedErrorClass<InvalidAnswerError>()(
  'InvalidAnswerError',
  { message: Schema.String },
) {}

export class MissingRoundError extends Schema.TaggedErrorClass<MissingRoundError>()(
  'MissingRoundError',
  {},
) {}

export interface StateRepositoryService {
  readonly postRound: (
    sessionId: SessionId,
    round: RoundType,
  ) => Effect.Effect<RoundType, RepositoryReadError>
  readonly getRound: (
    sessionId: SessionId,
  ) => Effect.Effect<Option.Option<RoundType>, RepositoryReadError>
  readonly postAnswer: (
    answer: SessionAnswer,
  ) => Effect.Effect<AnswerType, RepositoryReadError | InvalidAnswerError | MissingRoundError>
  readonly getAnswer: (
    sessionId: SessionId,
  ) => Effect.Effect<Option.Option<AnswerType>, RepositoryReadError>
  readonly getInbox: Effect.Effect<InboxType, RepositoryReadError>
  readonly reset: (sessionId: SessionId) => Effect.Effect<void, PlatformError.PlatformError>
}

export class StateRepository extends Context.Service<StateRepository, StateRepositoryService>()(
  '@grill/StateRepository',
) {}

export const makeStateRepositoryLayer = (stateDirectory: string) =>
  Layer.effect(
    StateRepository,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const sessionsDirectory = join(stateDirectory, 'sessions')

      const sessionDirectory = (sessionId: SessionId): string =>
        join(sessionsDirectory, sessionDirectoryKey(sessionId))

      const readJson = Effect.fn('StateRepository.readJson')(function* <
        SchemaType extends Schema.ConstraintCodec<unknown>,
      >(path: string, schema: SchemaType) {
        const maybeContents = yield* fileSystem.readFileString(path).pipe(
          Effect.map(Option.some),
          Effect.catchIf(isMissingFileError, () => Effect.succeed(Option.none())),
        )
        if (Option.isNone(maybeContents)) {
          return Option.none<SchemaType['Type']>()
        }
        const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
          maybeContents.value,
        )
        return Option.some(decoded)
      })

      const writeJson = Effect.fn('StateRepository.writeJson')(function* <
        SchemaType extends Schema.ConstraintCodec<unknown>,
      >(path: string, schema: SchemaType, value: SchemaType['Type']) {
        const directory = dirname(path)
        yield* fileSystem.makeDirectory(directory, { recursive: true })
        const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
        const encoded = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(schema))(value)
        yield* fileSystem.writeFileString(temporaryPath, `${encoded}\n`)
        yield* fileSystem.rename(temporaryPath, path)
      })

      const getRound = Effect.fn('StateRepository.getRound')(function* (sessionId: SessionId) {
        return yield* readJson(join(sessionDirectory(sessionId), 'round.json'), Round)
      })

      const validateAnswer = Effect.fn('StateRepository.validateAnswer')(function* (
        round: RoundType,
        answer: AnswerType,
      ) {
        if (answer.roundId !== round.roundId) {
          return yield* new InvalidAnswerError({
            message: 'The answer belongs to a different round.',
          })
        }
        const expectedIds = new Set(round.questions.map(question => question.id))
        const answerIds = Object.keys(answer.answers)
        if (
          answerIds.length !== expectedIds.size ||
          answerIds.some(questionId => !expectedIds.has(questionId))
        ) {
          return yield* new InvalidAnswerError({
            message: 'Every question must be answered exactly once.',
          })
        }

        for (const question of round.questions) {
          const questionAnswer = answer.answers[question.id]
          if (questionAnswer === undefined) {
            return yield* new InvalidAnswerError({
              message: `Missing answer for ${question.id}.`,
            })
          }
          const hasOther =
            questionAnswer.other !== undefined &&
            questionAnswer.other !== null &&
            questionAnswer.other.trim() !== ''
          if (hasOther && question.allowOther === false) {
            return yield* new InvalidAnswerError({
              message: `Other is not allowed for ${question.id}.`,
            })
          }
          if (
            questionAnswer.notes !== undefined &&
            questionAnswer.notes !== null &&
            question.allowNotes === false
          ) {
            return yield* new InvalidAnswerError({
              message: `Notes are not allowed for ${question.id}.`,
            })
          }
          if (
            questionAnswer.selected.some(
              label => !question.options.some(option => option.label === label),
            )
          ) {
            return yield* new InvalidAnswerError({
              message: `Unknown option for ${question.id}.`,
            })
          }
          if (new Set(questionAnswer.selected).size !== questionAnswer.selected.length) {
            return yield* new InvalidAnswerError({
              message: `Duplicate option for ${question.id}.`,
            })
          }
          if (question.multiSelect !== true && questionAnswer.selected.length > 1) {
            return yield* new InvalidAnswerError({
              message: `Only one option is allowed for ${question.id}.`,
            })
          }
          if (questionAnswer.selected.length === 0 && !hasOther) {
            return yield* new InvalidAnswerError({
              message: `An answer is required for ${question.id}.`,
            })
          }
        }
        return undefined
      })

      const postRound = Effect.fn('StateRepository.postRound')(function* (
        sessionId: SessionId,
        round: RoundType,
      ) {
        const directory = sessionDirectory(sessionId)
        yield* fileSystem.makeDirectory(directory, { recursive: true })
        yield* writeJson(join(directory, 'session.json'), StoredSession, { sessionId })
        yield* writeJson(join(directory, 'round.json'), Round, round)
        yield* fileSystem.remove(join(directory, 'answer.json'), { force: true })
        return round
      })

      const postAnswer = Effect.fn('StateRepository.postAnswer')(function* (answer: SessionAnswer) {
        const maybeRound = yield* getRound(answer.sessionId)
        const round = yield* Effect.fromOption(maybeRound, () => new MissingRoundError())
        yield* validateAnswer(round, answer)
        const submitted = yield* Schema.decodeUnknownEffect(Answer)({
          ...answer,
          submittedAt: answer.submittedAt ?? new Date().toISOString(),
        })
        yield* writeJson(join(sessionDirectory(answer.sessionId), 'answer.json'), Answer, submitted)
        return submitted
      })

      const getAnswer = Effect.fn('StateRepository.getAnswer')(function* (sessionId: SessionId) {
        return yield* readJson(join(sessionDirectory(sessionId), 'answer.json'), Answer)
      })

      const getInbox = Effect.gen(function* () {
        const directoryNames = yield* fileSystem
          .readDirectory(sessionsDirectory)
          .pipe(Effect.catchIf(isMissingFileError, () => Effect.succeed([])))
        const maybeRows = yield* Effect.forEach(
          directoryNames,
          directoryName =>
            Effect.gen(function* () {
              const directory = join(sessionsDirectory, directoryName)
              const storedSession = yield* readJson(join(directory, 'session.json'), StoredSession)
              const round = yield* readJson(join(directory, 'round.json'), Round)
              if (Option.isNone(storedSession) || Option.isNone(round)) {
                return Option.none()
              }
              const answer = yield* readJson(join(directory, 'answer.json'), Answer)
              const row = yield* Schema.decodeUnknownEffect(SessionRow)({
                sessionId: storedSession.value.sessionId,
                roundId: round.value.roundId,
                title: round.value.title ?? `Round ${round.value.roundId}`,
                count: round.value.questions.length,
                answered: Option.isSome(answer) && answer.value.roundId === round.value.roundId,
              })
              return Option.some(row)
            }),
          { concurrency: 'unbounded' },
        )
        const sessions = Arr.getSomes(maybeRows).sort(
          (left, right) =>
            Number(left.answered) - Number(right.answered) ||
            left.sessionId.localeCompare(right.sessionId),
        )
        return yield* Schema.decodeUnknownEffect(Inbox)({ sessions })
      }).pipe(Effect.withSpan('StateRepository.getInbox'))

      const reset = Effect.fn('StateRepository.reset')(function* (sessionId: SessionId) {
        yield* fileSystem.remove(sessionDirectory(sessionId), {
          recursive: true,
          force: true,
        })
      })

      return StateRepository.of({
        postRound,
        getRound,
        postAnswer,
        getAnswer,
        getInbox,
        reset,
      })
    }),
  )
