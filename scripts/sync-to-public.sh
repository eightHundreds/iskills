#!/usr/bin/env bash
# Replay private main history onto eightHundreds/iskills with private paths stripped.
#
# For each first-parent commit on private main:
#   - build a tree without private-only paths (see PRIVATE_ONLY_PATHS)
#   - if unchanged vs previous public commit, skip (private-only change)
#   - else create a public commit reusing author, committer, dates, and message
#
# Usage (private repo root, full history):
#   PUBLIC_REPO_SSH_KEY=... ./scripts/sync-to-public.sh
#   PUBLIC_REPO_TOKEN=...  ./scripts/sync-to-public.sh --force-rebuild
#
# Env:
#   PUBLIC_REPO_SSH_KEY  write deploy key for eightHundreds/iskills
#   PUBLIC_REPO_TOKEN    PAT with contents:write on eightHundreds/iskills
#   GITHUB_REF / GITHUB_REF_NAME  optional tag to mirror after sync
set -euo pipefail

PRIVATE_ONLY_PATHS=(
  test
  docs
  AGENTS.md
  CONTEXT.md
  .grok
  .impeccable
  PRODUCT.md
  DESIGN.md
)
SYNC_REF='refs/sync/last-private'
PUBLIC_REPO=${PUBLIC_REPO:-eightHundreds/iskills}
# Optional override for local dry-runs, e.g. PUBLIC_CLONE_URL=file:///tmp/public.git
PUBLIC_CLONE_URL=${PUBLIC_CLONE_URL:-}
FORCE_REBUILD=false

for arg in "$@"; do
  case "$arg" in
    --force-rebuild) FORCE_REBUILD=true ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

if [ -z "${PUBLIC_REPO_SSH_KEY:-}" ] && [ -z "${PUBLIC_REPO_TOKEN:-}" ] && [ -z "${PUBLIC_CLONE_URL:-}" ]; then
  echo 'Need PUBLIC_REPO_SSH_KEY, PUBLIC_REPO_TOKEN, or PUBLIC_CLONE_URL' >&2
  exit 1
fi

PRIVATE_ROOT=$(git rev-parse --show-toplevel)
cd "$PRIVATE_ROOT"

# Tag checkouts are detached: ensure a local main ref (origin/main after fetch-depth:0).
if ! git rev-parse --verify main >/dev/null 2>&1; then
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    git branch main origin/main
  else
    echo 'Branch main not found' >&2
    exit 1
  fi
fi
PRIVATE_MAIN=$(git rev-parse main)

MAP_FILE=$(mktemp)
PUBLIC_DIR=$(mktemp -d)
MSG_FILE=$(mktemp)
trap 'rm -f "$MAP_FILE" "$MSG_FILE"; rm -rf "$PUBLIC_DIR"' EXIT

map_put() {
  printf '%s %s\n' "$1" "$2" >>"$MAP_FILE"
}

map_get() {
  awk -v k="$1" '$1 == k { v = $2 } END { if (v != "") print v }' "$MAP_FILE"
}

public_clone_url() {
  if [ -n "$PUBLIC_CLONE_URL" ]; then
    echo "$PUBLIC_CLONE_URL"
    return
  fi
  if [ -n "${PUBLIC_REPO_SSH_KEY:-}" ]; then
    mkdir -p ~/.ssh
    printf '%s\n' "$PUBLIC_REPO_SSH_KEY" >~/.ssh/id_ed25519
    chmod 600 ~/.ssh/id_ed25519
    ssh-keyscan -t ed25519,rsa github.com >>~/.ssh/known_hosts 2>/dev/null || true
    echo "git@github.com:${PUBLIC_REPO}.git"
  elif [ -n "${PUBLIC_REPO_TOKEN:-}" ]; then
    echo "https://x-access-token:${PUBLIC_REPO_TOKEN}@github.com/${PUBLIC_REPO}.git"
  else
    echo 'Need PUBLIC_REPO_SSH_KEY, PUBLIC_REPO_TOKEN, or PUBLIC_CLONE_URL' >&2
    exit 1
  fi
}

# Materialize filtered tree of $1 into public index; print tree sha.
write_filtered_tree_in_public() {
  local commit=$1
  local work
  work=$(mktemp -d)

  git archive "$commit" | tar -x -C "$work"
  local p
  for p in "${PRIVATE_ONLY_PATHS[@]}"; do
    rm -rf "${work:?}/${p}"
  done

  # Replace public worktree (keep .git).
  find "$PUBLIC_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  # rsync may be missing on minimal images; use tar.
  tar -C "$work" -cf - . | tar -C "$PUBLIC_DIR" -xf -
  rm -rf "$work"

  git -C "$PUBLIC_DIR" add -A
  # Include deletions of tracked files removed by the filter.
  git -C "$PUBLIC_DIR" add -u
  git -C "$PUBLIC_DIR" write-tree
}

CLONE_URL=$(public_clone_url)
git clone "$CLONE_URL" "$PUBLIC_DIR"

LAST_PRIVATE=''
if git show-ref --verify --quiet "$SYNC_REF"; then
  LAST_PRIVATE=$(git rev-parse "$SYNC_REF")
fi

NEED_FULL=false
if [ "$FORCE_REBUILD" = true ]; then
  NEED_FULL=true
elif [ -z "$LAST_PRIVATE" ]; then
  NEED_FULL=true
elif ! git merge-base --is-ancestor "$LAST_PRIVATE" "$PRIVATE_MAIN" 2>/dev/null; then
  echo "Sync ref ${LAST_PRIVATE:0:7} is not an ancestor of main; full rebuild"
  NEED_FULL=true
fi

COMMITS=()
if [ "$NEED_FULL" = true ]; then
  echo "Full first-parent replay of private main → public"
  while IFS= read -r sha; do
    [ -n "$sha" ] && COMMITS+=("$sha")
  done < <(git rev-list --reverse --first-parent "$PRIVATE_MAIN")
else
  echo "Incremental replay ${LAST_PRIVATE:0:7}..${PRIVATE_MAIN:0:7}"
  while IFS= read -r sha; do
    [ -n "$sha" ] && COMMITS+=("$sha")
  done < <(git rev-list --reverse --first-parent "${LAST_PRIVATE}..${PRIVATE_MAIN}")
fi

PUBLIC_PARENT=''
if [ "$NEED_FULL" = true ]; then
  git -C "$PUBLIC_DIR" checkout --orphan __sync_rebuild >/dev/null 2>&1
  git -C "$PUBLIC_DIR" reset --hard >/dev/null 2>&1
  find "$PUBLIC_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
else
  git -C "$PUBLIC_DIR" checkout main >/dev/null
  PUBLIC_PARENT=$(git -C "$PUBLIC_DIR" rev-parse HEAD)
  echo "Public base ${PUBLIC_PARENT:0:7}"
fi

created=0
skipped=0

if [ ${#COMMITS[@]} -eq 0 ]; then
  echo 'No private commits to replay'
else
  for sha in "${COMMITS[@]}"; do
    TREE=$(write_filtered_tree_in_public "$sha")

    if [ -n "$PUBLIC_PARENT" ]; then
      PARENT_TREE=$(git -C "$PUBLIC_DIR" rev-parse "${PUBLIC_PARENT}^{tree}")
      if [ "$TREE" = "$PARENT_TREE" ]; then
        map_put "$sha" "$PUBLIC_PARENT"
        skipped=$((skipped + 1))
        continue
      fi
    fi

    export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE
    export GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE
    GIT_AUTHOR_NAME=$(git log -1 --format=%an "$sha")
    GIT_AUTHOR_EMAIL=$(git log -1 --format=%ae "$sha")
    GIT_AUTHOR_DATE=$(git log -1 --format=%aI "$sha")
    GIT_COMMITTER_NAME=$(git log -1 --format=%cn "$sha")
    GIT_COMMITTER_EMAIL=$(git log -1 --format=%ce "$sha")
    GIT_COMMITTER_DATE=$(git log -1 --format=%cI "$sha")

    git log -1 --format=%B "$sha" >"$MSG_FILE"

    if [ -n "$PUBLIC_PARENT" ]; then
      NEW=$(git -C "$PUBLIC_DIR" commit-tree "$TREE" -p "$PUBLIC_PARENT" -F "$MSG_FILE")
    else
      NEW=$(git -C "$PUBLIC_DIR" commit-tree "$TREE" -F "$MSG_FILE")
    fi

    map_put "$sha" "$NEW"
    PUBLIC_PARENT=$NEW
    created=$((created + 1))
    echo "  + ${sha:0:7} → ${NEW:0:7}  $(git log -1 --format=%s "$sha")"
  done
fi

if [ -z "$PUBLIC_PARENT" ]; then
  echo 'Nothing to push (empty public history and no exportable commits)' >&2
  exit 1
fi

# Point main at the replayed tip.
git -C "$PUBLIC_DIR" update-ref refs/heads/main "$PUBLIC_PARENT"
git -C "$PUBLIC_DIR" checkout main >/dev/null 2>&1 || git -C "$PUBLIC_DIR" symbolic-ref HEAD refs/heads/main

if [ "$NEED_FULL" = true ]; then
  git -C "$PUBLIC_DIR" push --force origin refs/heads/main:refs/heads/main
else
  git -C "$PUBLIC_DIR" push origin refs/heads/main:refs/heads/main
fi

# Record progress on private (requires push permission on private).
git update-ref "$SYNC_REF" "$PRIVATE_MAIN"
if git push origin "$SYNC_REF" 2>/dev/null; then
  echo "Updated ${SYNC_REF} → ${PRIVATE_MAIN:0:7}"
else
  echo "Warning: could not push ${SYNC_REF} (incremental sync may rebuild next time)" >&2
fi

# Optional tag mirror: map private tag target → public commit.
IS_TAG=false
case "${GITHUB_REF:-}" in
  refs/tags/*) IS_TAG=true ;;
esac

if [ "$IS_TAG" = true ]; then
  TAG_NAME=${GITHUB_REF_NAME:-${GITHUB_REF#refs/tags/}}
  PRIVATE_TAG_SHA=$(git rev-parse "$TAG_NAME^{commit}" 2>/dev/null || git rev-parse "${GITHUB_REF}^{commit}")
  PUBLIC_TAG_SHA=$(map_get "$PRIVATE_TAG_SHA")
  if [ -z "$PUBLIC_TAG_SHA" ]; then
    # Tag may point at a skipped (private-only) commit — walk first-parent until mapped.
    walk=$PRIVATE_TAG_SHA
    while [ -n "$walk" ] && [ -z "$PUBLIC_TAG_SHA" ]; do
      PUBLIC_TAG_SHA=$(map_get "$walk")
      if [ -n "$PUBLIC_TAG_SHA" ]; then
        break
      fi
      # Also try any known ancestor on main first-parent chain already in map.
      if ! walk=$(git rev-parse "${walk}^" 2>/dev/null); then
        break
      fi
    done
  fi
  if [ -z "$PUBLIC_TAG_SHA" ]; then
    PUBLIC_TAG_SHA=$PUBLIC_PARENT
    echo "Warning: no map for tag ${TAG_NAME}; using public main tip ${PUBLIC_TAG_SHA:0:7}"
  fi
  git -C "$PUBLIC_DIR" tag -f "$TAG_NAME" "$PUBLIC_TAG_SHA"
  git -C "$PUBLIC_DIR" push origin "refs/tags/${TAG_NAME}" --force
  echo "Pushed tag ${TAG_NAME} → public ${PUBLIC_TAG_SHA:0:7} (triggers Release on iskills)"
fi

echo "Done. created=${created} skipped_private_only=${skipped} public_tip=${PUBLIC_PARENT:0:7}"
