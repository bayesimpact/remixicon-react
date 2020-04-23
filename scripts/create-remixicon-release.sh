#!/bin/bash
set -e
set -o pipefail

if [ "$1" == "--with-build-and-publish" ] && [ -z "$2" ]; then
  echo "--with-build-and-publish requires package type."
  exit 1
fi

remixicon_prev="$(git show $GITHUB_SHA~1:package.json | jq -r '.dependencies["remixicon"]')"
remixicon_next="$(git show $GITHUB_SHA:package.json | jq -r '.dependencies["remixicon"]')"

if [ "$remixicon_prev" == "$remixicon_next" ]; then
  echo "no Remix Icon update found. skipping."
  exit 0
fi

react_version="$(jq -r '.version' publish-react/package.json)"

echo "Install dependencies..."
yarn install --frozen-lockfile

echo "Update README.md, CHANGELOG.md and publish-react/package.json..."
node scripts/create-remixicon-release.js $remixicon_prev $remixicon_next $react_version

if [ "$1" == "--with-commit" ]; then
  echo "Set up Git..."
  # Set up Git
  cat > $HOME/.netrc <<- EOF
		machine github.com
		login pcorpet
		password $GITHUB_TOKEN
		machine api.github.com
		login pcorpet
		password $GITHUB_TOKEN
EOF
  chmod 600 $HOME/.netrc

  git config --global user.email "pascal@bayesimpact.org"
  git config --global user.name "Pascal Corpet"

  echo "Create and push release commit..."

  push_branch=$(echo $GITHUB_REF | awk -F / '{ print $3 }')
  git checkout $push_branch
  git add .
  git commit -m "Release $(jq -r '.version' publish-react/package.json)"
  git push -u origin $push_branch
elif [ "$1" == "--with-build-and-publish" ]; then
  cd publish-$2
  npm publish
  cd ..
fi
