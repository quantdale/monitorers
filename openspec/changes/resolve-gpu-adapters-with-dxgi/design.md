## Context

See proposal/evidence for the observed software-renderer mislabel. GPU counter handles already live on the collector thread; their rates and history cadence must remain unchanged. Existing keys are the low LUID half. Names feed both profile presentation and conservative Nvidia matching, so fabricated labels affect optional telemetry as well as card counts.

## Goals / Non-Goals

Use authoritative adapter metadata, exclude proven software devices, retain unknown devices when metadata is unavailable, and preserve existing layouts. No provider broadcast, telemetry guessing, new per-tick OS enumeration, mutex I/O, framework change or payload shape change.

## Decisions

1. A typed DXGI adapter catalog owns physical captions and known software keys. Enumerate with windows-rs CreateDXGIFactory1/EnumAdapters1/GetDesc1 on the background thread. RAII releases COM interfaces; every unsafe call has a safety argument. Remove the unrelated WMI positional caption join entirely. Enrichment no longer depends on WMI bootstrap.
2. Cache the catalog for ten seconds and replace it on successful refresh, so removed adapters can disappear and corrected labels can converge. On transient enumeration failure retain the last good catalog (or an empty failed-attempt cache), keeping retries bounded. Unknown PDH keys are shown with an explicit GPU-key label; known software keys are excluded. A pure merge keeps zero-utilization physical devices, deterministic duplicate-name suffixes and stable per-key channels.
3. Canonicalize both LUID halves. Preserve the existing `0xLOW` key when the high part is zero; use `0xHIGH_0xLOW` otherwise. This fixes high-part collisions without moving ordinary existing identities. At the frontend reconcile unique legacy low-part aliases in dashboard order/visibility and sidebar order, using the same ambiguity rule as legacy name slugs. Unresolvable aliases remain orphan entries; never pick by array order. Persist a migration even if no new card is appended (the current initializer misses this migration-only write).
4. Keep Nvidia's exact/unique-name matching fail-closed. Removing the fabricated renderer restores the real single Nvidia name; it does not authorize mapping identical physical cards by position. Sort duplicate labels by stable key before suffixing so they cannot swap with HashMap iteration.
5. Preserve the current dashboard and tokens. The existing Refero lock supplies presentation; OS identity evidence governs this correction. No new component or media treatment is warranted.
6. Carry successful catalog confirmation separately from an unavailable empty result into the internal RawPoll. A confirmed empty inventory advances the existing ghost grace period, including the final GPU; failed PDH or unconfirmed metadata cannot erase channels. Historical hex casing is matched only for syntactically valid LUID aliases, retaining case-sensitive arbitrary IDs. Profile metadata can promote from Unknown when later snapshots acquire exact captions.

## Risks / Trade-offs

- DXGI can fail or return incomplete metadata → retain the previous catalog and conservative unknown-key fallback; never return positional WMI guesses.
- Software counter keys can linger → keep software identities in the catalog so they are deliberately filtered and do not trigger a hot retry loop.
- New key format could reset rare nonzero-high-part layouts → unique alias migration for order, hidden IDs and sidebar; fixture coverage for ambiguity and migration-only persistence.
- Refresh work could affect polling → bounded cadence, real startup/cadence probe and all feature matrices. Never perform enumeration under a history lock.
- Identical physical Nvidia devices remain unqualified on this host → preserve unavailable ambiguous telemetry and report the hardware limit separately.

## Migration Plan

No persisted schema or payload shape changes. Existing zero-high-part IDs stay byte-identical. Save reconciled legacy aliases only when they change and retain unresolved ghost IDs. Standard executable rollout; rollback restores the prior collector but cannot be promoted as fixing the observed caption defect. No user data reset.
