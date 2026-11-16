### BP_Ghost (Blueprint Class)

Components:

- Capsule Component (Capsule Component)
  - Mesh (Skeletal Mesh Component)

Create a new Blueprint Class named `BP_Ghost` in `/Game/App/Hero`, then set:

| Setting | Value |
|---|---|
| Parent Class | Character |
| Class Defaults › Auto Possess AI | Placed In World Or Spawned |
| Class Defaults › AI Controller Class | BP_Ghost_AIController |
| Capsule Component › Body Instance › Object Type | ECC_WorldDynamic |
| Capsule Component › Body Instance › Collision Enabled | Query Only |
| Capsule Component › Body Instance › Collision Profile Name | Custom |
| Capsule Component › Collision Responses | Ignore: Visibility, Camera, Pawn, PhysicsBody, Vehicle, Destructible · Block: WorldStatic, WorldDynamic |
| Mesh › Skeletal Mesh Asset | TutorialTPP |
| Mesh › Body Instance › Object Type | ECC_WorldStatic |
| Mesh › Body Instance › Collision Enabled | No Collision |
| Mesh › Body Instance › Collision Profile Name | Custom |
| Mesh › Collision Responses | Ignore: all channels |
| Mesh › Relative Location | X: 0, Y: 0, Z: -88.94812 |
| Mesh › Relative Rotation | Pitch: 0, Yaw: -90, Roll: 0 |
