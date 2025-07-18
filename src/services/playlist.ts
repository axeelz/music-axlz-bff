import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
} from "@effect/platform";
import { Data, Effect, Either, Schedule, Schema } from "effect";
import { PLAYLIST_CACHE_KEY, PLAYLIST_CACHE_TTL } from "../utils/constants";
import { KVService } from "./kv";

const Track = Schema.Struct({
  uri: Schema.String,
  title: Schema.String,
  artist: Schema.String,
  duration: Schema.Number,
  isExplicit: Schema.Boolean,
  previewUrl: Schema.NullOr(Schema.String),
  coverUrl: Schema.String,
  artists: Schema.Array(Schema.String),
});
export type Track = Schema.Schema.Type<typeof Track>;

const PlaylistResponse = Schema.Struct({
  meta: Schema.Struct({
    embedCount: Schema.Number,
    richInfoCount: Schema.Number,
  }),
  tracks: Schema.Array(Track),
});
export type PlaylistResponse = Schema.Schema.Type<typeof PlaylistResponse>;

class PlaylistFetchError extends Data.TaggedError("PlaylistFetchError")<{
  message: string;
}> {}

class PlaylistParseError extends Data.TaggedError("PlaylistParseError")<{
  message: string;
}> {}

const fetchPlaylist = (endpoint: string) =>
  Effect.gen(function* () {
    yield* Effect.log("Fetching fresh playlist");
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(endpoint);
    const playlist = yield* HttpClientResponse.schemaBodyJson(PlaylistResponse)(
      response,
    ).pipe(
      Effect.catchTags({
        ParseError: (_ParseError) =>
          new PlaylistParseError({
            message: "Failed to parse playlist from endpoint",
          }),
        ResponseError: (_ResponseError) =>
          new PlaylistFetchError({
            message: "Failed to fetch playlist from endpoint",
          }),
      }),
    );
    return playlist;
  }).pipe(Effect.provide(FetchHttpClient.layer));

export const getPlaylist = (kv: KVNamespace, endpoint: string) =>
  Effect.gen(function* () {
    const kvService = yield* KVService;
    const cached = yield* kvService.getJsonFromKV<PlaylistResponse>(
      kv,
      PLAYLIST_CACHE_KEY,
    );

    if (cached) {
      yield* Effect.log("Attempting to return from cached playlist");
      const parsedCache = yield* Schema.decodeUnknown(PlaylistResponse)(
        cached,
      ).pipe(Effect.either);

      if (Either.isRight(parsedCache)) {
        yield* Effect.log("Cache was valid, returning");
        return parsedCache.right;
      } else {
        yield* Effect.log("Cache was invalid, failed to parse");
      }
    }

    const playlist = yield* fetchPlaylist(endpoint).pipe(
      Effect.timeout("4 seconds"),
      Effect.retry(
        Schedule.exponential(1000).pipe(Schedule.compose(Schedule.recurs(2))),
      ),
    );

    const encoded = yield* Schema.encode(PlaylistResponse)(playlist).pipe(
      Effect.mapError((_ParseError) => {
        return new PlaylistParseError({
          message: "Failed to encode playlist when storing it in cache",
        });
      }),
    );

    yield* kvService.storeInKV(
      kv,
      PLAYLIST_CACHE_KEY,
      JSON.stringify(encoded),
      {
        expirationTtl: PLAYLIST_CACHE_TTL,
      },
    );

    return playlist;
  });
