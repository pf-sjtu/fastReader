# Design: Simplify AI Provider Configuration

## Configuration Structure

### Old Format
```yaml
aiConfigManager:
  providers:
    - id: default-gemini
      name: gemini-3-flash-preview
      provider: gemini
      apiKey: xxx
      apiUrl: http://x.x.x.x:8317/v1beta
      model: gemini-3-flash-preview
      temperature: 1.0
      isDefault: true
      isCustom: false
      createdAt: 1234567890
      updatedAt: 1234567890
  activeProviderId: default-gemini
```

### New Format
```yaml
aiConfigManager:
  providers:
    - provider: gemini          # or openai
      apiKey: xxx
      apiUrl: http://x.x.x.x:8317/v1beta
      model: gemini-3-flash-preview
      temperature: 1.0
      proxyUrl: ""
      proxyEnabled: false
      customFields: {}
    - provider: openai
      apiKey: xxx
      apiUrl: http://x.x.x.x:8317/v1
      model: minimax-m2.1
      temperature: 0.7
  currentModelId: 2  # 1-based index
```

## Key Design Decisions

### 1. Display Name Derivation
Display name format: `host/model`
- Example: `35.208.227.162/gemini-3-flash-preview`
- Extracted from: remove protocol and port from `apiUrl`, append `/model`

### 2. Index-Based Selection
- `currentModelId` uses 1-based integer index
- User-friendly (matches list display order)
- Deleting a provider automatically re-indexes remaining items
- When deleting the active provider, `currentModelId` adjusts or resets to 1

### 3. No ID Field
- Providers identified by array position
- Duplicate check: `apiUrl + model` combination must be unique

### 4. Backward Compatibility
- **NOT** supporting old config import
- Breaking change - users must reconfigure

## Implementation Sequence

1. Update `AIProviderConfig` interface in `configStore.ts`
2. Update `initialState` initialization
3. Update provider management methods (add, delete, duplicate, etc.)
4. Update `configExportService.ts` filter/validation logic
5. Update `AIProviderConfig.tsx` UI component
6. Update any other files referencing provider.id or provider.name
