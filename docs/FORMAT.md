# PatchLab Format Law

`Design.version` is the schema version. Released designs are part of the product surface: a version that has been shared must continue to open in later builds.

Any breaking format change must bump `Design.version` and add the matching step to the migration chain in `src/lib/migrations.ts` in the same commit. The chain is stepwise so old designs move one version at a time before `sanitizeDesign` validates them.

Optional-additive fields do not require a version bump. `settings` and future `perform` fields follow "absent stays absent": older designs without those keys must keep round-tripping without them.

The frozen corpus in `tests/corpus/` may only grow. Existing fixture files are immutable after commit, and every fixture must open with zero sanitize warnings on every build. CI enforces this by loading each corpus design through the real app.

Two perform-rig fixtures join the corpus when Build 8 lands.
