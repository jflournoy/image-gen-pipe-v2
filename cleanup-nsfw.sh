#!/bin/bash
set -e

echo "========================================="
echo "NSFW Content Cleanup Script"
echo "========================================="
echo ""
echo "This script will:"
echo "1. Backup repository"
echo "2. Run git-filter-repo to clean history"
echo "3. Clean working tree references"
echo "4. Verify cleanup"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# Step 1: Backup
echo ""
echo "Step 1: Creating backup..."
if [ -d "../image-gen-pipe-v2-backup" ]; then
    echo "ERROR: Backup directory already exists at ../image-gen-pipe-v2-backup"
    echo "Please remove it first or backup to a different location."
    exit 1
fi
git clone --mirror . ../image-gen-pipe-v2-backup
echo "✓ Backup created at ../image-gen-pipe-v2-backup"

# Step 2: Install git-filter-repo if needed
echo ""
echo "Step 2: Checking git-filter-repo..."
if ! command -v git-filter-repo &> /dev/null; then
    echo "Installing git-filter-repo..."
    pip install git-filter-repo
fi
echo "✓ git-filter-repo available"

# Step 3: Create replacement file
echo ""
echo "Step 3: Creating replacement rules..."
cat > /tmp/nsfw-replacements.txt <<'EOF'
flux-dev-fp8==>flux-dev-fp8
flux-dev==>flux-dev
custom-model==>custom-model
CustomModel==>CustomModel
CUSTOM_MODEL==>CUSTOM_MODEL
CustomFluxModel==>CustomFluxModel
custom-flux-model==>custom-flux-model
flux-custom-lora==>flux-custom-lora
CustomStyle==>CustomStyle
EOF
echo "✓ Replacement rules created"

# Step 4: Run git-filter-repo
echo ""
echo "Step 4: Running git-filter-repo (this may take a while)..."
echo "  - Removing session-history/"
echo "  - Replacing NSFW model names"
git filter-repo \
  --path session-history --invert-paths \
  --replace-text /tmp/nsfw-replacements.txt \
  --force

echo "✓ Git history rewritten"

# Step 5: Clean working tree
echo ""
echo "Step 5: Cleaning working tree..."

# Rename documentation
if [ -f "docs/CUSTOM_MODEL_LOCAL_ENCODERS.md" ]; then
    git mv docs/CUSTOM_MODEL_LOCAL_ENCODERS.md docs/FLUX_LOCAL_ENCODERS.md
    echo "  ✓ Renamed CUSTOM_MODEL_LOCAL_ENCODERS.md"
fi

# Delete temporary files
rm -f .tdd-custom-model-status.md test-output-*.txt
echo "  ✓ Deleted temporary files"

# Replace references in files
echo "  - Replacing model name references..."
find . -type f \( -name "*.js" -o -name "*.py" -o -name "*.md" -o -name ".env.*" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -exec sed -i 's/flux-dev-fp8/flux-dev-fp8/g' {} \;

find . -type f \( -name "*.js" -o -name "*.py" -o -name "*.md" -o -name ".env.*" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -exec sed -i 's/flux-dev/flux-dev/g' {} \;

find . -type f \( -name "*.js" -o -name "*.py" -o -name "*.md" -o -name ".env.*" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -exec sed -i 's/CustomModel/CustomModel/g' {} \;

find . -type f \( -name "*.js" -o -name "*.py" -o -name "*.md" -o -name ".env.*" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -exec sed -i 's/custom-model/custom-model/g' {} \;

find . -type f \( -name "*.js" -o -name "*.py" -o -name "*.md" -o -name ".env.*" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -exec sed -i 's/CustomFluxModel/CustomFluxModel/g' {} \;

find . -type f \( -name "*.js" -o -name "*.py" -o -name "*.md" -o -name ".env.*" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -exec sed -i 's/custom-flux-model/custom-flux-model/g' {} \;

find . -type f \( -name "*.js" -o -name "*.py" -o -name "*.md" -o -name ".env.*" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -exec sed -i 's/flux-custom-lora/flux-custom-lora/g' {} \;

find . -type f \( -name "*.js" -o -name "*.py" -o -name "*.md" -o -name ".env.*" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -exec sed -i 's/CustomStyle/CustomStyle/g' {} \;

echo "  ✓ Replaced all model name references"

# Verify session-history is in .gitignore
if ! grep -q "^session-history/$" .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    echo "# Session history - keep local only" >> .gitignore
    echo "session-history/" >> .gitignore
    echo "  ✓ Added session-history/ to .gitignore"
else
    echo "  ✓ session-history/ already in .gitignore"
fi

# Verify .local-*.md is in .gitignore
if ! grep -q "^.local-\*.md$" .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    echo "# Local development notes" >> .gitignore
    echo ".local-*.md" >> .gitignore
    echo "  ✓ Added .local-*.md to .gitignore"
else
    echo "  ✓ .local-*.md already in .gitignore"
fi

# Step 6: Commit working tree changes
echo ""
echo "Step 6: Committing working tree cleanup..."
git add -A
git commit -m "docs: replace all NSFW model references with generic names

- Rename CUSTOM_MODEL_LOCAL_ENCODERS.md to FLUX_LOCAL_ENCODERS.md
- Replace custom-model/CustomFluxModel/uncensored model names with generic terms
- Add session-history/ to .gitignore
- Remove temporary test output files

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>" || echo "  (No changes to commit)"

echo "✓ Working tree cleaned"

# Step 7: Verification
echo ""
echo "Step 7: Verifying cleanup..."
echo ""

echo "Checking for NSFW model references..."
if git log --all -S"flux-dev" --oneline | head -1; then
    echo "  ⚠ WARNING: Found custom-model references in history"
else
    echo "  ✓ No custom-model references in history"
fi

if git log --all -S"CustomFluxModel" --oneline | head -1; then
    echo "  ⚠ WARNING: Found CustomFluxModel references in history"
else
    echo "  ✓ No CustomFluxModel references in history"
fi

echo ""
echo "Checking for session files in history..."
if git log --all --oneline -- "session-history/" | head -1; then
    echo "  ⚠ WARNING: Found session-history in git history"
else
    echo "  ✓ No session-history in git history"
fi

echo ""
echo "Checking working tree for NSFW references..."
NSFW_COUNT=$(git grep -i "custom-model\|custom-flux-model\|uncensored.*lora\|sinfully" 2>/dev/null | wc -l || echo "0")
if [ "$NSFW_COUNT" -gt 0 ]; then
    echo "  ⚠ WARNING: Found $NSFW_COUNT NSFW references in working tree:"
    git grep -i "custom-model\|custom-flux-model\|uncensored.*lora\|sinfully" | head -10
else
    echo "  ✓ No NSFW references in working tree"
fi

echo ""
echo "Repository size:"
git count-objects -vH | grep "size-pack"

# Step 8: Instructions for force push
echo ""
echo "========================================="
echo "✓ CLEANUP COMPLETE"
echo "========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Review the changes:"
echo "   git log --oneline | head -20"
echo "   git status"
echo ""
echo "2. Test your application to ensure nothing broke"
echo ""
echo "3. Force push to remote (WARNING: Rewrites history!):"
echo "   git remote add origin-new <your-repo-url>  # If needed"
echo "   git push origin-new --force --all"
echo "   git push origin-new --force --tags"
echo ""
echo "4. Collaborators will need to re-clone the repository"
echo ""
echo "Backup location: ../image-gen-pipe-v2-backup"
echo ""
