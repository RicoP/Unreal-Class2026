### BP_AppMacroLibrary (Blueprint Class)

Create a new Blueprint Macro Library named `BP_AppMacroLibrary` in `/Game/App/Utilities` (Add > Blueprint > Blueprint Macro Library), then set:

| Setting | Value |
|---|---|
| Parent Class | Object |
| Add Macro | `Play Sound For Surface` |
| Play Sound For Surface › Add Input | execute (Exec) |
| Play Sound For Surface › Add Input | PM Found (Physical Material Object Reference) |
| Play Sound For Surface › Add Input | PM Compare (Physical Material Object Reference) |
| Play Sound For Surface › Add Input | Sound (Sound Base Object Reference) |
| Play Sound For Surface › Add Input | Location (Vector) |
| Play Sound For Surface › Add Output | Found (Exec) |
| Play Sound For Surface › Add Output | Else (Exec) |
