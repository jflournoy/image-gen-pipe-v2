# Analysis & Benchmarking Tools

This directory contains analysis and benchmarking tools for evaluating system performance, quality metrics, and trade-offs.

Unlike the pass/fail tests in `test/integration/`, these tools generate quantitative reports and comparisons to inform development decisions.

## Available Tools

### GFPGAN Color Preservation Analysis

**File**: `gfpgan-color-preservation.py`

**Purpose**: Measure color tone preservation vs face enhancement quality trade-offs in GFPGAN face fixing.

**What it does**:

- Generates before/after image pairs with different GFPGAN weight values
- Calculates quantitative color difference metrics (Delta E in LAB color space)
- Creates side-by-side visual comparisons
- Produces detailed report with recommendations

**Prerequisites**:

- Flux service running on `localhost:8001`
- Face-capable generation model loaded

**Usage**:

```bash
# Run the analysis
python test/analysis/gfpgan-color-preservation.py

# View results in /tmp/gfpgan_color_test/
ls -la /tmp/gfpgan_color_test/
```

**Output**:

- `weight_*_baseline.png` - Original images without face fixing
- `weight_*_fixed_w*.png` - Images with face fixing applied
- `weight_*_comparison_w*.png` - Side-by-side comparisons (left=before, right=after)
- `report.txt` - Detailed metrics and recommendations

**Metrics**:

- **Delta E (LAB)**: Industry-standard perceptual color difference
  - < 1.0 = Imperceptible difference
  - 1-2 = Perceptible with close observation
  - 2-10 = Perceptible at a glance
  - \> 10 = Obvious color shift
- **RGB channel differences**: Per-channel color changes

**When to use**:

- Evaluating face fixing quality vs color preservation trade-offs
- Finding optimal GFPGAN weight parameter for your use case
- Regression testing after GFPGAN updates
- Documenting face fixing behavior

## Adding New Analysis Tools

When adding new analysis tools:

1. Use descriptive kebab-case filenames
2. Make scripts executable (`chmod +x`)
3. Document in this README
4. Save output to `/tmp/` or user-specified directory
5. Generate both visual and quantitative results
6. Include recommendations in output

## Philosophy

Analysis tools should:

- **Inform decisions** with quantitative data
- **Generate reports** that can be reviewed offline
- **Be reproducible** (use fixed seeds where applicable)
- **Document trade-offs** rather than assert "right" answers
- **Guide tuning** of parameters and configurations
