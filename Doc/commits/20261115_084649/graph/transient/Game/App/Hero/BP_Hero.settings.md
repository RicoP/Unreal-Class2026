### BP_Hero (Blueprint Class)

Components:

- Capsule Component (Capsule Component)
  - Mesh (Skeletal Mesh Component)
- Collision Cylinder
  - Camera Boom (Spring Arm Component)
    - Follow Camera (Camera Component)
- Character Movement (Character Movement Component)

Create a new Blueprint Class named `BP_Hero` in `/Game/App/Hero`, then set:

| Setting | Value |
|---|---|
| Parent Class | BP_ThirdPersonCharacter |
| Add Variable | Active Weapon (BP Weapon Base Object Reference) |
| Add Function | `GetWeaponHitBoxPoint` |
| GetWeaponHitBoxPoint › Add Output | Transform (Transform) |
| GetWeaponHitBoxPoint › Pure | True |
