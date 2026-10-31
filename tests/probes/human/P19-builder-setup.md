# P19: builder setup

Uses the B-old checkout from Task 2. About 6 minutes.

## Part 1: `--plugin-dir` beside the same-named install

This reads your real install and changes nothing. It makes one small Haiku call from a temp repo.

```sh
python3 tests/probes/human/lab.py setup P19 --b-old <path to B-old>
```

Paste the line it prints. It records and exits by itself.

```sh
python3 tests/probes/human/lab.py show P19
```

### Observe

The `plugins named pairingbuddy` section and the `hooks started` list.

### PASS

Exactly one `pairingbuddy` entry, its path is B-old and its version is 0.7.0.

FAIL: two entries, or the entry is the marketplace install. Use the fallback, and disable the marketplace plugin in the builder. INCONCLUSIVE: no entry.

If the list is clean but `hooks started` shows the same hook twice, say so.

## Part 2: `modules` on a hook-only install

No new run. This reads the P12 lab, where `pbhookonly` has only a `hooks.json` with `modules` and a shell hook.

```sh
python3 tests/probes/human/lab.py show P12
```

### PASS

`hookonly-mod.log` says `mod loaded`, and `hookonly-shell.jsonl` has lines.

FAIL: either one is missing, while `pbprobe` loaded in the same lab.

## Report back

The builder start command you will use, and part 2's result.
