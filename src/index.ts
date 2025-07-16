import { Effect, Logger } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { KVService } from "./services/kv";
import { getPlaylist } from "./services/playlist";
import { getRandomTrack } from "./services/random";
import { formatTrackArtists, toErrorResponse } from "./utils/format";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use("*", cors());

app.get("/", (c) => {
  const program = Effect.gen(function* () {
    const kv = c.env.music_axlz;
    const playlist = yield* getPlaylist(kv, c.env.SERVICE_URL).pipe(
      Effect.tap((playlist) =>
        Effect.log(`Got ${playlist.tracks.length} tracks`),
      ),
    );
    const track = yield* getRandomTrack(playlist.tracks).pipe(
      Effect.andThen(formatTrackArtists),
    );
    return track;
  });

  return Effect.runPromise(
    program.pipe(
      Effect.provide(Logger.pretty),
      Effect.provide(KVService.Default),
      Effect.match({
        onSuccess: (track) => c.json(track),
        onFailure: (error) => c.json(toErrorResponse(error), 500),
      }),
    ),
  );
});

export default app;
