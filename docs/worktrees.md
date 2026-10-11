# Worktrees: one per leg, who removes it and when

Owner decision on DEC-950, 2026-10-11. A leg is one agent's turn on an issue: the implementer's leg
ends at hand-back, the reviewer's leg ends at the verdict. On 2026-10-11 the repository root held
99 worktrees (26 GB), because no rule named the moment a tree became dead. This rule names it.

In every name below, `<N>` is the number of the issue.

## The rule

1. **One worktree per leg, under the repository root.** The implementer's tree is `wt-dec<N>`. A
   reviewer's scratch tree is `wt-dec<N>-<suffix>` (`-base`, `-mut`, `-draw`, `-main`, `-build`).
   Never work in the shared root checkout, and never create a worktree inside another worktree.
2. **Keep by committing.** Anything worth keeping is committed to the branch before hand-back.
   Untracked output in a worktree (gate runs, review notes, scratch scripts, dataset refreshes) is
   deleted with the tree. A reviewer's notes go in the verdict comment, not in files under the
   tree.
3. **The reviewer removes its own scratch trees** with `git worktree remove <path>` when it posts
   the verdict, and the verdict names the trees it removed.
4. **The CEO, at merge,** removes every `wt-dec<N>*` tree of the implementing issue and of its
   review issue, deletes the local branch, and checks that GitHub deleted the remote head branch
   (`delete_branch_on_merge` is on since 2026-10-11).
5. **The sweep.** The CEO removes any tree that is clean (`git status --porcelain` prints nothing)
   and whose head is contained in `origin/main` (`git merge-base --is-ancestor HEAD origin/main`
   exits 0), then runs `git worktree prune`. The sweep never touches a tree with uncommitted
   tracked changes, unmerged commits, the branch of an open pull request, or a tree that a live
   run holds (the wake payload names it, or its issue has a running agent). `--force` is never
   used. A tree the sweep cannot remove is reported in the merge comment, not forced.
6. **The audit leftovers stay.** The 20 trees the 2026-10-11 audit left on disk stay until their
   owner says they are dead. DEC-972, the issue that wrote this file, did not touch them. They
   are:
   - thirteen detached scaffolds on no ref: `wt-dec866-draw`, `wt-dec894`, `wt-dec903`,
     `wt-dec903-mut`, `wt-dec907`, `wt-dec909`, `wt-dec909-mut`, `wt-dec910`, `wt-dec912`,
     `wt-dec912-b`, `wt-dec914`, `wt-dec917b`, `wt-dec918`;
   - two probe branches with unpushed commits: `wt-dec878`, `wt-dec883`;
   - five trees with uncommitted output: `wt-dec774`, `wt-dec850`, `wt-dec863`, `wt-dec889-mut`,
     `wt-dec914-build`.

## Commands

`<repo-root>` is the path of the shared root checkout. `<path>` is the path of a worktree.

### Create a worktree

1. Fetch `origin/main`.

   ```sh
   git fetch origin
   ```

2. Create the tree and its branch from `origin/main`.

   ```sh
   git worktree add <repo-root>/wt-dec<N> -b dec<N>-<slug> origin/main
   ```

### Remove a worktree

1. Remove the tree.

   ```sh
   git worktree remove <path>
   ```

2. If Git refuses, list the untracked files and the uncommitted tracked changes that the tree
   holds.

   ```sh
   git -C <path> status --porcelain
   ```

3. Apply item 2 to each file: commit it to the branch, or delete it.
4. Do step 1 again.

### Sweep

1. Change to the shared root checkout.

   ```sh
   cd <repo-root>
   ```

2. Copy the block below.
3. Write the names of the trees that live runs hold into `live_trees`, with a space between
   names. Write an empty string when no run is live.
4. Put `echo` in place of `git worktree remove`, then run the block. It prints the path of each
   tree the sweep would remove, and it removes nothing.
5. Run the block as written.
6. Report each `could not remove` line in the merge comment.
7. Prune the records of trees that are no longer on disk.

   ```sh
   git worktree prune
   ```

The block:

```sh
(
  set -eu
  live_trees="wt-dec<N> wt-dec<N>-<suffix>"
  case "$live_trees" in
    *"<"*) echo "stop: write the names of the live trees into live_trees" >&2; exit 1 ;;
  esac
  open_pr_branches=$(gh pr list --state open --limit 1000 --json headRefName \
    --jq '[.[].headRefName] | join(" ")')
  git fetch origin
  echo "live trees: ${live_trees:-none}"
  echo "open pull request branches: ${open_pr_branches:-none}"
  trees=$(git worktree list --porcelain | sed -n 's/^worktree //p' | sed 1d)
  printf '%s\n' "$trees" | while IFS= read -r tree; do
    [ -n "$tree" ] || continue
    name=${tree##*/}
    case " $live_trees " in
      *" $name "*) echo "skip $name: a live run holds it"; continue ;;
    esac
    branch=$(git -C "$tree" symbolic-ref -q --short HEAD || true)
    if [ -n "$branch" ]; then
      case " $open_pr_branches " in
        *" $branch "*) echo "skip $name: $branch has an open pull request"; continue ;;
      esac
    fi
    if ! changes=$(git -C "$tree" status --porcelain); then
      echo "skip $name: git status failed"; continue
    fi
    if [ -n "$changes" ]; then
      echo "skip $name: not clean"; continue
    fi
    if ! git -C "$tree" merge-base --is-ancestor HEAD origin/main; then
      echo "skip $name: head is not in origin/main"; continue
    fi
    echo "remove $name"
    git worktree remove "$tree" || echo "could not remove $name: report it in the merge comment"
  done
)
```

What the block does, in the order of item 5:

- It has two skip lists. `live_trees` is the list you wrote. `open_pr_branches` is the head branch
  of every open pull request, read from GitHub when the block runs. It prints both lists.
- It stops before it looks at a tree if `live_trees` still holds a placeholder, if `gh` fails, or
  if the fetch fails. An empty skip list after a failure would remove a protection.
- It leaves the shared root checkout out. That is the first entry `git worktree list` prints.
- It skips a tree named in `live_trees`, and runs no Git command in that tree.
- It skips a tree whose branch is in `open_pr_branches`.
- It skips a tree where `git status --porcelain` prints a line or fails. That covers untracked
  files and uncommitted tracked changes.
- It skips a tree whose head is not contained in `origin/main`. That covers unmerged commits.
- It removes each tree that is left with `git worktree remove` and no `--force`. Git itself
  refuses a tree that is locked or that became dirty after the check, and the block prints
  `could not remove` for it.
