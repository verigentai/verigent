# OpenTimestamps proofs — battery version anchors

Each `<hash>.ots` is an OpenTimestamps proof over the ASCII hex string `<hash>` (no trailing
newline), where `<hash>` is a battery version's `battery_hash` from `battery-commitments.json`
history. Verify with: `ots verify <hash>.ots -f <file containing the hex string>`.

| proof | battery version |
|---|---|
| 21f3c12d…7119.ots | v1 |
| 81739a9e…1398.ots | v2 |
| 902aba2c…6352.ots | v12 |
| 3080812b…45da.ots | v13 (active, stamped 2026-07-14) |

Freshly-stamped proofs are calendar-pending until aggregated into Bitcoin (~hours); run
`ots upgrade <file>.ots` after a day to embed the final attestation. Intermediate versions
without proofs predate the stamping habit; their hashes remain committed in the battery
history JSON.
