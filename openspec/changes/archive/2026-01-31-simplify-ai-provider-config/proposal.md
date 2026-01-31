# Proposal: Simplify AI Provider Configuration

## Summary
Simplify the AI provider configuration structure by removing unnecessary fields and switching from ID-based to index-based provider selection.

## Problem Statement
Current AI provider configuration has several issues:
1. Unnecessary metadata fields (`id`, `name`, `isCustom`, `isDefault`, `createdAt`, `updatedAt`)
2. Complex ID-based selection instead of simple numeric indexing
3. Verbose display names that require separate `name` field

## Proposed Solution
Simplify the configuration structure:
- Remove: `id`, `name`, `isCustom`, `isDefault`, `createdAt`, `updatedAt`
- Use array index (1-based) for `currentModelId`
- Display name derived from `host/model` format

## Files Affected

### Core
- `src/stores/configStore.ts` - AIProviderConfig interface and state management
- `src/services/configExportService.ts` - Import/export logic

### UI
- `src/components/project/AIProviderConfig.tsx` - Provider configuration UI

## Dependencies
None - this is a self-contained refactoring

## Breaking Changes
Yes - existing configuration files will not be compatible. Users need to reconfigure.
