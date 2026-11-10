### BP_Weapon_Base (Blueprint Class)

Components:

- Pivot (Scene Component)
  - Weapon (Static Mesh Component)
    - Sphere (Sphere Component)

Create a new Blueprint Class named `BP_Weapon_Base` in `/Game/App/Weapons`, then set:

| Setting | Value |
|---|---|
| Parent Class | Actor |
| Add Component | Pivot (Scene Component) |
| Add Component | Sphere (Sphere Component, attached to Weapon) |
| Sphere › Body Instance › Object Type | ECC_WorldStatic |
| Sphere › Body Instance › Collision Enabled | No Collision |
| Sphere › Body Instance › Notify Rigid Body Collision | True |
| Sphere › Body Instance › Collision Profile Name | Custom |
| Sphere › Collision Responses | Ignore: Visibility, Camera, WorldStatic, WorldDynamic, PhysicsBody, Vehicle, Destructible · Overlap: Pawn |
| Sphere › Body Instance › Enable Gravity | False |
| Sphere › Relative Location | X: 0, Y: 0, Z: 38.685858 |
| Sphere › Relative Scale3D | X: 2, Y: 2, Z: 2 |
| Add Component | Weapon (Static Mesh Component, attached to Pivot) |
| Weapon › Static Mesh | dagger_A |
| Weapon › Body Instance › Collision Enabled | Query Only |
| Weapon › Body Instance › Collision Profile Name | Custom |
| Weapon › Collision Responses | Ignore: all channels |
| Weapon › Relative Location | X: 0, Y: 0, Z: -8.630399 |
| Weapon › Relative Scale3D | X: 0.2225, Y: 0.2225, Z: 0.2225 |
