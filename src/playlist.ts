import { Effect, Schedule, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

const CACHE_KEY = "playlist";

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
export type Track = typeof Track.Type;

// non-empty so an empty upstream response is never cached
const Playlist = Schema.Struct({ tracks: Schema.NonEmptyArray(Track) });
type Playlist = typeof Playlist.Type;

const fromCache = (kv: KVNamespace) =>
  Effect.tryPromise(() => kv.get(CACHE_KEY, "json")).pipe(
    Effect.flatMap(Effect.fromNullishOr),
    Effect.flatMap(Schema.decodeUnknownEffect(Playlist)),
  );

const fromUpstream = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Playlist)),
    Effect.timeout("4 seconds"),
    Effect.retry({ schedule: Schedule.exponential("1 second"), times: 2 }),
    Effect.provide(FetchHttpClient.layer),
  );

const saveToCache = (kv: KVNamespace, playlist: Playlist) =>
  Effect.tryPromise(() =>
    kv.put(CACHE_KEY, JSON.stringify(playlist), { expirationTtl: 3600 }),
  ).pipe(Effect.ignore({ log: "Warn" }));

export const getPlaylist = (env: CloudflareBindings) =>
  fromCache(env.music_axlz).pipe(
    Effect.catch((error) =>
      Effect.log(`Cache miss (${error._tag}), fetching upstream`).pipe(
        Effect.andThen(fromUpstream(env.SERVICE_URL)),
        Effect.tap((playlist) => saveToCache(env.music_axlz, playlist)),
      ),
    ),
    Effect.tap(({ tracks }) => Effect.log(`Got ${tracks.length} tracks`)),
  );
