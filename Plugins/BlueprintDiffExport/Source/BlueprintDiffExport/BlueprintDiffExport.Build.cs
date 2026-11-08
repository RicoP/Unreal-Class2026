using UnrealBuildTool;

public class BlueprintDiffExport : ModuleRules
{
	public BlueprintDiffExport(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"UnrealEd",
			"BlueprintGraph",
			"GraphEditor",
			"SourceControl",
			"ContentBrowser",
			"ToolMenus",
			"Slate",
			"SlateCore",
		});
	}
}
