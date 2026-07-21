# Gate evidence review at ba2fcfc4

Status: needs_changes.

The reviewer found that npm versions metadata could lag behind already-newer current dist-tags, allowing an older prerelease run to regress tags. The implementation was subsequently corrected at 2b57a3a7 by treating current dist-tags as a monotonic floor, with regression coverage.
