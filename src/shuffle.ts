import { Hash, Option, Schema } from "effect";

const Index = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

// remaining track indexes for the current shuffle cycle
export const Queue = Schema.fromJsonString(
  Schema.Struct({ hash: Schema.Number, remaining: Schema.UniqueArray(Index) }),
);
type Queue = typeof Queue.Type;

const shuffle = (length: number) => {
  const indexes = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes;
};

export const nextTrack = <T extends { uri: string }>(
  tracks: readonly [T, ...T[]],
  saved: Option.Option<Queue>,
) => {
  const hash = Hash.string(tracks.map((t) => t.uri).join("|"));
  const [index, ...remaining] = Option.match(saved, {
    onSome: (q) =>
      q.hash === hash && q.remaining.length > 0 && q.remaining.every((i) => i < tracks.length)
        ? q.remaining
        : shuffle(tracks.length),
    onNone: () => shuffle(tracks.length),
  });
  return {
    track: tracks[index],
    queue: { hash, remaining },
    status: `${tracks.length - remaining.length}/${tracks.length}`,
  };
};
