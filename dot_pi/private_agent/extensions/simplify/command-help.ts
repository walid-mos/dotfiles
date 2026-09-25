/** User-facing grammar and examples for /simplify. */

export const USAGE = `/simplify [target] [scope] [--focus <text>]

Analyse code through four fresh-eyes lenses (reuse, quality, efficiency, solid)
and apply only evidence-backed simplifications.

  /simplify backend     simplify the backend area directly, without Git
  /simplify the backend changes on this branch
                        let the agent resolve the changed-line subset
  /simplify PR #256 / #251 / #252, commit in each PR
                        handle each PR in its own worktree and commit as asked
  /simplify             simplify the branch against its mother branch
                        (main/master), uncommitted edits included

Scope
  --staged              staged changes only
  --last, --previous    the last commit (HEAD~1..HEAD)
  --ref <ref>           changes against <ref>
  --files <paths…>      exact whole files or directories; Git is not required
  --snapshot <paths…>   alias for --files
  --focus <text>        extra emphasis appended to every lens
  --help                this text

Jev routes a bare target: a literal file/directory is selected directly; a
semantic, partial or multi-target request goes to the agent to plan and execute.
For PR branches, use an existing worktree or create a temporary one. Commits
happen only when explicitly requested. Explicit scope flags stay deterministic.`
