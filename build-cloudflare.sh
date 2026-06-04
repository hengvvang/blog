#!/bin/bash
# Exit on error
set -e

echo "=== Installing Bun ==="
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

echo "=== Installing mdbook ==="
# Download the mdbook binary (linux x86_64)
MDBOOK_VERSION="v0.4.40"
curl -sL "https://github.com/rust-lang/mdBook/releases/download/${MDBOOK_VERSION}/mdbook-${MDBOOK_VERSION}-x86_64-unknown-linux-gnu.tar.gz" | tar -xz
chmod +x mdbook
# Add current directory to PATH so mdbook can be executed
export PATH="$PWD:$PATH"

echo "=== Verifying Installations ==="
echo "Bun version:"
bun --version
echo "mdbook version:"
mdbook --version

echo "=== Installing Dependencies ==="
bun install

echo "=== Building Project ==="
bun run build

echo "=== Build finished successfully! ==="
