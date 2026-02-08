## Implementation Tasks

### 1. Core Logic Changes
- [ ] 1.1 Modify `extractChapters` in `src/services/epubProcessor.ts`
  - Add target depth calculation: `targetDepth = Math.max(0, epubTocDepth - 1)`
  - Add exact level filtering for `epub-toc` mode: only keep chapters with `depth === targetDepth`
  - Disable subitem content aggregation for exact-level chapters
- [ ] 1.2 Maintain fallback strategy when target level is empty

### 2. i18n Updates (Parallel)
- [ ] 2.1 Update `zh.json`: `config.epubTocDepthDescription`
- [ ] 2.2 Update `en.json`: `config.epubTocDepthDescription`

### 3. Testing
- [ ] 3.1 Add test: `epub-toc + depth=1` returns only depth=0 chapters
- [ ] 3.2 Add test: `epub-toc + depth=2` returns only depth=1 chapters, no depth=0
- [ ] 3.3 Add test: `epub-toc + depth=3` returns only depth=2 chapters
- [ ] 3.4 Add test: fallback behavior when target level is missing
- [ ] 3.5 Add test: strict level content - no subitem content mixed
- [ ] 3.6 Run full test suite: `npm run test`

### 4. Validation
- [ ] 4.1 Manual E2E test with multi-level TOC EPUB
- [ ] 4.2 Verify: depth=1 shows only main chapters
- [ ] 4.3 Verify: depth=2 shows only sub-chapters
- [ ] 4.4 Verify: chapter content does not include child sections
- [ ] 4.5 OpenSpec validate (if CLI available)

### 5. Documentation
- [ ] 5.1 Update spec delta with final implementation details
- [ ] 5.2 Git commit with change-id reference
