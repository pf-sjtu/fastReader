# AI Provider Configuration

## REMOVED Requirements

### Requirement: Configuration no longer contains metadata fields
Removed unnecessary metadata fields from provider configuration. The system SHALL NOT store `id`, `name`, `isCustom`, `isDefault`, `createdAt`, or `updatedAt` fields for AI providers.

#### Scenario: Configuration has no metadata fields
Given a new AI provider configuration
When the user creates a provider
Then the configuration should NOT contain `id`, `name`, `isCustom`, `isDefault`, `createdAt`, `updatedAt` fields

#### Scenario: Simplified provider structure
Given the AI provider configuration schema
When inspecting a provider object
Then it should only contain: `provider`, `apiKey`, `apiUrl`, `model`, `temperature`, `proxyUrl`, `proxyEnabled`, `customFields`

---

### Requirement: Provider selection uses numeric index
Provider selection MUST use `currentModelId` as 1-based integer index instead of string-based `activeProviderId`.

#### Scenario: Provider selection uses index
Given multiple AI providers configured
When selecting the active provider
Then the selection MUST use `currentModelId` as a 1-based integer index

#### Scenario: Old configuration import fails
Given an old configuration file with `activeProviderId`
When attempting to import the configuration
Then the import MUST fail with a clear error message about incompatible format

---

## MODIFIED Requirements

### Requirement: Display name derived from host/model
The system SHALL derive the display name from `host/model` format instead of storing it separately.

#### Scenario: Display name shows host and model
Given an AI provider with `apiUrl: "http://35.208.227.162:8317/v1beta"` and `model: "gemini-3-flash-preview"`
When displaying the provider in the UI
Then the display name SHOULD be `35.208.227.162/gemini-3-flash-preview`

#### Scenario: Display name for custom URL
Given an AI provider with `apiUrl: "https://api.xiaomimo.com/v1"` and `model: "mimo-v2-flash"`
When displaying the provider in the UI
Then the display name SHOULD be `api.xiaomimo.com/mimo-v2-flash`

---

## ADDED Requirements

### Requirement: Index-based provider management
The system MUST support index-based provider management operations including add, delete, and selection by index.

#### Scenario: Add new provider appends to list
Given an empty provider list
When the user adds a new provider
Then it MUST be appended as index 1

#### Scenario: Deleting provider re-indexes remaining
Given providers at indices 1, 2, 3, 4
When the user deletes provider at index 3
Then the remaining providers MUST be re-indexed to 1, 2, 3

#### Scenario: Deleting active provider adjusts selection
Given providers at indices 1, 2, 3 with currentModelId: 3
When the user deletes provider at index 3
Then currentModelId MUST adjust to 2 (or 1 if no providers remain)

#### Scenario: Duplicate check prevents duplicate providers
Given an existing provider with `apiUrl: "http://x.x.x.x:8317/v1"` and `model: "gemini"`
When the user attempts to add another provider with same `apiUrl` and `model`
Then the operation MUST be prevented with an error message

---

### Requirement: Complete workflow scenarios
The system SHALL support complete end-to-end workflows for index-based provider management.

#### Scenario: User adds first provider
Given no providers configured
When the user adds a Google Gemini provider
Then the provider MUST appear at index 1
And currentModelId MUST be automatically set to 1

#### Scenario: User switches between providers
Given providers at indices 1 (Gemini), 2 (OpenAI), 3 (Ollama)
And currentModelId is 2
When the user selects provider at index 3
Then currentModelId MUST update to 3
And subsequent API calls MUST use the Ollama configuration

#### Scenario: User exports configuration
Given a configured provider list with currentModelId: 2
When the user exports the configuration
Then the exported YAML MUST contain only essential fields
And use `currentModelId` instead of `activeProviderId`
