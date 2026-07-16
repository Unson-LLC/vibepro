# spec_consistency review

status: needs_changes

Prior findings are resolved. One remaining high-severity finding: a newly attempted preferred-mode managed bootstrap can persist unavailable legacy metadata and then create a source-authoritative fallback Run, but subsequent read precedence is undefined. Define an explicit source-fallback authority binding for that Run which takes precedence over the matched failed bootstrap record, and cover process restart plus status/watch/resume/cancel/repair.
