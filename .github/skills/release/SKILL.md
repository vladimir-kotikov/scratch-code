---
name: release
description: "Release the scratch-code VS Code extension. Use when: cutting a new release, bumping version, publishing, tagging. Covers version bump, changelog update, commit, and signed tag."
argument-hint: "minor | major | patch"
---

# Release scratch-code Extension

## When to Use

Any time a new version needs to be published: after a feature batch, a bug fix,
or a breaking change.

## Determine Bump Type

Review commits since the last release (`git log --oneline <last-tag>..HEAD`):

| Changes                                                  | Bump    |
| -------------------------------------------------------- | ------- |
| Breaking changes (renamed/removed tools, schema changes) | `major` |
| New features or tools                                    | `minor` |
| Bug fixes, documentation, refactors                      | `patch` |

## Procedure

### 1. Bump the version

```
npm version <major|minor|patch> --no-git-tag-version
```

This updates `package.json` and `package-lock.json` but does **not** create a
git tag (the signed tag is created separately in step 4).

### 2. Update CHANGELOG.md

Add a new entry at the top of `CHANGELOG.md` following the existing style:

```markdown
## [<version>]

- <concise present-tense bullet describing what changed>
- <another bullet>
```

**Style rules** (match existing entries):

- Start bullets with a capital action verb: _Add_, _Fix_, _Improve_, _Refactor_, _Remove_
- One idea per bullet; no trailing period
- No implementation details — describe user-visible behaviour
- Keep each bullet to one line where possible

### 3. Commit and push

```
git add package.json package-lock.json CHANGELOG.md
git commit -m "<version>"
git push
```

The commit message is the bare version string, e.g. `0.8.0`.

### 4. Create the signed release tag

```
git make-release --<major|minor|patch>
```

Use the **same** bump type as step 1. The script will print the commits
included and prompt: `About to push tag vX.Y.Z, continue? Yy/[Nn]` — confirm
with `y`. This generates a signed tag and pushes it to the remote, triggering
the publish workflow.
