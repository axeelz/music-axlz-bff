import crypto from "node:crypto";
import { Data, Effect, Schema } from "effect";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { QUEUE_COOKIE_MAX_AGE, QUEUE_COOKIE_NAME } from "../utils/constants";
import type { Track } from "./playlist";

export class QueueParseError extends Data.TaggedError("QueueParseError") {}

export class QueueSaveError extends Data.TaggedError("QueueSaveError")<{
  message: string;
}> {}

const ShuffleQueue = Schema.Struct({
  playlistHash: Schema.String,
  shuffledIndexes: Schema.Array(Schema.NonNegativeInt),
  currentIndex: Schema.NonNegativeInt,
});
type ShuffleQueue = Schema.Schema.Type<typeof ShuffleQueue>;

const createPlaylistHash = (tracks: readonly Track[]) => {
  const trackData = tracks.map((t) => `${t.uri}:${t.title}`).join("|");
  return crypto
    .createHash("sha256")
    .update(trackData)
    .digest("hex")
    .substring(0, 16);
};

const shuffleArray = (length: number): number[] => {
  const indexes = Array.from({ length }, (_, i) => i);
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes;
};

const loadQueue = (c: Context) =>
  Effect.fromNullable(getCookie(c, QUEUE_COOKIE_NAME)).pipe(
    Effect.andThen((cookieValue) =>
      Effect.try({
        try: () =>
          Schema.decodeUnknownSync(ShuffleQueue)(JSON.parse(cookieValue)),
        catch: () => new QueueParseError(),
      }),
    ),
    Effect.tapError((error) => Effect.log(`Invalid cookie: ${error._tag}`)),
    Effect.orElse(() => Effect.succeed(null)),
  );

const saveQueue = (c: Context, queue: ShuffleQueue) =>
  Schema.encode(ShuffleQueue)(queue).pipe(
    Effect.mapError(
      (error) => new QueueSaveError({ message: `[encode] (${error})` }),
    ),
    Effect.andThen((encoded) =>
      Effect.try({
        try: () =>
          setCookie(c, QUEUE_COOKIE_NAME, JSON.stringify(encoded), {
            maxAge: QUEUE_COOKIE_MAX_AGE,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          }),
        catch: (error) =>
          new QueueSaveError({ message: `[setCookie] (${error})` }),
      }),
    ),
    Effect.tapError((error) =>
      Effect.logError(`Failed to save queue: ${error.message}`),
    ),
  );

const getOrCreateQueue = (
  playlistHash: string,
  tracksLength: number,
  existingQueue: ShuffleQueue | null,
) =>
  !existingQueue || existingQueue.playlistHash !== playlistHash
    ? Effect.succeed({
        playlistHash,
        shuffledIndexes: shuffleArray(tracksLength),
        currentIndex: 0,
      } satisfies ShuffleQueue).pipe(
        Effect.tap(() => Effect.log("Created new shuffle queue")),
      )
    : Effect.succeed(existingQueue);

const getNextTrack = (tracks: readonly Track[], queue: ShuffleQueue) =>
  Effect.gen(function* () {
    if (queue.currentIndex >= queue.shuffledIndexes.length) {
      yield* Effect.log("Queue is exhausted, reshuffling tracks");
      const shuffledIndexes = shuffleArray(tracks.length);
      return {
        track: tracks[shuffledIndexes[0]],
        updatedQueue: {
          ...queue,
          shuffledIndexes,
          currentIndex: 1,
        } satisfies ShuffleQueue,
      };
    }

    const trackIndex = queue.shuffledIndexes[queue.currentIndex];
    return {
      track: yield* Effect.fromNullable(tracks[trackIndex]),
      updatedQueue: { ...queue, currentIndex: queue.currentIndex + 1 },
    };
  });

export const getShuffledTrack = (tracks: readonly Track[], c: Context) =>
  Effect.gen(function* () {
    const playlistHash = createPlaylistHash(tracks);
    const existingQueue = yield* loadQueue(c);

    const queue = yield* getOrCreateQueue(
      playlistHash,
      tracks.length,
      existingQueue,
    );
    const { track, updatedQueue } = yield* getNextTrack(tracks, queue);

    yield* saveQueue(c, updatedQueue);

    return {
      ...track,
      queueStatus: `${updatedQueue.currentIndex}/${updatedQueue.shuffledIndexes.length}`,
    };
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`${error._tag}: falling back to random`);
        yield* Effect.sync(() => deleteCookie(c, QUEUE_COOKIE_NAME));
        const randomIndex = crypto.randomInt(tracks.length);
        return tracks[randomIndex];
      }),
    ),
  );
