### BP_Enemy_Base (Blueprint Class)

Open `BP_Enemy_Base` and change its class defaults and components:

| Setting | Before | After |
|---|---|---|
| Capsule Component › Body Instance › Collision Profile Name | Pawn | Custom |
| Capsule Component › Collision Responses › Camera | Block | Ignore |
| Mesh › Body Instance › Collision Profile Name | Character Mesh | Custom |
| Mesh › Collision Responses › Camera | Block | Ignore |
| Mesh › Collision Responses › WorldStatic | Block | Ignore |
| Mesh › Collision Responses › WorldDynamic | Block | Ignore |
| Mesh › Collision Responses › PhysicsBody | Block | Ignore |
| Mesh › Collision Responses › Destructible | Block | Ignore |
