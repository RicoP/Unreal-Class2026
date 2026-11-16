### BP_Enemy_AIController (Blueprint Class)

Components:

- AI Perception (AI Perception Component)

Create a new Blueprint Class named `BP_Enemy_AIController` in `/Game/App/Enemy`, then set:

| Setting | Value |
|---|---|
| Parent Class | AIController |
| Add Component | AI Perception (AI Perception Component) |
| AI Perception › Senses Config | (AISenseConfig_Sight) |
| AI Perception › Senses Config › AI Sight config › Sight Radius | 1500 |
| AI Perception › Senses Config › AI Sight config › Lose Sight Radius | 1800 |
| AI Perception › Senses Config › AI Sight config › Peripheral Vision Half Angle | 45 |
| AI Perception › Senses Config › AI Sight config › Detect Neutrals | True |
| AI Perception › Senses Config › AI Sight config › Detect Friendlies | True |
| AI Perception › Senses Config › AI Sight config › Max Age | 1 |
