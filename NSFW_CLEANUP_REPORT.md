# NSFW Content Cleanup Catalog

## Summary

⚠️ **CRITICAL**: Two categories of NSFW content found:

1. **Model name**: `flux-dev-fp8.safetensors` (in code/config files)
2. **Explicit session data**: 87 session metadata files containing explicit image generation prompts (on remote repository)

## Files in Current Working Tree

### Tracked Files Containing NSFW

1. `.env.backup` - Contains FLUX_MODEL_PATH with NSFW model name
2. `docs/CUSTOM_MODEL_LOCAL_ENCODERS.md` - Documentation referencing NSFW model
3. `src/api/provider-routes.js` - Default model path with NSFW model name
4. `test-output-after.txt` - Test output with NSFW model path
5. `test-output-before.txt` - Test output with NSFW model path
6. `test/api/service-validation.test.js` - Test using NSFW model name
7. `test/utils/service-manager-validation.test.js` - Test using NSFW model name
8. `package-lock.json` - Hash reference (not actual content)

### Untracked Files

- `TEST_FACE_FIXING.md` - Untracked, not in git history

## Git History Analysis

### Commits Containing NSFW Model Name (7 commits)

1. **01c9170** - 🟢 GREEN: add per-comparison retry robustness for socket hang-ups
2. **613c3f9** - 🟢 refactor: ensure tournament/vlm is default ranking mode
3. **794c5ad** - 🔴 test: add encoder path validation tests for local Flux models (TDD RED)
4. **61538ae** - feat: add configuration status display with .env override management
5. **d4ee673** - remove: untrack flux-custom-model-encoders test file
6. **f209246** - fix: improve CustomModel encoder loading with safetensors support
7. **dcdfd4a** - test(tdd): 🔴 RED phase - CustomModel model with local Flux encoders TDD suite

### Deleted Files Still in History

- `test/flux-custom-model-encoders.test.js` (deleted in d4ee673)
- `.tdd-custom-model-status.md` (deleted at some point)

### Files Modified Across Commits

- `.env.backup` (613c3f9)
- `docs/CUSTOM_MODEL_LOCAL_ENCODERS.md` (dcdfd4a)
- `src/api/provider-routes.js` (61538ae, dcdfd4a)
- `test/api/service-validation.test.js` (794c5ad)
- `test/utils/service-manager-validation.test.js` (794c5ad)
- `test-output-after.txt` (not in commits, might be untracked then tracked)
- `test-output-before.txt` (not in commits, might be untracked then tracked)

## Session History ⚠️ CRITICAL

**87 session metadata files with explicit content found on remote repository**

### Remote Repository (origin/main)

- **Location**: `session-history/2026-02-09/`
- **Files**: 87 `metadata.json` files
- **Content type**: Explicit image generation prompts containing:
  - Detailed descriptions of nudity
  - Sexual/erotic imagery descriptions
  - Adult content in `userPrompt`, `whatPrompt`, and `combined` fields

### Example Content (sanitized summary)

Session files contain JSON with fields like:

```json
{
  "sessionId": "ses-XXXXXX",
  "timestamp": "2026-02-09...",
  "userPrompt": "[EXPLICIT DESCRIPTION OF NUDE IMAGERY]",
  "iterations": [...detailed prompts and image paths...]
}
```

### Local Repository

- **Local session-history/**: Contains different files, not synchronized with remote
- **Git tracking**: Session history IS tracked (not in .gitignore)
- **Commits affected**: 12 commits contain session metadata files

## Timeline Context

### Model Name NSFW

- **Total commits in repo**: 1,505
- **Commits since first NSFW reference**: 133
- **First NSFW commit**: dcdfd4a (test(tdd): 🔴 RED phase - CustomModel model with local Flux encoders TDD suite)
- **Latest NSFW commit**: 01c9170 (🟢 GREEN: add per-comparison retry robustness for socket hang-ups)

### Session History NSFW

- **Session files on remote**: 87 metadata.json files
- **Commits with session files**: 12 commits
- **Latest commit**: 7ebda1d (fix: enable GFPGAN face fixing with basicsr-fixed dependency)
- **Files are on origin/main**: Yes, publicly visible on GitHub

## Replacement Strategy

Replace: `flux-dev-fp8.safetensors`
With: `flux-dev-fp8.safetensors` (generic name, no reference to original)

Alternative generic names:
- `flux-model-checkpoint.safetensors`
- `flux-custom-model.safetensors`
- `flux-dev-quantized.safetensors`

## Recommended Cleanup Strategy

### ✅ RECOMMENDED: Option 3 - git-filter-repo (COMPREHENSIVE)

**Best for**: Permanent, comprehensive cleanup of BOTH model names AND session history

```bash
# Install git-filter-repo
pip install git-filter-repo

# Backup first!
git clone --mirror . ../image-gen-pipe-v2-backup

# Step 1: Remove all session-history files from git history
git filter-repo --path session-history --invert-paths

# Step 2: Replace all custom-model references with generic name
git filter-repo --replace-text <(cat <<'EOF'
flux-dev-fp8==>flux-dev-fp8
flux-dev==>flux-dev
custom-model==>custom-model
CustomModel==>CustomModel
EOF
)

# Alternative: Do both in one command
cat > /tmp/nsfw-replacements.txt <<'EOF'
flux-dev-fp8==>flux-dev-fp8
flux-dev==>flux-dev
custom-model==>custom-model
CustomModel==>CustomModel
EOF

git filter-repo \
  --path session-history --invert-paths \
  --replace-text /tmp/nsfw-replacements.txt
```

**Pros**:

- Removes NSFW from entire history permanently
- Rewrites all commits
- Clean, professional repository
- Works with large repos efficiently

**Cons**:

- Rewrites all commit SHAs after first NSFW commit (133 commits)
- Requires force push
- Collaborators need to re-clone
- Any external references to commits will break

### Option 2 - Interactive Rebase (NOT RECOMMENDED)

**Why not recommended**: 133 commits to rebase is risky and error-prone

### Option 1 - Current State Only (INCOMPLETE)

**Why not recommended**: Leaves NSFW in git history, discoverable via `git log -S"nsfw"`

### Option 4 - Nuclear - Fresh Repository

**When to use**: If you want a completely clean slate and don't need the full history

```bash
# Create new orphan branch
git checkout --orphan clean-main

# Add current files
git add .
git commit -m "Initial commit with clean history"

# Replace main branch
git branch -D main
git branch -m main
```

## Next Steps

### Immediate Actions Required

1. **Backup repository** (`git clone --mirror . ../backup`)
2. **Run git-filter-repo** to remove session-history AND replace model name
3. **Verify cleanup**:
   - `git log -S"nsfw" -i` → should return nothing
   - `git ls-tree -r HEAD | grep session-history` → should return nothing
   - `git grep -i "buttocks\|naked\|nude"` → should return nothing
4. **Force push to remote** (`git push origin --force --all`)
5. **Update .gitignore** to prevent session-history from being committed again

### Post-Cleanup

Add to `.gitignore`:

```
# Session history - keep local only
session-history/
```

### Verification Commands

```bash
# Verify no NSFW model references
git log --all -S"flux-dev" --oneline
git log --all -S"custom-model" -i --oneline

# Verify no session files in history
git log --all --oneline -- "session-history/"

# Verify no explicit content
git grep -i "buttocks\|glutes\|naked" --all
git grep -i "custom-model" --all

# Verify only generic names remain
git grep -i "flux-dev\|custom-model"

# Check repository size reduction
git count-objects -vH
```

## Additional Files Requiring Manual Cleanup

After git-filter-repo, these files in the current working tree still reference "custom-model" (58 total references):

1. `docs/CUSTOM_MODEL_LOCAL_ENCODERS.md` - **Rename to** `docs/FLUX_LOCAL_ENCODERS.md`
2. `docs/encoder-path-fix.md` - Replace custom-model references
3. `.env.backup` - Replace model name
4. `.gitignore` - Replace in comments
5. `src/api/provider-routes.js` - Replace model path
6. `src/utils/service-manager.js` - Replace references
7. `.tdd-custom-model-status.md` - Delete or rename
8. `test/api/service-validation.test.js` - Replace in tests
9. `test-output-after.txt` - Replace or delete test output
10. `test-output-before.txt` - Replace or delete test output
11. `test/utils/service-manager-validation.test.js` - Replace in tests

### Suggested Replacements

- `flux-dev-fp8.safetensors` → `flux-dev-fp8.safetensors`
- `CustomModel` (name) → `Custom Model` or `Flux Custom`
- `custom-model` (references) → `custom-model` or `flux-custom`
- `CUSTOM_MODEL_LOCAL_ENCODERS.md` → `FLUX_LOCAL_ENCODERS.md`

### Post git-filter-repo Cleanup Script

```bash
# After running git-filter-repo, run this to clean working tree:

# 1. Rename documentation
git mv docs/CUSTOM_MODEL_LOCAL_ENCODERS.md docs/FLUX_LOCAL_ENCODERS.md

# 2. Delete temporary/test files
rm -f .tdd-custom-model-status.md test-output-*.txt

# 3. Use sed to replace remaining references
find . -type f \( -name "*.js" -o -name "*.md" -o -name ".env.backup" \) \
  -exec sed -i 's/flux-dev-fp8/flux-dev-fp8/g' {} \;
find . -type f \( -name "*.js" -o -name "*.md" -o -name ".env.backup" \) \
  -exec sed -i 's/flux-dev/flux-dev/g' {} \;
find . -type f \( -name "*.js" -o -name "*.md" -o -name ".env.backup" \) \
  -exec sed -i 's/CustomModel/CustomModel/g' {} \;
find . -type f \( -name "*.js" -o -name "*.md" -o -name ".env.backup" \) \
  -exec sed -i 's/custom-model/custom-model/g' {} \;

# 4. Update .gitignore comment if needed
sed -i 's/custom-model/flux-custom/gi' .gitignore

# 5. Verify no references remain
git grep -i "custom-model" || echo "✓ All custom-model references removed"

# 6. Commit the working tree cleanup
git add -A
git commit -m "docs: replace custom-model references with generic model names

Remove all references to specific model names and use generic terminology.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

## CivitAI and Custom Model References

### Suspect Model References Found in Code

**NSFW Model Names Referenced:**

1. **CustomFluxModel** - Referenced in code comments:
   - `services/flux_service.py`: "CustomFluxModel recommends Euler"
   - `src/config/provider-config.js`: "CustomFluxModel recommends euler"

2. **flux-custom-lora** - Referenced in examples:
   - `.env.example`: `FLUX_LORA_PATH=...flux-custom-lora.safetensors`

### Local Model Files (NOT in git, but present locally)

**⚠️ These files are gitignored but exist locally:**

1. `services/checkpoints/flux-dev-fp8.safetensors` - NSFW model
2. `services/checkpoints/STOIQOCustomFluxModelFLUXXL_F1DAlpha.safetensors` - NSFW model
3. `services/loras/CustomStyle_1.0_Flux.safetensors` - Likely NSFW LoRA
4. `services/loras/flux-custom-lora.safetensors` - NSFW LoRA

**✓ Clean files:**
- `services/checkpoints/pixelwave_flux1Dev03.safetensors` - Style model
- `services/encoders/*` - Standard Flux encoders (T5, CLIP, VAE)

### Additional Replacements Needed

Add these to the sed replacement script:

```bash
# Remove NSFW model references from code comments and examples
find . -type f \( -name "*.js" -o -name "*.py" -o -name ".env.example" \) \
  -exec sed -i 's/CustomFluxModel/CustomFluxModel/g' {} \;
find . -type f \( -name "*.js" -o -name "*.py" -o -name ".env.example" \) \
  -exec sed -i 's/custom-flux-model/custom-flux-model/g' {} \;
find . -type f \( -name "*.js" -o -name "*.py" -o -name ".env.example" \) \
  -exec sed -i 's/flux-custom-lora/flux-custom-lora/g' {} \;
find . -type f \( -name "*.js" -o -name "*.py" -o -name ".env.example" \) \
  -exec sed -i 's/CustomStyle/CustomStyle/g' {} \;
```

### CivitAI Platform References

**Keep these** - they're legitimate documentation references:
- Documentation about downloading custom models from CivitAI
- Code that supports CivitAI downloads
- UI hints pointing to CivitAI as a model source

These are fine as long as they don't reference specific NSFW models.
