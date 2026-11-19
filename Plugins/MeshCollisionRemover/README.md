# Mesh Collision Remover

A Blueprint-only, editor-only utility plugin for Unreal Engine 5. It adds one action to the
Content Browser: remove all collision from the static meshes you have selected.

## Use

1. Select any number of static meshes in the Content Browser (Ctrl or Shift click, or a whole
   folder's assets).
2. Right-click, then **Scripted Asset Actions**, then **Remove Collision From Selected Static Meshes**.
3. Save the changed meshes (they show as modified).

Only static meshes are offered the action, and anything else in the selection is ignored.

## Install

Copy the `MeshCollisionRemover` folder into your project's `Plugins` folder (or an engine's
`Engine/Plugins` folder) and enable it in **Edit > Plugins**. It needs the engine's
**Editor Scripting Utilities** plugin, which the descriptor enables for you.

## What is in it

- `Content/AAU_RemoveMeshCollision`: an Asset Action Utility Blueprint. Its function
  `RemoveCollisionFromSelectedStaticMeshes` gets the selected static meshes and calls
  *Remove Collisions* of the Static Mesh Editor Subsystem on each.

## Notes

- The function needs **Call In Editor** ticked in its Details panel for the menu entry to
  appear (open the Blueprint, select the function, tick it, compile and save).
- It is an editor tool: the Blueprint uses editor-only classes, so don't ship it in a packaged
  game. Keep it out of your cooked content, for example by adding the plugin's content folder
  to **Project Settings > Packaging > Directories to never cook**.
- It removes the simple collision shapes. To keep a mesh from colliding when it is placed, set
  its Collision Complexity or the actor's collision preset as usual.
