import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
} from "@effect/platform";
import { Data, Effect, Schedule, Schema } from "effect";
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

class EmptyPlaylistError extends Data.TaggedError("EmptyPlaylistError")<{
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

const getCachedPlaylist = (kv: KVNamespace) =>
  Effect.gen(function* () {
    yield* Effect.log("Attempting to get cached playlist");

    const kvService = yield* KVService;
    const cached = yield* kvService.getJsonFromKV<PlaylistResponse>(
      kv,
      PLAYLIST_CACHE_KEY,
    );

    const validCache = yield* Effect.fromNullable(cached).pipe(
      Effect.tapError(() => Effect.log("No cached playlist found")),
    );

    const parsedCache = yield* Schema.decodeUnknown(PlaylistResponse)(
      validCache,
    ).pipe(
      Effect.tap(() => Effect.log("Cache was valid, returning")),
      Effect.tapError((ParseError) =>
        Effect.logError(`${ParseError._tag}: Cache was invalid`),
      ),
    );

    return parsedCache;
  });

const storePlaylistInCache = (kv: KVNamespace, playlist: PlaylistResponse) =>
  Effect.gen(function* () {
    const kvService = yield* KVService;
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

const validatePlaylist = (playlist: PlaylistResponse) =>
  playlist.tracks.length === 0
    ? Effect.fail(new EmptyPlaylistError({ message: "Playlist is empty" }))
    : Effect.succeed(playlist);

export const getPlaylist = (kv: KVNamespace, endpoint: string) =>
  getCachedPlaylist(kv).pipe(
    Effect.orElse(() =>
      fetchPlaylist(endpoint).pipe(
        Effect.timeout("4 seconds"),
        Effect.retry(
          Schedule.exponential(1000).pipe(Schedule.compose(Schedule.recurs(2))),
        ),
        Effect.andThen((playlist) => storePlaylistInCache(kv, playlist)),
      ),
    ),
    Effect.andThen(validatePlaylist),
    Effect.tap((playlist) =>
      Effect.log(`Got ${playlist.tracks.length} tracks`),
    ),
  );
