# WHAT vs HOW Prompts

The Image Generation Pipeline uses a novel two-dimensional prompt refinement system that separates content description from visual style.

## Overview

Traditional image generation uses a single prompt that mixes content and style. This pipeline separates them:

- **WHAT**: Describes the semantic content of the image
- **HOW**: Describes the visual execution and artistic style

## WHAT - Content Dimension

### Purpose

Describes what is actually in the image - the subjects, objects, actions, and narrative elements.

### Focus Areas

- Characters and their descriptions
- Objects and items
- Actions and interactions
- Setting and environment
- Mood and atmosphere (conceptual)

### Style

Uses immersive, sensory-rich prose that paints a picture in words.

### Scoring

WHAT prompts are evaluated using **alignment scoring** (0-100), which measures how well the generated image matches the intended content.

### Example

```
Towering world-tree with roots piercing starlit sky, branches cradling
fragments of glowing cities, ancient bark textured like weathered stone
```

## HOW - Visual Style Dimension

### Purpose

Describes how the image should look - the visual treatment, technique, and aesthetic qualities.

### Focus Areas

- Lighting (direction, quality, color)
- Composition (framing, perspective, depth)
- Color palette (warm/cool, saturated/muted)
- Texture and materials
- Artistic style or medium

### Style

Uses concrete photographic and cinematic terminology that provides actionable visual direction.

### Scoring

HOW prompts are evaluated using **aesthetic scoring** (0-10), which measures the visual quality and appeal of the result.

### Example

```
Cinematic digital painting style, dramatic rim lighting with golden
hour warmth, deep shadows, glowing highlights, rich color grading
with teal shadows and amber highlights
```

## Key Principle

!!! important "Separation of Concerns"
    WHAT and HOW are maintained separately throughout the pipeline and only combined at image generation time.

This separation enables:

1. **Independent refinement** - Content and style can be improved separately
2. **Different metrics** - Each dimension has its own scoring criteria
3. **Targeted improvements** - Fix content without affecting style, and vice versa
4. **Better exploration** - The beam search can explore variations in each dimension

## Refinement Alternation

The beam search algorithm alternates which dimension gets refined:

| Iteration | Dimension Refined | Scoring Focus |
|-----------|-------------------|---------------|
| 0 | Initial expansion | Both WHAT and HOW expanded |
| 1 | WHAT | Alignment score |
| 2 | HOW | Aesthetic score |
| 3 | WHAT | Alignment score |
| 4 | HOW | Aesthetic score |
| ... | Alternates | ... |

## Combination Process

At image generation time, WHAT and HOW are combined using the LLM:

```javascript
const combinedPrompt = await llm.combinePrompts(whatPrompt, howPrompt);
```

The LLM merges both prompts into a single, cohesive image generation prompt that captures both the content and the style.

### Example Combination

**WHAT Input:**
```
Towering world-tree with roots piercing starlit sky, branches cradling
fragments of glowing cities
```

**HOW Input:**
```
Cinematic digital painting style, dramatic rim lighting, glowing highlights,
rich color grading
```

**Combined Output:**
```
Towering world-tree with roots piercing starlit sky, branches cradling
fragments of glowing cities, cinematic digital painting style, dramatic
rim lighting, glowing highlights, rich color grading
```

## Best Practices

### For WHAT Prompts

1. Be specific about subjects and their relationships
2. Include sensory details (not just visual)
3. Describe the narrative moment
4. Avoid visual/technical terms

### For HOW Prompts

1. Use concrete technical terms
2. Reference real photographic/cinematic techniques
3. Specify lighting direction and quality
4. Include color palette guidance
5. Mention artistic medium or style

## See Also

- [Beam Search Algorithm](beam-search-algorithm.md)
- [Streaming Parallel Architecture](streaming-parallel-architecture.md)
