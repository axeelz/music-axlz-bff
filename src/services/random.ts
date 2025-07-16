import crypto from "node:crypto";
import { Data, Effect } from "effect";
import type { Track } from "./playlist";

export class NoTracksError extends Data.TaggedError("NoTracksError")<{
  message: string;
}> {}

const validateTracks = (tracks: readonly Track[]) => {
  if (!tracks.length || tracks.length === 0) {
    return Effect.fail(new NoTracksError({ message: "No tracks available" }));
  }

  return Effect.succeed(tracks);
};

const generateRandomIndex = (maxLength: number) =>
  Effect.sync(() => crypto.randomInt(maxLength));

export const getRandomTrack = (tracks: readonly Track[]) =>
  Effect.gen(function* () {
    const validatedTracks = yield* validateTracks(tracks);
    const randomIndex = yield* generateRandomIndex(validatedTracks.length);

    return validatedTracks[randomIndex];
  });
