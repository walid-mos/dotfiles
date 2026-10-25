#!/usr/bin/env bash
set -euo pipefail

organization="${NEXTNODE_ORG:-NextNodeSolutions}"
repository="${1:?usage: apply-repo-rules.sh <repository-name> [organization]}"
organization="${2:-$organization}"
repo="$organization/$repository"

command -v gh >/dev/null || { echo "gh CLI is required"; exit 1; }
gh auth status >/dev/null || { echo "gh must be authenticated"; exit 1; }

org_rulesets_active=$(gh api "orgs/$organization/rulesets" --jq '[.[] | select(.name == "org-squash-merge" or .name == "org-default-branch") | select(.enforcement == "active")] | length')
if [ "$org_rulesets_active" != "2" ]; then
  echo "org rulesets org-squash-merge and org-default-branch must exist and be active before applying repository rules; create them with gh api orgs/$organization/rulesets first"
  exit 1
fi
echo "org rulesets: both active"

failed=0
gh api -X PATCH "repos/$repo" -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false -F delete_branch_on_merge=true -F squash_merge_commit_title=PR_TITLE -F squash_merge_commit_message=PR_BODY --jq '"repository merge rules: squash-only=" + (.allow_squash_merge|tostring) + " delete-on-merge=" + (.delete_branch_on_merge|tostring) + " squash-title=" + .squash_merge_commit_title + " squash-message=" + .squash_merge_commit_message' || failed=1

gh api -X PUT "repos/$repo/vulnerability-alerts" >/dev/null && echo "dependabot alerts: enabled" || failed=1
gh api -X PUT "repos/$repo/automated-security-fixes" >/dev/null && echo "dependabot security updates: enabled" || failed=1

visibility=$(gh api "repos/$repo" --jq .visibility)
if [ "$visibility" = "public" ]; then
  printf '{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}' | gh api -X PATCH "repos/$repo" --input - --jq '"secret scanning: " + (.security_and_analysis.secret_scanning.status // "?") + " push protection: " + (.security_and_analysis.secret_scanning_push_protection.status // "?")' || failed=1
else
  echo "secret scanning: skipped (private repository, requires Advanced Security billing)"
fi

if [ "$failed" -ne 0 ]; then
  echo "one or more rules failed to apply on $repo"
  exit 1
fi
