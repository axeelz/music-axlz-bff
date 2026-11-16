# music-axlz-bff

Cloudflare Worker serving a shuffled track from a playlist for [axeelz.com](https://axeelz.com). The playlist is cached in KV, the shuffle queue lives in a cookie.

```sh
bun install
echo "SERVICE_URL=<playlist endpoint>" > .env
bun dev
```

`bun run cf-typegen` after changing `wrangler.jsonc`.
