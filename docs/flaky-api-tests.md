# Intermittent `apps/api` test failures

Status as of 2026-09-15: **partly fixed, root cause of the main symptom not
found.** Written down so the next attempt starts from the evidence instead of
re-deriving it.

## It was never three specific suites

The working belief was that three suites were flaky:
`security-hardening-misc`, `admin-console.integration`, and
`stripe-webhooks-checkout`. That is not what the evidence shows. Across ~60
full runs, failures landed on **ten different suites** — `campaigns`,
`billing`, `sso`, `pos/tickets.integration`, `gift-cards.security`,
`users.integration`, `search.integration`, `scanner-pause`,
`admin-console.integration` and others — one suite per failing run, chosen
apparently at random. `stripe-webhooks-checkout` never failed once.

Any fix aimed at three named files would have been aimed at nothing.

## Two distinct failure modes

**1. `Exceeded timeout of 5000 ms` — fixed.**

Jest's default per-test budget is 5000ms. Under a 48-worker run on 8 cores, 23
tests take over 1s and five take over 3s — not hanging, just doing real work.
The rate-limit test in `security-hardening-misc` makes **101 sequential HTTP
round trips** because it has to exceed a cap of 100. At 3.0-3.2s measured,
those tests sit within scheduling jitter of the deadline, and the unluckiest
one fails.

`index.test.ts` and `voice-pipeline.integration.test.ts` had already been
given their own `jest.setTimeout` values — the same problem, patched one file
at a time as each became painful. Fixed globally with `testTimeout: 30_000` in
`jest.config.ts`; per-file overrides still win where they are set.

**2. `socket hang up` (ECONNRESET) — NOT fixed, cause unknown.**

The dominant symptom. Measured at roughly 1 run in 7 at CI-like parallelism.
Confirmed via an instrumented run as `req error ECONNRESET socket hang up`:
the ephemeral supertest server closed the connection without responding.

It is **not** the 5s deadline — `admin-console.integration` produced one in a
5.4s suite against a 30s timeout.

## Ruled out, with evidence

Do not re-investigate these without new information.

| Hypothesis                                      | How it was eliminated                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The `request(makeApp())` pattern itself         | Standalone repro: 38,400 requests across 48 parallel processes, **0** hangups                                                                                                                          |
| Ephemeral port churn / collisions               | Same repro, 48 concurrent processes, 0 failures                                                                                                                                                        |
| Ephemeral port exhaustion or TIME_WAIT reuse    | Peak TIME_WAIT during a full run: **1,419** of ~16,384 ports (9%)                                                                                                                                      |
| Keep-alive socket pooling on `http.globalAgent` | superagent sets `this._agent = false` by default (`lib/node/index.js:162`, passed at `:736`), so it never uses `globalAgent`. Setting `globalAgent.keepAlive = false` changed nothing and was reverted |
| Unhandled promise rejections killing a worker   | `process.on('unhandledRejection'/'uncaughtException')` probe across 6 full runs: **0** events. Jest reported no worker crashes                                                                         |
| CPU starvation alone                            | The suite run 30× in a loop against 16 busy CPU-burner processes: **0** failures. It needs the full multi-worker run, not just load                                                                    |

## Where to look next

The failure needs many concurrent Jest **workers**, not merely a loaded CPU,
and it is an ECONNRESET from a server that supertest created and owns. The
architectural smell is that roughly 2,000 tests each stand up and tear down
their own HTTP server. Reusing one server per test file would remove the churn
entirely, but it is a large refactor across hundreds of call sites and should
be a deliberate decision rather than a debugging step.

## Reproducing

```bash
cd apps/api
for i in $(seq 1 15); do
  NODE_OPTIONS=--experimental-vm-modules npx jest --forceExit > /tmp/run$i.log 2>&1
  grep -qE "^FAIL " /tmp/run$i.log && echo "run$i FAILED"
done
```

Expect roughly one or two failures in fifteen, on an unpredictable suite.
