## Implementation Tasks

### 1. Core Logic Changes
- [x] 1.1 Modify `extractChapters` in `src/services/epubProcessor.ts`
  - Add target depth calculation: `targetDepth = Math.max(0, epubTocDepth - 1)`
  - Add exact level filtering for `epub-toc` mode: only keep chapters with `depth === targetDepth`
  - Disable subitem content aggregation for exact-level chapters
- [x] 1.2 Maintain fallback strategy when target level is empty

### 2. i18n Updates (Parallel)
- [x] 2.1 Update `zh.json`: `config.epubTocDepthDescription`
- [x] 2.2 Update `en.json`: `config.epubTocDepthDescription`

### 3. Testing
- [x] 3.1 Add test: `epub-toc + depth=1` returns only depth=0 chapters
- [x] 3.2 Add test: `epub-toc + depth=2` returns only depth=1 chapters, no depth=0
- [x] 3.3 Add test: `epub-toc + depth=3` returns only depth=2 chapters
- [x] 3.4 Add test: fallback behavior when target level is missing
- [x] 3.5 Add test: strict level content - no subitem content mixed
- [x] 3.6 Run full test suite: `npm run test`

### 4. Upload Content Consistency
- [x] 4.1 Unify auto-sync and manual upload content format
  - Modify `autoSyncService.syncSummary` to generate single unified Markdown file
  - Use same file naming: `{sanitizedName}-完整摘要.md`
  - Use same `metadataFormatter.formatUnified` format
- [x] 4.2 Add directory detection metadata to HTML comment header
  - Add `chapterDetectionMode` to ProcessingMetadata interface
  - Add `epubTocDepth` to ProcessingMetadata interface
  - Update metadataFormatter to include these fields in HTML comment
  - Update cloudCacheService to parse these fields

### 5. Validation
- [x] 5.1 Manual E2E test with multi-level TOC EPUB
- [x] 5.2 Verify: depth=1 shows only main chapters
- [x] 5.3 Verify: depth=2 shows only sub-chapters
- [x] 5.4 Verify: chapter content does not include child sections
- [x] 5.5 OpenSpec validate (if CLI available)

### 6. Documentation
- [x] 6.1 Update spec delta with final implementation details
- [x] 6.2 Git commit with change-id reference
