# Edge-runtime boot proof

Proven 25 Sep 2026 21:07 (Sydney) on Supabase CLI 2.116.0, Colima Docker: the seam function boots inside the real Supabase edge runtime and answers on the stub provider with no vendor key.

```
{"ok":true,"said":"nineteen at Tuggerah","label":"count","object":{"label":"count","confident":true},"provider":"stub","model":"stub-fast","usd":0,"runtime":"deno"}
```

Two facts every Deno consumer must know:

1. The edge runtime container mounts only `supabase/functions`. A relative import that leaves that directory (`../../../src`) fails with `Module not found` at worker boot. Vendor the package source under `supabase/functions/_vendor/ai` and point the import map at it. `_vendor/` is gitignored here; consumers commit their vendored copy pinned to a sha.
2. `@dlusn/ai` is a private GitHub repo, so `npm:` and `jsr:` specifiers cannot reach it. The vendoring step is the install for Deno. Node consumers keep `github:dlusn/ai#<sha>`.

Run it:

```
cd fixtures
rm -rf supabase/functions/_vendor/ai && mkdir -p supabase/functions/_vendor && cp -R ../src supabase/functions/_vendor/ai
supabase start -x studio,imgproxy,inbucket,mailpit,logflare,vector,analytics,realtime,storage-api,storage,pgbouncer,pooler,edge-runtime
supabase functions serve seam --no-verify-jwt --env-file supabase/.env.boot
curl -s -X POST http://127.0.0.1:54321/functions/v1/seam -H 'content-type: application/json' -d '{"text":"nineteen at Tuggerah"}'
supabase stop
```
