# Spec: Prism-State-Migration

Scope: repo

# Prism Redux to Blazor State Migration

## Current Redux Store Structure (6 slices)

| Slice | State | Persistence |
|-------|-------|-------------|
| chatSlice | messages, sessions, history, undo/redo | redux-persist → IndexedDB |
| aiConfigSlice | provider, model, API keys, temperature | redux-persist → localStorage |
| uiSlice | sidebar, dark mode, fonts | CSS variables |
| settingsSlice | general preferences | redux-persist → localStorage |
| promptsSlice | shortcuts, templates | redux-persist → IndexedDB |
| networkSlice | online/offline, sync queue | none |

## C# Translation Options

### Option A: Fluxor (Redux-like, familiar pattern)
- One-to-one mapping of slices → Features
- Actions, Reducers, Effects pattern
- Good for team with Redux experience
- Adds dependency

### Option B: Blazor DI State Services (recommended)
- Scoped services with `IStateService<T>`
- `NotifyStateChanged` event pattern
- Built-in DI, no extra packages
- Simpler, fewer abstractions

### Recommended: Option B with Memento for Undo/Redo

```csharp
// ChatStateService.cs
public class ChatStateService : IStateService<ChatState>
{
    private ChatState _state;
    private readonly Stack<ChatSnapshot> _undoStack = new();
    private readonly Stack<ChatSnapshot> _redoStack = new();
    public event Action? StateChanged;

    public void Undo() { /* pop _undoStack, push to _redoStack */ }
    public void Redo() { /* pop _redoStack, push to _undoStack */ }
}

// AiConfigService.cs
public class AiConfigOptions
{
    public AiProvider Provider { get; set; }
    public string Model { get; set; }
    public string? ApiKey { get; set; }
    public double Temperature { get; set; }
}
// Persisted via IPreferences / appsettings.json
```

## Persistence Mapping

| Redux persist target | C# equivalent |
|---------------------|---------------|
| IndexedDB | BlazorIndexedDB or JS interop |
| localStorage | JS interop `localStorage.setItem` |
| Session storage | JS interop `sessionStorage` |
| None (network) | In-memory singleton |

## Hooks Translation

| Redux Hook | Blazor Equivalent |
|------------|-------------------|
| `useSelector` | `@inject IStateService<T>` + `State.Property` |
| `useDispatch` | Call service methods directly |
| `useForkChat` | `ChatService.ForkSessionAsync()` |
| `useUndoRedo` | `ChatStateService.Undo()` / `.Redo()` |
| `useChatForm` | `EditForm` + `InputTextarea` with validation |