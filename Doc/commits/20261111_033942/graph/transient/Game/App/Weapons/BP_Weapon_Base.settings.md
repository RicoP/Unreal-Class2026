### BP_Weapon_Base (Blueprint Class)

Components:

- Pivot (Scene Component)
  - Weapon (Static Mesh Component)
    - Capsule (Capsule Component)

Open `BP_Weapon_Base` and change its class defaults and components:

| Setting | Before | After |
|---|---|---|
| Add Component | — | Capsule (Capsule Component, attached to Weapon) |
| Capsule › Body Instance › Notify Rigid Body Collision | False | True |
| Capsule › Relative Location | X: 0, Y: 0, Z: 0 | X: 0, Y: 0, Z: 38.788313 |
| Capsule › Relative Scale3D | X: 1, Y: 1, Z: 1 | X: 4.494382, Y: 4.494382, Z: 4.494382 |
| Weapon › Static Mesh | None | aid-cane |
| Weapon › Generate Overlap Events | True | False |
| Weapon › Can Character Step Up On | ECB_Yes | ECB_No |
| Weapon › Collision Responses › Visibility | Ignore | Overlap |
| Weapon › Collision Responses › Camera | Ignore | Overlap |
| Weapon › Collision Responses › WorldStatic | Ignore | Overlap |
| Weapon › Collision Responses › WorldDynamic | Ignore | Overlap |
| Weapon › Collision Responses › Pawn | Ignore | Overlap |
| Weapon › Collision Responses › PhysicsBody | Ignore | Overlap |
| Weapon › Collision Responses › Vehicle | Ignore | Overlap |
| Weapon › Collision Responses › Destructible | Ignore | Overlap |
| Weapon › Relative Rotation | Pitch: 0, Yaw: 0, Roll: 0 | Pitch: 0, Yaw: 90, Roll: 0 |
| Remove Component | Sphere | — |
