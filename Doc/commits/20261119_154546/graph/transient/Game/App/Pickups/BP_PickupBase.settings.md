### BP_PickupBase (Blueprint Class)

Components:

- Default Scene Root (Scene Component)
  - Sphere (Sphere Component)
    - Static Mesh (Static Mesh Component)
- Rotating Movement (Rotating Movement Component)

Create a new Blueprint Class named `BP_PickupBase` in `/Game/App/Pickups`, then set:

| Setting | Value |
|---|---|
| Parent Class | Actor |
| Add Variable | Weapon Row (Data Table Row Handle Structure) |
| Weapon Row › Category | App |
| Weapon Row › Instance Editable | True |
| Add Function | `Spawn Weapon` |
| Spawn Weapon › Add Input | Instigator (Pawn Object Reference) |
| Spawn Weapon › Add Output | ReturnValue (BP Weapon Base Object Reference) |
| Spawn Weapon › Add Output | Out Row Strength (Integer) |
| Spawn Weapon › Add Output | Out Row Hit Animation (Anim Montage Object Reference) |
| Spawn Weapon › Category | App |
| Add Component | Default Scene Root (Scene Component) |
| Add Component | Rotating Movement (Rotating Movement Component) |
| Add Component | Sphere (Sphere Component, attached to Default Scene Root) |
| Sphere › Relative Location | X: 0, Y: 0, Z: 30 |
| Add Component | Static Mesh (Static Mesh Component, attached to Sphere) |
| Static Mesh › Static Mesh | item-luggage |
