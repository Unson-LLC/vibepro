# What VibePro Is

VibePro is a local CLI for AI-assisted engineering work. It records the intent, Story, Spec, Architecture notes, verification evidence, review results, and PR readiness state that should exist before a change is shipped.

It is not a replacement for engineering judgment. It gives a senior reviewer a structured surface for deciding what still needs inspection.

VibePro is useful when:

- AI agents make changes faster than review context can be reconstructed.
- A small diff may touch a broad runtime or product surface.
- PR bodies need to stay concise while detailed evidence stays in artifacts.
- Teams need repeatable gates without making every small change expensive.

The core loop is:

1. Select or create a Story.
2. Align Architecture and Spec evidence.
3. Implement the change.
4. Record verification and review evidence.
5. Run `vibepro pr prepare`.
6. Create or merge the PR only after the gate state is reviewable.
