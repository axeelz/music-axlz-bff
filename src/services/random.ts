import crypto from "node:crypto";
import { Data, Effect } from "effect";
import { LAST_TRACK_URI_CACHE_KEY } from "../utils/constants";
import { KVService } from "./kv";
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

const filterAvailableTracks = (
  tracks: readonly Track[],
  lastTrackUri: string | null,
) =>
  Effect.gen(function* () {
    const availableTracks = lastTrackUri
      ? tracks.filter((track) => track.uri !== lastTrackUri)
      : tracks;
    return availableTracks.length > 0 ? availableTracks : tracks;
  });

const generateRandomIndex = (maxLength: number) =>
  Effect.sync(() => crypto.randomInt(maxLength));

export const getRandomTrack = (kv: KVNamespace, tracks: readonly Track[]) =>
  Effect.gen(function* () {
    const kvService = yield* KVService;

    const lastTrackUri = yield* kvService.getTextFromKV(
      kv,
      LAST_TRACK_URI_CACHE_KEY,
    );
    const validatedTracks = yield* validateTracks(tracks);

    const availableTracks = yield* filterAvailableTracks(
      validatedTracks,
      lastTrackUri,
    );

    const randomIndex = yield* generateRandomIndex(availableTracks.length);
    const track = availableTracks[randomIndex];

    yield* kvService.storeInKV(kv, LAST_TRACK_URI_CACHE_KEY, track.uri);

    return track;
  });
