## MODIFIED Requirements

### Requirement: EPUB TOC Depth Level Extraction

The system SHALL extract chapters from EPUB files based on the selected TOC depth level with exact level matching semantics.

#### Scenario: Extract only level 1 chapters
- **GIVEN** an EPUB file with multi-level table of contents
- **WHEN** user selects `epubTocDepth = 1` in EPUB TOC mode
- **THEN** only chapters at depth 0 (main chapters) SHALL be returned
- **AND** no sub-chapters (depth >= 1) SHALL be included

#### Scenario: Extract only level 2 chapters
- **GIVEN** an EPUB file with multi-level table of contents
- **WHEN** user selects `epubTocDepth = 2` in EPUB TOC mode
- **THEN** only chapters at depth 1 (sub-chapters) SHALL be returned
- **AND** no main chapters (depth 0) or deeper chapters (depth >= 2) SHALL be included

#### Scenario: Extract only level 3 chapters
- **GIVEN** an EPUB file with multi-level table of contents
- **WHEN** user selects `epubTocDepth = 3` in EPUB TOC mode
- **THEN** only chapters at depth 2 (sections) SHALL be returned
- **AND** no chapters at other depths SHALL be included

#### Scenario: Strict level content without child aggregation
- **GIVEN** an EPUB file with multi-level table of contents
- **WHEN** extracting chapters at a specific depth level
- **THEN** chapter content SHALL NOT include content from child/sub items
- **AND** each chapter SHALL contain only its own direct content

#### Scenario: Fallback when target level is empty
- **GIVEN** an EPUB file where the selected depth level has no chapters
- **WHEN** exact level filtering results in empty chapter list
- **THEN** the system SHALL fall back to spine-based chapter extraction
- **AND** processing SHALL continue without error
