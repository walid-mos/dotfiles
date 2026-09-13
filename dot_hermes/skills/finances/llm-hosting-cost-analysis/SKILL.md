---
name: llm-hosting-cost-analysis
description: Use when estimating hourly costs for self-hosted LLMs.
---

# LLM hosting cost analysis

Estimate the cost of replacing an API or subscription model with a dedicated or autoscaling self-hosted deployment. Keep token economics separate from hourly infrastructure economics.

## Core workflow

1. **Fix the comparison boundary**
   - Identify the observed usage period and include all relevant parent and child/agent sessions.
   - State whether the counterfactual replaces every model call or only calls to one model.
   - Preserve the requested model and precision. Do not silently substitute a smaller or more aggressively quantized model.

2. **Measure activity from source traces**
   - Count sessions, assistant/model responses, and the earliest/latest timestamps.
   - For event logs that record both request-start and response-end timestamps, build one inference interval per response.
   - Report both:
     - **summed request-hours**, which preserves concurrent demand; and
     - **union request-hours**, which represents the theoretical single-replica wall-clock floor.
   - Merge intervals programmatically. Never add or deduplicate them mentally.

3. **Size the deployment from current authoritative sources**
   - Verify total parameters, active parameters, checkpoint precision/size, runtime overhead, KV-cache needs, and a known-working serving topology.
   - Weight size is governed by total parameters, not only MoE active parameters.
   - Prefer a documented, known-working topology over a merely arithmetically possible GPU count.
   - Treat community quantizations or experimental runtimes as separate alternatives, not the baseline.

4. **Fetch current hourly pricing and billing semantics**
   - Use the provider's official pricing and autoscaling documentation.
   - Convert per-minute prices to hourly rates explicitly when needed.
   - Confirm whether startup/loading, deployment, scaling, idle delay, and each replica are billable.
   - Verify the default scale-down delay rather than assuming immediate scale-to-zero.

5. **Construct cost scenarios**
   Calculate at least:
   - theoretical inference-only floor;
   - aggressive scale-to-zero with a stated idle tail;
   - provider-default autoscaling;
   - always-warm cost for the observation period.

   For each scenario, merge `[request_start, request_end + idle_tail]` intervals before multiplying by the full replica rate. The baseline formula is:

   `cost = merged_billable_hours × GPUs_per_replica × price_per_GPU_hour × replicas_needed`

   If throughput and batching benchmarks are unavailable, do not claim that one replica reproduces observed concurrent latency. Label the one-replica result as a capacity assumption or lower bound.

6. **Account for unknowns honestly**
   - Cold-start/model-loading time can materially affect very large checkpoints. If it is billed but absent from source traces, state that the estimate excludes it and is therefore a lower bound.
   - Do not infer equivalent latency merely because the model fits in VRAM.
   - Avoid currency conversion unless requested; it introduces another current-rate dependency.

## Output shape

Lead with one decision-useful estimate and its configuration. Follow with a compact scenario table containing billable hours and cost. Then give the main caveats: cold starts, replica concurrency/throughput, and any non-equivalent quantization.

Always include:
- observation period;
- source-log coverage;
- assumed hardware topology and precision;
- complete hourly replica rate;
- autoscaling delay;
- whether the estimate is a floor, a realistic baseline, or an upper bound;
- links to authoritative pricing/model sources.

## Pitfalls

- Do not multiply elapsed calendar time by the GPU rate unless the deployment is explicitly always warm.
- Do not treat summed concurrent request durations as single-replica uptime; also compute their union.
- Do not use API token prices when the user requested dedicated hourly pricing.
- Do not claim an exact self-hosting cost from traces that lack cold-start and server-side batching data.
- Do not recommend a topology solely because checkpoint bytes fit nominal aggregate VRAM; reserve overhead and KV-cache headroom.

## Supporting material

- `references/pi-baseten-glm53.md` records the validated Pi JSONL timing method and the GLM‑5.3‑Flash/Baseten case used to establish this workflow.
- `scripts/pi_usage_intervals.py` deterministically computes request and idle-tail interval totals from Pi session JSONL files.
