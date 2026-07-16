# spec_consistency review #6

status: needs_changes

1. Migration preservation was enumerated too narrowly in Architecture and described only as undefined lifecycle fields in Spec/Test Plan; exact preservation must cover every already-present semantic value, including identity/binding and non-default stop/control fields.
2. `source_fallback` migration must require the existing authority kind and bootstrap fingerprint to pass normal validation; missing or mismatched fingerprints remain nonmutating errors.
