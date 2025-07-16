import { Effect } from "effect";
import type { Track } from "../services/playlist";

export const formatTrackArtists = (track: Track) =>
  Effect.succeed({
    ...track,
    artist:
      track.artists.length <= 2
        ? track.artists.join(" & ")
        : `${track.artists.slice(0, -1).join(", ")} & ${track.artists.at(-1)}`,
  });

export const toErrorResponse = (error: { _tag: string; message: string }) => ({
  error: error._tag,
  message: error.message,
});
