### BP_HitBox_Base (Blueprint Class)

Components:

- Default Scene Root (Scene Component)
  - Capsule (Capsule Component)

Create a new Blueprint Class named `BP_HitBox_Base` in `/Game/App/Weapons`, then set:

| Setting | Value |
|---|---|
| Parent Class | Actor |
| Add Variable | Lifetime (Float) |
| Add Component | Capsule (Capsule Component, attached to Default Scene Root) |
| Capsule › Capsule Half Height | 150 |
| Capsule › Capsule Radius | 44 |
| Capsule › Hidden In Game | False |
| Add Component | Default Scene Root (Scene Component) |
