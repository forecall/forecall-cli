#!/usr/bin/env bash
# Installs a packed tarball into an empty directory as users do, and runs it with the node on PATH
# (CI runs it on the oldest and the newest Node the packages support).
#
#   scripts/try-package.sh <lint|cli> <tarball>
set -euo pipefail

kind=$1
tarball=$2
dir=$(mktemp -d)
tools='{"tools":[{"name":"get_forecast","description":"Returns the weather forecast for a city."}]}'

node --version
npm install --prefix "$dir" --no-audit --no-fund "$tarball"

case $kind in
  cli)
    "$dir/node_modules/.bin/forecall" --version
    echo "$tools" | "$dir/node_modules/.bin/forecall" lint - > /dev/null
    ;;
  lint)
    # Bare imports in --eval resolve from the working directory.
    cd "$dir"
    TOOLS=$tools node --input-type=module --eval '
      import { lintToolsList } from "@forecall/lint";
      import { issueMessage } from "@forecall/lint/internal/messages";
      const result = lintToolsList(process.env.TOOLS);
      if (!result.ok) throw new Error(result.error.code);
      const issue = result.report.tools[0]?.issues[0];
      console.log(result.report.scoreAvg, issue ? issueMessage("en", issue) : "");
    '
    ;;
  *)
    echo "usage: scripts/try-package.sh <lint|cli> <tarball>" >&2
    exit 2
    ;;
esac
