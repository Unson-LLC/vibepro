# Architecture boundary review

Status: needs_changes

The exact initial defaults and public/internal service boundary are coherent, but omitted Run selection needs directory enumeration. Add `readdir` or a narrow listing dependency to the closed artifact IO adapter so implementation does not import an undeclared filesystem capability.
