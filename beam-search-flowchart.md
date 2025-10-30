# Beam Search Flow

Parameters:
- N = Total candidates per iteration (e.g., 9)
- M = Top candidates to keep (e.g., 3, where M < N)
- Expansion ratio = N/M (e.g., 3 children per parent)

```mermaid
flowchart TD
    Start[User: Initial Prompt] --> InitExpand[🔵 PARALLEL: Generate N WHAT+HOW pairs<br/>N=9 with stochastic variation]

    InitExpand --> WH1[Pair 1: WHAT_1, HOW_1]
    InitExpand --> WH2[Pair 2: WHAT_2, HOW_2]
    InitExpand --> WH3[Pair 3: WHAT_3, HOW_3]
    InitExpand --> WHdots[...]
    InitExpand --> WH9[Pair 9: WHAT_9, HOW_9]

    WH1 --> Combine1[🔵 Combine 1]
    WH2 --> Combine2[🔵 Combine 2]
    WH3 --> Combine3[🔵 Combine 3]
    WHdots --> Combinedots[...]
    WH9 --> Combine9[🔵 Combine 9]

    Combine1 --> Img1[🔵 Image Gen 1]
    Combine2 --> Img2[🔵 Image Gen 2]
    Combine3 --> Img3[🔵 Image Gen 3]
    Combinedots --> Imgdots[...]
    Combine9 --> Img9[🔵 Image Gen 9]

    Img1 --> Score1[🟡 Score 1<br/>Alignment + Aesthetic]
    Img2 --> Score2[🟡 Score 2<br/>Alignment + Aesthetic]
    Img3 --> Score3[🟡 Score 3<br/>Alignment + Aesthetic]
    Imgdots --> Scoredots[...]
    Img9 --> Score9[🟡 Score 9<br/>Alignment + Aesthetic]

    Score1 --> Rank[Rank all N=9 candidates]
    Score2 --> Rank
    Score3 --> Rank
    Scoredots --> Rank
    Score9 --> Rank

    Rank --> KeepTop[Keep top M=3 by score]
    KeepTop --> CheckDone{Max iterations?}

    CheckDone -->|Yes| Final[Return best candidate]
    CheckDone -->|No| SelectDim{Select Dimension<br/>Odd: WHAT<br/>Even: HOW}

    SelectDim -->|Odd Iter| CritiqueWhatBlock[🔵 PARALLEL: Generate M=3 WHAT critiques]
    SelectDim -->|Even Iter| CritiqueHowBlock[🔵 PARALLEL: Generate M=3 HOW critiques]

    CritiqueWhatBlock --> CritW1[Critique WHAT for Parent 1]
    CritiqueWhatBlock --> CritW2[Critique WHAT for Parent 2]
    CritiqueWhatBlock --> CritW3[Critique WHAT for Parent 3]

    CritiqueHowBlock --> CritH1[Critique HOW for Parent 1]
    CritiqueHowBlock --> CritH2[Critique HOW for Parent 2]
    CritiqueHowBlock --> CritH3[Critique HOW for Parent 3]

    CritW1 --> RefineW1[🔵 Refine WHAT: 3 children<br/>Inherit HOW from Parent 1]
    CritW2 --> RefineW2[🔵 Refine WHAT: 3 children<br/>Inherit HOW from Parent 2]
    CritW3 --> RefineW3[🔵 Refine WHAT: 3 children<br/>Inherit HOW from Parent 3]

    CritH1 --> RefineH1[🔵 Refine HOW: 3 children<br/>Inherit WHAT from Parent 1]
    CritH2 --> RefineH2[🔵 Refine HOW: 3 children<br/>Inherit WHAT from Parent 2]
    CritH3 --> RefineH3[🔵 Refine HOW: 3 children<br/>Inherit WHAT from Parent 3]

    RefineW1 --> NextGen[Next iteration:<br/>N=9 new candidates<br/>M=3 children per parent]
    RefineW2 --> NextGen
    RefineW3 --> NextGen
    RefineH1 --> NextGen
    RefineH2 --> NextGen
    RefineH3 --> NextGen

    NextGen --> Combine1

    style InitExpand stroke:#4CAF50,stroke-width:4px
    style Combine1 stroke:#4CAF50,stroke-width:4px
    style Combine2 stroke:#4CAF50,stroke-width:4px
    style Combine3 stroke:#4CAF50,stroke-width:4px
    style Combine9 stroke:#4CAF50,stroke-width:4px
    style Img1 stroke:#4CAF50,stroke-width:4px
    style Img2 stroke:#4CAF50,stroke-width:4px
    style Img3 stroke:#4CAF50,stroke-width:4px
    style Img9 stroke:#4CAF50,stroke-width:4px
    style Score1 stroke:#FFC107,stroke-width:4px
    style Score2 stroke:#FFC107,stroke-width:4px
    style Score3 stroke:#FFC107,stroke-width:4px
    style Score9 stroke:#FFC107,stroke-width:4px
    style CritiqueWhatBlock stroke:#4CAF50,stroke-width:4px
    style CritiqueHowBlock stroke:#4CAF50,stroke-width:4px
    style RefineW1 stroke:#4CAF50,stroke-width:4px
    style RefineW2 stroke:#4CAF50,stroke-width:4px
    style RefineW3 stroke:#4CAF50,stroke-width:4px
    style RefineH1 stroke:#4CAF50,stroke-width:4px
    style RefineH2 stroke:#4CAF50,stroke-width:4px
    style RefineH3 stroke:#4CAF50,stroke-width:4px
```

## Key Parallelization Points (🔵 Green)

1. **Initial expansion**: N WHAT+HOW pairs generated simultaneously with temperature > 0
2. **Combine prompts**: N combines happen in parallel
3. **Image generation**: All N images generated in parallel
4. **Critique generation**: M critiques (one per surviving parent) in parallel
5. **Refinement**: Each parent generates N/M children in parallel

## Sequential Within Each (🟡 Yellow)

- Alignment + Aesthetic scoring happen in parallel for each image
- But we could make these even more parallel if Vision provider supports it

## Iteration Flow

**Iteration 0:**
- Input: 1 user prompt
- Output: N=9 candidates → Keep top M=3
- Dimension: WHAT (content)

**Iteration 1+:**
- Input: M=3 parents
- Each parent → N/M=3 children
- Output: N=9 candidates → Keep top M=3
- Dimension: Alternates WHAT/HOW
