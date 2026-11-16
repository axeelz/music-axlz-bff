import { Effect, Schema } from "effect";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { getPlaylist, type Track } from "./playlist";
import { nextTrack, Queue } from "./shuffle";

const QUEUE_COOKIE = "shuffle_queue";

const formatArtists = ({ artists }: Track) =>
  artists.length <= 2
    ? artists.join(" & ")
    : `${artists.slice(0, -1).join(", ")} & ${artists.at(-1)}`;

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(
  cors({
    origin: [
      "https://axeelz.com",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    credentials: true,
  }),
);

app.get("/", (c) =>
  getPlaylist(c.env).pipe(
    Effect.map(({ tracks }) => {
      const saved = Schema.decodeUnknownOption(Queue)(
        getCookie(c, QUEUE_COOKIE),
      );
      const { track, queue, status } = nextTrack(tracks, saved);
      setCookie(c, QUEUE_COOKIE, Schema.encodeSync(Queue)(queue), {
        maxAge: 3600,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      });
      return { ...track, artist: formatArtists(track), queueStatus: status };
    }),
    Effect.tap(({ queueStatus }) => Effect.log(`Queue status: ${queueStatus}`)),
    Effect.tapError(Effect.logError),
    Effect.match({
      onFailure: (error) =>
        c.json({ error: error._tag, message: error.message }, 500),
      onSuccess: (track) => c.json(track),
    }),
    Effect.runPromise,
  ),
);

export default app;
