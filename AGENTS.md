# Clipper releases

When shipping a feature or fix to Clipper, bump the app version in `package.json`, run the relevant checks and push the update to GitHub. The Windows release workflow on `main` builds and publishes the version. Verify the workflow and the public GitHub release before reporting completion.

Keep the online installer download URL stable. Rebuild its executable only when the online installer itself changes. Documentation and tooling changes do not require a new app version.
