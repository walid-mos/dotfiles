# Pi → Baseten GLM‑5.3‑Flash reference case

## Pi trace schema observed

Pi sessions were stored recursively under `~/.pi/agent/sessions/**/*.jsonl`.

Relevant assistant message event fields:

- outer event `timestamp`: response completion time in ISO 8601;
- `message.timestamp`: request/start time in Unix milliseconds;
- `message.role == "assistant"` identifies model responses;
- `message.provider`, `message.model`, and `message.usage` provide attribution and token accounting.

Nested `run-*/session.jsonl` files represent agent/subagent activity and must be included when the replacement assumption covers all Pi usage.

The validated method parsed every JSONL line, formed `[message.timestamp, event.timestamp]` intervals for assistant responses, rejected negative or implausibly long intervals, and merged intervals programmatically. Extending every response end by an idle-tail duration before merging models scale-to-zero billing.

## Case measurements (2026-09-04)

Observation window: 2026-08-09 11:02:22Z through 2026-09-04 15:04:34Z.

- 810 session files with timestamps
- 26,022 assistant/model calls
- 99.964 summed inference-hours
- 70.543 union inference-hours
- 106.7234 union hours with a 5-minute idle tail
- 128.1437 union hours with a 15-minute idle tail
- 391.3212 union hours across full session spans

The user requested a counterfactual where every Pi call was GLM‑5.3‑Flash, irrespective of the actual provider/model mix.

## Hardware and pricing basis

Authoritative Z.AI documentation described GLM‑5.3‑Flash as 320B total parameters, 18B active, with a 1M context window. Total checkpoint size and KV/runtime headroom—not the 18B active count—control VRAM sizing.

A known-working FP8 serving topology used 8× H100 80GB. This was selected as the baseline instead of an experimental low-bit quantization. Baseten supports multi-GPU H100 instances and prices each GPU linearly.

Baseten Basic list pricing used in the case:

- H100 80GB: $0.10833/minute ≈ $6.50/hour
- 8× H100 replica: $52/hour
- default minimum replicas: 0
- default scale-down delay: 900 seconds
- startup/loading time is billable

At 128.1437 merged billable hours, the baseline result was `$6,663.47` before unobserved cold-start/loading overhead. A 30-day linear extrapolation at the same activity rate was about `$7,639/month`.

## Interpretation warning

The merged one-replica estimate assumes the 8× H100 server can absorb observed concurrency without needing additional replicas or increasing latency. Summed request-hours expose concurrent demand, but exact replica count requires serving benchmarks for the model, context distribution, output lengths, and batching configuration. Therefore the baseline is decision-useful but not an exact capacity plan.

## Sources used

- Baseten pricing: https://www.baseten.co/pricing/
- Baseten autoscaling: https://docs.baseten.co/deployment/autoscaling/overview
- Baseten resources: https://docs.baseten.co/deployment/resources
- Z.AI model overview: https://docs.z.ai/guides/vlm/glm-5.3-flash
- Model repository: https://huggingface.co/zai-org/GLM-5.3-Flash
