import { Data, Effect } from "effect";

class KVGetError extends Data.TaggedError("KVGetError")<{
  message: string;
}> {}

class KVPutError extends Data.TaggedError("KVPutError")<{
  message: string;
}> {}

const getJsonFromKV = <T>(kv: KVNamespace, key: string) =>
  Effect.tryPromise({
    try: () => kv.get(key, "json") as Promise<T | null>,
    catch: (error) =>
      new KVGetError({ message: `Failed to get key ${key} (${error})` }),
  });

const storeInKV = (
  kv: KVNamespace,
  key: string,
  value: string,
  options?: KVNamespacePutOptions,
) =>
  Effect.tryPromise({
    try: () => kv.put(key, value, options),
    catch: (error) =>
      new KVPutError({
        message: `Failed to put key ${key} (${error})`,
      }),
  });

export class KVService extends Effect.Service<KVService>()("KVService", {
  effect: Effect.succeed({
    getJsonFromKV,
    storeInKV,
  } as const),
}) {}
