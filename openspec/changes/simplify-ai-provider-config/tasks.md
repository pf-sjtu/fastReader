# Tasks: Simplify AI Provider Configuration

## Phase 1: Core Configuration Changes

- [ ] 1.1 Update `AIProviderConfig` interface in `src/stores/configStore.ts`
  - Remove: `id`, `name`, `isCustom`, `isDefault`, `createdAt`, `updatedAt`
  - Keep: `provider`, `apiKey`, `apiUrl`, `model`, `temperature`, `proxyUrl`, `proxyEnabled`, `customFields`

- [ ] 1.2 Update `initialState` in `src/stores/configStore.ts`
  - Remove `activeProviderId`, add `currentModelId`
  - Update default provider configuration

- [ ] 1.3 Update `addProvider` method
  - Remove `id` generation
  - Use array push instead of id-based map

- [ ] 1.4 Update `deleteProvider` method
  - Accept index instead of id
  - Re-index remaining providers
  - Adjust `currentModelId` if needed

- [ ] 1.5 Update `duplicateProvider` method
  - Handle index-based duplication

- [ ] 1.6 Update `setActiveProvider` method
  - Rename to `setCurrentModelId`
  - Accept index (1-based) instead of id

- [ ] 1.7 Update `getActiveProvider` method
  - Find by index instead of id
  - Return null if index out of range

- [ ] 1.8 Update `createFromTemplate` method
  - Handle new structure

## Phase 2: Export/Import Service Changes

- [ ] 2.1 Update `filterConfigData` in `src/services/configExportService.ts`
  - Remove id/name filtering
  - Handle `currentModelId` instead of `activeProviderId`

- [ ] 2.2 Update `validateConfig` method
  - Remove id validation
  - Validate `currentModelId` is a positive integer

## Phase 3: UI Component Changes

- [ ] 3.1 Update `AIProviderConfig.tsx` provider list display
  - Show index (1, 2, 3...) instead of name
  - Show host/model format as display name

- [ ] 3.2 Update provider selection UI
  - Use index-based selection

- [ ] 3.3 Update add/edit dialog
  - Remove name/id fields
  - Add duplicate check (apiUrl + model)

- [ ] 3.4 Update delete confirmation
  - Show index in confirmation message

## Phase 4: Integration Updates

- [ ] 4.1 Update `aiService.ts` to use new structure
  - Find provider by index instead of id

- [ ] 4.2 Update any other files referencing `provider.id` or `provider.name`
  - Search with: `rg "provider\.id|provider\.name|activeProviderId"`

## Phase 5: Cleanup & Validation

- [ ] 5.1 Run `npm run build` to verify no TypeScript errors
- [ ] 5.2 Test configuration export/import flow
- [ ] 5.3 Test all provider operations (add, edit, delete, switch)
- [ ] 5.4 Verify display names render correctly
- [ ] 5.5 Update `openspec/project.md` if needed
